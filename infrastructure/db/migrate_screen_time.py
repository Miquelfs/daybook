"""
Idempotent migration: create screen_time and screen_app_usage tables.
Safe to re-run. Run once on Pi before first sync.

Usage:
    python -m infrastructure.db.migrate_screen_time
    # or directly:
    python infrastructure/db/migrate_screen_time.py
"""

import sqlite3
from pathlib import Path

ROOT = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "daybook.db"


def run() -> None:
    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS screen_time (
            date            TEXT PRIMARY KEY,
            total_minutes   REAL,
            unlocks         INTEGER,
            top_app         TEXT,
            top_app_name    TEXT,
            top_app_minutes REAL,
            raw_payload     TEXT,
            synced_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screen_app_usage (
            date        TEXT NOT NULL,
            bundle_id   TEXT NOT NULL,
            app_name    TEXT,
            minutes     REAL,
            PRIMARY KEY (date, bundle_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_screen_app_date ON screen_app_usage(date)"
    )
    conn.commit()
    conn.close()
    print("Done: screen_time and screen_app_usage tables ready.")


if __name__ == "__main__":
    run()
