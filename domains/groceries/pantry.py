"""
Pantry CRUD and price-history helpers.
All writes go to daybook.db (groceries tables created by migrate_groceries.py).
"""

import sqlite3
import uuid
from datetime import date
from typing import Optional

from infrastructure.db.connection import get_connection


def _con() -> sqlite3.Connection:
    return get_connection()


# ---------------------------------------------------------------------------
# Pantry items
# ---------------------------------------------------------------------------

def list_pantry(active_only: bool = True) -> list[dict]:
    con = _con()
    q = "SELECT * FROM pantry_items"
    if active_only:
        q += " WHERE is_active = 1"
    q += " ORDER BY category, name"
    rows = con.execute(q).fetchall()
    con.close()
    return [dict(r) for r in rows]


def get_pantry_item(item_id: str) -> Optional[dict]:
    con = _con()
    row = con.execute("SELECT * FROM pantry_items WHERE id = ?", (item_id,)).fetchone()
    con.close()
    return dict(row) if row else None


def add_pantry_item(
    name: str,
    mercadona_id: Optional[str] = None,
    unit: Optional[str] = None,
    category: Optional[str] = None,
) -> dict:
    con = _con()
    # If same mercadona_id already exists, return it instead of failing
    if mercadona_id:
        existing = con.execute(
            "SELECT * FROM pantry_items WHERE mercadona_id = ?", (mercadona_id,)
        ).fetchone()
        if existing:
            con.close()
            return dict(existing)
    item_id = name.lower().replace(" ", "-").replace("/", "-")[:60] + "-" + uuid.uuid4().hex[:6]
    con.execute(
        "INSERT INTO pantry_items (id, mercadona_id, name, unit, category) VALUES (?,?,?,?,?)",
        (item_id, mercadona_id, name, unit, category),
    )
    con.commit()
    row = con.execute("SELECT * FROM pantry_items WHERE id = ?", (item_id,)).fetchone()
    con.close()
    return dict(row)


def update_pantry_item(item_id: str, **fields) -> Optional[dict]:
    allowed = {"name", "mercadona_id", "unit", "category", "is_active"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_pantry_item(item_id)
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    con = _con()
    con.execute(
        f"UPDATE pantry_items SET {set_clause} WHERE id = ?",
        (*updates.values(), item_id),
    )
    con.commit()
    row = con.execute("SELECT * FROM pantry_items WHERE id = ?", (item_id,)).fetchone()
    con.close()
    return dict(row) if row else None


def delete_pantry_item(item_id: str) -> bool:
    con = _con()
    cur = con.execute("UPDATE pantry_items SET is_active = 0 WHERE id = ?", (item_id,))
    con.commit()
    con.close()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Price history
# ---------------------------------------------------------------------------

def get_price_history(item_id: str, days: int = 90) -> list[dict]:
    con = _con()
    rows = con.execute(
        """
        SELECT date, price_eur, unit_price, store
        FROM price_history
        WHERE item_id = ?
          AND date >= date('now', ? || ' days')
        ORDER BY date
        """,
        (item_id, f"-{days}"),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def upsert_price(
    item_id: str,
    price_eur: float,
    unit_price: Optional[float] = None,
    store: str = "mercadona",
    raw_payload: Optional[str] = None,
    on_date: Optional[str] = None,
) -> None:
    d = on_date or date.today().isoformat()
    con = _con()
    existing = con.execute(
        "SELECT id FROM price_history WHERE item_id = ? AND date = ? AND store = ?",
        (item_id, d, store),
    ).fetchone()
    if existing:
        con.execute(
            "UPDATE price_history SET price_eur=?, unit_price=?, raw_payload=? WHERE id=?",
            (price_eur, unit_price, raw_payload, existing["id"]),
        )
    else:
        con.execute(
            "INSERT INTO price_history (item_id, date, price_eur, unit_price, store, raw_payload) VALUES (?,?,?,?,?,?)",
            (item_id, d, price_eur, unit_price, store, raw_payload),
        )
    con.commit()
    con.close()
