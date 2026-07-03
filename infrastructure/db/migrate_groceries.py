"""
Migration: create groceries tables (pantry_items, price_history, meal_plans,
grocery_purchases, grocery_purchase_items).

Run on Pi:
    python3 infrastructure/db/migrate_groceries.py
"""

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "groceries_schema.sql"
DB_PATH = Path(__file__).parent / "daybook.db"


def migrate(db_path: Path = DB_PATH) -> None:
    sql = SCHEMA_PATH.read_text()
    con = sqlite3.connect(db_path)
    try:
        con.executescript(sql)
        con.commit()
        print("✓ Groceries tables created (or already exist)")
    finally:
        con.close()


if __name__ == "__main__":
    migrate()
