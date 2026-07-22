"""
Migration: add photo_caption column to days table (comment on the photo of the day).

Run on Pi:
    python3 infrastructure/db/migrate_photo_caption.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"


def migrate(db_path: Path = DB_PATH) -> None:
    con = sqlite3.connect(db_path)
    try:
        con.execute("ALTER TABLE days ADD COLUMN photo_caption TEXT")
        con.commit()
        print(f"✓ Added photo_caption column to days ({db_path})")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("Column photo_caption already exists — nothing to do.")
        else:
            raise
    finally:
        con.close()


if __name__ == "__main__":
    migrate()
