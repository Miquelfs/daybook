"""Initialize and seed money.db. Safe to run multiple times."""

import sqlite3
from pathlib import Path

from infrastructure.db.money_connection import get_money_connection, MONEY_DB_PATH
from domains.money.money_config import BUDGET_VERSIONS

SCHEMA_PATH = Path(__file__).parents[2] / "infrastructure" / "db" / "money_schema.sql"


def init_money_db(db_path: Path = MONEY_DB_PATH) -> None:
    """Create money.db and run the schema DDL. Idempotent.

    Ordering: ALTERs run FIRST so that the schema's CREATE INDEX statements
    against the new columns succeed on pre-existing tables. Each ALTER is
    silently ignored if the table doesn't exist yet OR the column is already there.
    """
    conn = get_money_connection(db_path)

    for stmt in [
        "ALTER TABLE holdings ADD COLUMN isin TEXT",
    ]:
        try:
            conn.execute(stmt)
        except Exception:
            pass  # column already exists or table not created yet — fine either way
    conn.commit()

    conn.executescript(SCHEMA_PATH.read_text())
    conn.commit()
    conn.close()
    print(f"money.db initialized at {db_path}")


def seed_budgets(conn: sqlite3.Connection) -> int:
    """Insert all BUDGET_VERSIONS rows. Skips existing rows. Returns count inserted."""
    inserted = 0
    for year_month, cats in BUDGET_VERSIONS.items():
        for category, amount in cats.items():
            cur = conn.execute(
                "INSERT OR IGNORE INTO budgets (year_month, category, amount) VALUES (?,?,?)",
                (year_month, category, amount),
            )
            inserted += cur.rowcount
    conn.commit()
    return inserted


if __name__ == "__main__":
    init_money_db()
    conn = get_money_connection()
    n = seed_budgets(conn)
    conn.close()
    print(f"Seeded {n} budget rows.")
