"""
Supermarket tickets attached to grocery expenses, and what they tell us:
spend by type, price history per product, products to avoid, recently bought.

Lives under /money because tickets hang off money.db transactions.
"""

import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from infrastructure.api.db_money import get_money_db
from infrastructure.api.models.groceries import (
    GroceryProduct, GroceryProductPatch, GrocerySummary, ReceiptItemOut, ReceiptOut, RecentGrocery,
)
from domains.money import groceries
from domains.money.receipts import ReceiptParseError, extract_text, parse_mercadona

router = APIRouter(prefix="/money", tags=["groceries"])

DB = Annotated[sqlite3.Connection, Depends(get_money_db)]

RECEIPTS_DIR = Path(__file__).parents[3] / "data" / "receipts"
MAX_PDF_BYTES = 5 * 1024 * 1024


def _receipt_out(conn: sqlite3.Connection, r: sqlite3.Row) -> ReceiptOut:
    ov = groceries.overrides(conn)
    txn = conn.execute("SELECT amount FROM transactions WHERE id=?", (r["transaction_id"],)).fetchone()
    items = []
    for i in conn.execute("SELECT * FROM receipt_items WHERE receipt_id=? ORDER BY line_no", (r["id"],)):
        group, avoid = groceries.classify(i["product"], ov)
        items.append(ReceiptItemOut(
            line_no=i["line_no"], product=i["product"], display=groceries.display_name(i["product"]),
            quantity=i["quantity"], weight_kg=i["weight_kg"], unit_price=i["unit_price"],
            amount=i["amount"], group=group, avoid=avoid,
        ))
    return ReceiptOut(
        id=r["id"], transaction_id=r["transaction_id"], store=r["store"],
        purchased_at=r["purchased_at"], invoice_no=r["invoice_no"], total=r["total"],
        matches_transaction=bool(txn) and abs(abs(txn["amount"]) - r["total"]) < 0.011,
        pdf_url=f"/money/receipts/{r['id']}/pdf",
        items=items,
    )


def _remove_receipt(conn: sqlite3.Connection, txn_id: str) -> None:
    old = conn.execute("SELECT id, pdf_path FROM receipts WHERE transaction_id=?", (txn_id,)).fetchone()
    if old:
        conn.execute("DELETE FROM receipt_items WHERE receipt_id=?", (old["id"],))
        conn.execute("DELETE FROM receipts WHERE id=?", (old["id"],))
        (RECEIPTS_DIR / old["pdf_path"]).unlink(missing_ok=True)


# ── Tickets on a transaction ─────────────────────────────────────────────────

@router.post("/transactions/{txn_id}/receipt", response_model=ReceiptOut)
async def attach_receipt(txn_id: str, file: UploadFile, conn: DB):
    """Attach (or replace) the ticket PDF for an expense and parse its lines."""
    if not conn.execute(
        "SELECT 1 FROM transactions WHERE id=? AND deleted_at IS NULL", (txn_id,)
    ).fetchone():
        raise HTTPException(status_code=404, detail="Transaction not found")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_PDF_BYTES or not raw.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="That isn't a ticket PDF")
    try:
        parsed = parse_mercadona(extract_text(raw))
    except ReceiptParseError as e:
        raise HTTPException(status_code=422, detail=str(e))

    _remove_receipt(conn, txn_id)
    cur = conn.execute(
        """INSERT INTO receipts (transaction_id, store, purchased_at, invoice_no, total, pdf_path)
           VALUES (?,?,?,?,?,'')""",
        (txn_id, parsed["store"], parsed["purchased_at"], parsed["invoice_no"], parsed["total"]),
    )
    receipt_id = cur.lastrowid
    rel = f"{receipt_id}.pdf"
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
    (RECEIPTS_DIR / rel).write_bytes(raw)
    conn.execute("UPDATE receipts SET pdf_path=? WHERE id=?", (rel, receipt_id))
    conn.executemany(
        """INSERT INTO receipt_items (receipt_id, line_no, product, quantity, weight_kg, unit_price, amount)
           VALUES (?,?,?,?,?,?,?)""",
        [(receipt_id, i["line_no"], i["product"], i["quantity"], i["weight_kg"], i["unit_price"], i["amount"])
         for i in parsed["items"]],
    )
    conn.commit()
    return _receipt_out(conn, conn.execute("SELECT * FROM receipts WHERE id=?", (receipt_id,)).fetchone())


@router.get("/transactions/{txn_id}/receipt", response_model=ReceiptOut)
def get_receipt(txn_id: str, conn: DB):
    r = conn.execute("SELECT * FROM receipts WHERE transaction_id=?", (txn_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="No ticket attached")
    return _receipt_out(conn, r)


@router.delete("/transactions/{txn_id}/receipt", status_code=204)
def delete_receipt(txn_id: str, conn: DB):
    _remove_receipt(conn, txn_id)
    conn.commit()


@router.get("/receipts/{receipt_id}/pdf")
def receipt_pdf(receipt_id: int, conn: DB):
    r = conn.execute("SELECT pdf_path FROM receipts WHERE id=?", (receipt_id,)).fetchone()
    path = RECEIPTS_DIR / r["pdf_path"] if r else None
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Ticket PDF not found")
    return FileResponse(path, media_type="application/pdf")


# ── What the tickets tell us ─────────────────────────────────────────────────

@router.get("/groceries/summary", response_model=GrocerySummary)
def grocery_summary(conn: DB, window: str = Query("3m", pattern="^(ticket|week|month|3m|12m)$")):
    return groceries.summary(conn, window)


@router.get("/groceries/products", response_model=list[GroceryProduct])
def grocery_products(conn: DB):
    return groceries.products(conn)


@router.patch("/groceries/products", response_model=GroceryProduct)
def patch_grocery_product(body: GroceryProductPatch, conn: DB):
    """Override a product's type and/or avoid flag (or reset to the rules).

    The product goes in the body: printed names contain '/' ("BURGER M VA/CE 500G").
    """
    product = body.product
    if not conn.execute("SELECT 1 FROM receipt_items WHERE product=? LIMIT 1", (product,)).fetchone():
        raise HTTPException(status_code=404, detail="Product not on any ticket")
    if body.group is not None and body.group not in groceries.GROUPS:
        raise HTTPException(status_code=422, detail=f"Unknown group {body.group!r}")
    if body.reset:
        conn.execute("DELETE FROM grocery_products WHERE product=?", (product,))
    else:
        conn.execute("INSERT OR IGNORE INTO grocery_products (product) VALUES (?)", (product,))
        if body.group is not None:
            conn.execute("UPDATE grocery_products SET grp=? WHERE product=?", (body.group, product))
        if body.avoid is not None:
            conn.execute("UPDATE grocery_products SET avoid=? WHERE product=?", (int(body.avoid), product))
        conn.execute(
            "UPDATE grocery_products SET updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE product=?",
            (product,),
        )
    conn.commit()
    return next(p for p in groceries.products(conn) if p["product"] == product)


@router.get("/groceries/recent", response_model=list[RecentGrocery])
def recent_groceries(conn: DB, days: int = Query(10, ge=1, le=60)):
    return groceries.recent(conn, days)
