"""
Migration: add intraday_hr table for continuous 15-min HR readings (Horizon 1 data layer).

Run on Pi:
    python3 infrastructure/db/migrate_intraday_hr.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"

_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS intraday_hr (
        date        TEXT NOT NULL,
        time        TEXT NOT NULL,       -- HH:MM local time
        heart_rate  INTEGER NOT NULL,    -- bpm
        PRIMARY KEY (date, time)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_intraday_hr_date ON intraday_hr(date)",
]


def migrate(db_path: Path = DB_PATH) -> None:
    con = sqlite3.connect(db_path)
    try:
        for stmt in _STATEMENTS:
            try:
                con.execute(stmt)
                con.commit()
            except sqlite3.OperationalError as e:
                if "already exists" in str(e):
                    print("  intraday_hr already exists — nothing to do.")
                else:
                    raise
        print(f"✓ intraday_hr table ready ({db_path})")
    finally:
        con.close()


if __name__ == "__main__":
    migrate()
