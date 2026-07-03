"""
Groceries router — pantry, price history, price sync, purchases, and meal planning.
"""

import json
import sqlite3
import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from infrastructure.db.connection import get_connection
from domains.groceries import pantry as pantry_db
from domains.groceries.price_tracker import sync_prices
from domains.ai import ollama_client

router = APIRouter(prefix="/groceries", tags=["groceries"])

DB = Annotated[sqlite3.Connection, Depends(get_connection)]


# ─── Pantry ──────────────────────────────────────────────────────────────────

class PantryItemCreate(BaseModel):
    name: str
    mercadona_id: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None


class PantryItemUpdate(BaseModel):
    name: Optional[str] = None
    mercadona_id: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[int] = None


@router.get("/pantry")
def list_pantry(active_only: bool = Query(True)):
    items = pantry_db.list_pantry(active_only=active_only)
    # Attach latest price to each item
    for item in items:
        history = pantry_db.get_price_history(item["id"], days=7)
        item["latest_price"] = history[-1]["price_eur"] if history else None
        item["price_date"] = history[-1]["date"] if history else None
    return items


@router.post("/pantry", status_code=201)
def add_pantry_item(body: PantryItemCreate):
    return pantry_db.add_pantry_item(
        name=body.name,
        mercadona_id=body.mercadona_id,
        unit=body.unit,
        category=body.category,
    )


@router.patch("/pantry/{item_id}")
def update_pantry_item(item_id: str, body: PantryItemUpdate):
    updated = pantry_db.update_pantry_item(item_id, **body.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(404, "Pantry item not found")
    return updated


@router.delete("/pantry/{item_id}", status_code=204)
def delete_pantry_item(item_id: str):
    if not pantry_db.delete_pantry_item(item_id):
        raise HTTPException(404, "Pantry item not found")


# ─── Product search ──────────────────────────────────────────────────────────

@router.get("/search")
def search_products(q: str = Query(..., min_length=2)):
    """Search Mercadona product catalog by name. Returns up to 10 results."""
    from domains.groceries import mercadona_client
    results = mercadona_client.search(q)
    if results is None:
        return {"results": [], "available": False,
                "message": "mercadona-cli not installed on this host"}
    return {"results": results, "available": True}


# ─── Prices ──────────────────────────────────────────────────────────────────

@router.get("/prices/{item_id}/history")
def price_history(item_id: str, days: int = Query(90)):
    item = pantry_db.get_pantry_item(item_id)
    if not item:
        raise HTTPException(404, "Pantry item not found")
    history = pantry_db.get_price_history(item_id, days=days)
    return {"item": item, "history": history}


@router.post("/prices/sync")
def trigger_price_sync():
    """Fetch current prices from Mercadona CLI for all pantry items with a mercadona_id."""
    result = sync_prices()
    return result


# ─── Purchases ───────────────────────────────────────────────────────────────

@router.get("/purchases")
def list_purchases(conn: DB, month: Optional[str] = Query(None)):
    """List purchases. month=YYYY-MM filters by month."""
    q = """
        SELECT p.*, COUNT(pi.id) AS item_count
        FROM grocery_purchases p
        LEFT JOIN grocery_purchase_items pi ON pi.purchase_id = p.id
    """
    params: list = []
    if month:
        q += " WHERE strftime('%Y-%m', p.date) = ?"
        params.append(month)
    q += " GROUP BY p.id ORDER BY p.date DESC"
    rows = conn.execute(q, params).fetchall()
    return [dict(r) for r in rows]


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: str, conn: DB):
    purchase = conn.execute(
        "SELECT * FROM grocery_purchases WHERE id = ?", (purchase_id,)
    ).fetchone()
    if not purchase:
        raise HTTPException(404, "Purchase not found")
    items = conn.execute(
        "SELECT * FROM grocery_purchase_items WHERE purchase_id = ?", (purchase_id,)
    ).fetchall()
    return {"purchase": dict(purchase), "items": [dict(i) for i in items]}


