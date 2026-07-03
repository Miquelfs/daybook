"""
Migration: add error_log column to days table.

Run on Pi:
    python3 infrastructure/db/migrate_add_error_log.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"


def migrate(db_path: Path = DB_PATH) -> None:
    con = sqlite3.connect(db_path)
    try:
        con.execute("ALTER TABLE days ADD COLUMN error_log TEXT")
        con.commit()
        print(f"✓ Added error_log column to days ({db_path})")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("Column error_log already exists — nothing to do.")
        else:
            raise
    finally:
        con.close()


if __name__ == "__main__":
    migrate()
