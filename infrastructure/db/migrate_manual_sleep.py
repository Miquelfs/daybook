"""
Migration: allow manually-logged sleep (for nights the watch died / wasn't worn).

Adds to the `sleep` table:
  source      TEXT DEFAULT 'garmin'  — 'garmin' for synced rows, 'manual' for hand-entered ones
  start_time  TEXT                   — manual entries only, "HH:MM"
  end_time    TEXT                   — manual entries only, "HH:MM"

Existing rows get source='garmin' via the column default. duration_seconds
(the column every dashboard/correlation query already reads) is left as-is
for those rows and is computed from start/end for manual ones.

Run on Pi:
    python3 infrastructure/db/migrate_manual_sleep.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"

_COLUMNS = [
    ("source", "TEXT DEFAULT 'garmin'"),
    ("start_time", "TEXT"),
    ("end_time", "TEXT"),
]


def migrate(db_path: Path = DB_PATH) -> None:
    con = sqlite3.connect(db_path)
    try:
        existing = {r[1] for r in con.execute("PRAGMA table_info(sleep)")}
        for name, ddl in _COLUMNS:
            if name in existing:
                print(f"Column {name} already exists — skipping.")
                continue
            con.execute(f"ALTER TABLE sleep ADD COLUMN {name} {ddl}")
            print(f"✓ Added {name} column to sleep")
        con.commit()
    finally:
        con.close()


if __name__ == "__main__":
    migrate(DB_PATH)