class PurchaseItemIn(BaseModel):
    raw_name: str
    qty: Optional[float] = None
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    pantry_item_id: Optional[str] = None


class PurchaseCreate(BaseModel):
    date: str
    total_eur: Optional[float] = None
    store: str = "mercadona"
    source: str = "receipt"
    items: list[PurchaseItemIn] = []


@router.post("/purchases", status_code=201)
def create_purchase(body: PurchaseCreate, conn: DB):
    purchase_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO grocery_purchases (id, date, total_eur, store, source) VALUES (?,?,?,?,?)",
        (purchase_id, body.date, body.total_eur, body.store, body.source),
    )
    for item in body.items:
        conn.execute(
            """INSERT INTO grocery_purchase_items
               (purchase_id, pantry_item_id, raw_name, qty, unit_price, total_price)
               VALUES (?,?,?,?,?,?)""",
            (purchase_id, item.pantry_item_id, item.raw_name, item.qty, item.unit_price, item.total_price),
        )
    conn.commit()
    return {"id": purchase_id, "date": body.date, "item_count": len(body.items)}


# ─── Receipt parsing ──────────────────────────────────────────────────────────

class ReceiptParseRequest(BaseModel):
    ocr_lines: list[str]
    store: Optional[str] = None


@router.post("/receipts/parse")
def parse_receipt(body: ReceiptParseRequest):
    """
    Accept raw OCR text lines (from Apple Vision on iOS).
    Use Ollama to extract structured line items.
    Returns list of {raw_name, qty, unit_price, total_price} dicts.
    """
    if not ollama_client.is_available():
        return {"items": [], "raw_line_count": len(body.ocr_lines), "available": False,
                "message": "AI parsing unavailable — make sure the HP is on and Ollama is running."}

    raw_text = "\n".join(body.ocr_lines)
    store_hint = f" from {body.store}" if body.store else ""
    prompt = f"""Extract grocery line items from the following receipt text{store_hint}.
Return a JSON array where each item has these fields:
- "raw_name": the product name as it appears on the receipt (string)
- "qty": quantity purchased (number or null)
- "unit_price": price per unit in euros (number or null)
- "total_price": total line price in euros (number or null)

Skip lines that are not products (total, tax, store name, date, loyalty points, etc.).
Return only the JSON array, no commentary.

Receipt text:
{raw_text}

JSON:"""

    result = ollama_client.generate_json(prompt)
    if result is None:
        return {"items": [], "raw_line_count": len(body.ocr_lines), "available": True,
                "message": "AI could not parse this receipt — try again or enter items manually."}

    items = result if isinstance(result, list) else result.get("items", [])

    # Attempt fuzzy match against pantry items
    pantry = pantry_db.list_pantry()
    pantry_names = {i["name"].lower(): i["id"] for i in pantry}
    for item in items:
        name_lower = item.get("raw_name", "").lower()
        # Simple substring match — good enough for receipt parsing
        for pantry_name, pantry_id in pantry_names.items():
            if pantry_name in name_lower or name_lower in pantry_name:
                item["pantry_item_id"] = pantry_id
                break

    return {"items": items, "raw_line_count": len(body.ocr_lines)}


# ─── Price comparison ────────────────────────────────────────────────────────

