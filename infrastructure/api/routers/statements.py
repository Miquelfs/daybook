"""
Bank statements → reconciliation (domains/money/statements.py).

  POST   /money/statements                 upload one export (multipart: file, account)
  GET    /money/statements                 imports so far (?account=)
  DELETE /money/statements/{import_id}     forget one import's lines
  GET    /money/statements/status          per account: coverage + gaps (for banners)
  GET    /money/statements/reconcile       ?account=&start=&end= → the report
  POST   /money/statements/lines/{id}/add      create the Daybook entry from a bank line
  POST   /money/statements/lines/{id}/link     {txn_id} — pair by hand
  POST   /money/statements/lines/{id}/unlink
  POST   /money/statements/lines/{id}/ignore   {ignored}
  POST   /money/statements/lines/{id}/use-bank-amount   set the paired entry to the bank's amount
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from domains.money import statements
from domains.money.money_config import classify
from infrastructure.api.db_money import get_money_db

router = APIRouter(prefix="/money/statements", tags=["money"])
DB = Annotated[sqlite3.Connection, Depends(get_money_db)]
MAX_BYTES = 10 * 1024 * 1024


def _line(conn: sqlite3.Connection, line_id: int) -> sqlite3.Row:
    r = conn.execute("SELECT * FROM statement_lines WHERE id=?", (line_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Statement line not found")
    return r


@router.post("")
async def upload(conn: DB, file: UploadFile = File(...), account: str = Form(...)):
    account = account.strip()
    if not account:
        raise HTTPException(422, "Pick the account this statement is for")
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "That file is over 10 MB")
    try:
        parsed = statements.parse(raw, file.filename)
    except statements.StatementError as e:
        raise HTTPException(422, str(e))
    except Exception as e:                                # a corrupt workbook, a PDF the model couldn't read
        raise HTTPException(422, f"Couldn't read that file ({type(e).__name__})")
    return statements.store(conn, account, parsed, file.filename)


@router.get("")
def list_imports(conn: DB, account: Optional[str] = None):
    q = "SELECT * FROM statement_imports" + (" WHERE account=?" if account else "") + " ORDER BY imported_at DESC LIMIT 50"
    return [dict(r) for r in conn.execute(q, (account,) if account else ())]


@router.delete("/{import_id}")
def delete_import(import_id: int, conn: DB):
    if not conn.execute("SELECT 1 FROM statement_imports WHERE id=?", (import_id,)).fetchone():
        raise HTTPException(404, "Import not found")
    conn.execute("DELETE FROM statement_lines WHERE import_id=?", (import_id,))
    conn.execute("DELETE FROM statement_imports WHERE id=?", (import_id,))
    conn.commit()
    return {"status": "deleted"}


@router.get("/status")
def status(conn: DB):
    return statements.status(conn)


@router.get("/reconcile")
def reconcile(conn: DB, account: str = Query(...), start: Optional[str] = None, end: Optional[str] = None):
    return statements.reconcile(conn, account, start, end)


class AddBody(BaseModel):
    name: str
    category: str
    subcategory: Optional[str] = None
    notes: Optional[str] = None
    vehicle_id: Optional[int] = None


@router.post("/lines/{line_id}/add")
def add_from_line(line_id: int, body: AddBody, conn: DB):
    l = _line(conn, line_id)
    if l["txn_id"] and conn.execute("SELECT 1 FROM transactions WHERE id=? AND deleted_at IS NULL", (l["txn_id"],)).fetchone():
        raise HTTPException(409, "That line is already paired")
    txn_id = "local-" + str(uuid.uuid4())
    conn.execute(
        """INSERT INTO transactions (id, source, date, name, amount, account, category, subcategory,
                                     transaction_type, notes, vehicle_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (txn_id, "local", l["date"], body.name.strip() or l["description"][:60], l["amount"], l["account"],
         body.category, (body.subcategory or "").strip() or None, classify(body.category),
         body.notes or None, body.vehicle_id),
    )
    conn.execute("UPDATE statement_lines SET txn_id=?, ignored=0 WHERE id=?", (txn_id, line_id))
    conn.commit()
    return {"txn_id": txn_id}


class LinkBody(BaseModel):
    txn_id: str


@router.post("/lines/{line_id}/link")
def link(line_id: int, body: LinkBody, conn: DB):
    _line(conn, line_id)
    if not conn.execute("SELECT 1 FROM transactions WHERE id=? AND deleted_at IS NULL", (body.txn_id,)).fetchone():
        raise HTTPException(404, "Transaction not found")
    conn.execute("UPDATE statement_lines SET txn_id=NULL WHERE txn_id=?", (body.txn_id,))   # one line per entry
    conn.execute("UPDATE statement_lines SET txn_id=?, ignored=0 WHERE id=?", (body.txn_id, line_id))
    conn.commit()
    return {"status": "linked"}


@router.post("/lines/{line_id}/unlink")
def unlink(line_id: int, conn: DB):
    _line(conn, line_id)
    conn.execute("UPDATE statement_lines SET txn_id=NULL WHERE id=?", (line_id,))
    conn.commit()
    return {"status": "unlinked"}


class IgnoreBody(BaseModel):
    ignored: bool = True


@router.post("/lines/{line_id}/ignore")
def ignore(line_id: int, body: IgnoreBody, conn: DB):
    _line(conn, line_id)
    conn.execute("UPDATE statement_lines SET ignored=?, txn_id=CASE WHEN ? THEN NULL ELSE txn_id END WHERE id=?",
                 (int(body.ignored), int(body.ignored), line_id))
    conn.commit()
    return {"status": "ignored" if body.ignored else "restored"}


class BankAmountBody(BaseModel):
    txn_id: str


@router.post("/lines/{line_id}/use-bank-amount")
def use_bank_amount(line_id: int, body: BankAmountBody, conn: DB):
    """The entry was paired on a near amount (a tip, an FX fee): make it the bank's, and pin the pair."""
    l = _line(conn, line_id)
    if not conn.execute("SELECT 1 FROM transactions WHERE id=? AND deleted_at IS NULL", (body.txn_id,)).fetchone():
        raise HTTPException(404, "Transaction not found")
    conn.execute("UPDATE transactions SET amount=?, source='local', updated_at=? WHERE id=?",
                 (l["amount"], datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), body.txn_id))
    conn.execute("UPDATE statement_lines SET txn_id=NULL WHERE txn_id=?", (body.txn_id,))
    conn.execute("UPDATE statement_lines SET txn_id=? WHERE id=?", (body.txn_id, line_id))
    conn.commit()
    return {"status": "updated"}