@router.get("/price-comparison")
def price_comparison(conn: DB, months: int = Query(12)):
    """
    Return per-product price history across all scanned receipts.
    Used to show how product prices change over time.
    """
    rows = conn.execute(
        """
        SELECT
            pi.raw_name AS product,
            pi.pantry_item_id,
            p.date,
            strftime('%Y-%m', p.date) AS month,
            pi.unit_price,
            pi.total_price,
            pi.qty,
            p.store
        FROM grocery_purchase_items pi
        JOIN grocery_purchases p ON p.id = pi.purchase_id
        WHERE p.date >= date('now', ? || ' months')
          AND pi.unit_price IS NOT NULL
        ORDER BY pi.raw_name, p.date
        """,
        (f"-{months}",),
    ).fetchall()

    # Group by product name (or pantry_item_id if available)
    from collections import defaultdict
    products: dict = defaultdict(list)
    for r in rows:
        key = r["pantry_item_id"] or r["product"]
        products[key].append({
            "product": r["product"],
            "date": r["date"],
            "month": r["month"],
            "unit_price": r["unit_price"],
            "total_price": r["total_price"],
            "qty": r["qty"],
            "store": r["store"],
        })

    result = []
    for key, entries in products.items():
        prices = [e["unit_price"] for e in entries if e["unit_price"] is not None]
        result.append({
            "key": key,
            "name": entries[0]["product"],
            "entries": entries,
            "min_price": min(prices) if prices else None,
            "max_price": max(prices) if prices else None,
            "latest_price": entries[-1]["unit_price"] if entries else None,
            "price_change_pct": round(
                ((entries[-1]["unit_price"] - entries[0]["unit_price"]) / entries[0]["unit_price"]) * 100, 1
            ) if len(entries) >= 2 and entries[0]["unit_price"] else None,
        })

    result.sort(key=lambda x: abs(x["price_change_pct"] or 0), reverse=True)
    return result


# ─── Meal planning ────────────────────────────────────────────────────────────

class MealPlanRequest(BaseModel):
    meals: int = 5              # number of dinners to plan
    budget_eur: float = 60.0
    constraints: Optional[str] = None  # e.g. "no pork", "pescatarian this week"


@router.post("/meal-plan")
def generate_meal_plan(body: MealPlanRequest):
    """
    Ask Ollama to generate a weekly meal plan, then price each ingredient
    against the pantry (where available).
    """
    if not ollama_client.is_available():
        return {"available": False,
                "message": "Meal planning needs Ollama running on the HP. Make sure it's on and connected to the home network."}

    pantry = pantry_db.list_pantry()
    pantry_summary = ", ".join(i["name"] for i in pantry[:40]) if pantry else "no pantry items loaded yet"
    constraints_line = f"\nDietary constraints: {body.constraints}" if body.constraints else ""

    prompt = f"""You are a meal planner. Generate a {body.meals}-dinner weekly meal plan for one person on a €{body.budget_eur} weekly grocery budget.
For each meal, list the main ingredients needed and an estimated cost in euros.{constraints_line}

Available pantry items that may already be in stock: {pantry_summary}

Return a JSON object with this structure:
{{
  "meals": [
    {{
      "day": "Monday",
      "name": "Meal name",
      "ingredients": [
        {{"name": "ingredient", "qty": "amount", "estimated_eur": 0.00}}
      ],
      "meal_cost_eur": 0.00,
      "notes": "optional tip"
    }}
  ],
  "total_estimated_eur": 0.00,
  "shopping_list": [
    {{"name": "ingredient", "qty": "amount", "estimated_eur": 0.00}}
  ]
}}

JSON:"""

    result = ollama_client.generate_json(prompt, model=ollama_client.MODEL_DEFAULT)
    if result is None:
        return {"available": True,
                "message": "Ollama couldn't generate a plan this time — try again in a moment."}

    # Save to meal_plans table
    plan_id = str(uuid.uuid4())
    week_start = _current_week_monday()
    con = get_connection()
    con.execute(
        "INSERT INTO meal_plans (id, week_start, meals_json, budget_eur) VALUES (?,?,?,?)",
        (plan_id, week_start, json.dumps(result), body.budget_eur),
    )
    con.commit()
    con.close()

    return {"plan_id": plan_id, "week_start": week_start, **result}


@router.get("/meal-plan/latest")
def get_latest_meal_plan(conn: DB):
    row = conn.execute(
        "SELECT * FROM meal_plans ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    if not row:
        return {"plan": None}
    d = dict(row)
    d["meals_json"] = json.loads(d["meals_json"]) if d.get("meals_json") else None
    return {"plan": d}


def _current_week_monday() -> str:
    today = date.today()
    monday = today - __import__("datetime").timedelta(days=today.weekday())
    return monday.isoformat()
