"""
Migration: add AI columns to days table and create ai_narratives table.

Run on Pi:
    python3 infrastructure/db/migrate_ai.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"


def migrate(db_path: Path = DB_PATH) -> None:
    con = sqlite3.connect(db_path)
    try:
        # Add morning_brief_text to days
        try:
            con.execute("ALTER TABLE days ADD COLUMN morning_brief_text TEXT")
            con.commit()
            print("✓ Added morning_brief_text column to days")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("Column morning_brief_text already exists — skipping")
            else:
                raise

        # Create ai_narratives table for on-demand health narratives
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_narratives (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                topic       TEXT NOT NULL,     -- sleep | hrv | training | load
                date_range  TEXT NOT NULL,     -- e.g. '2026-06-14:2026-06-28'
                text        TEXT NOT NULL,
                model       TEXT,
                generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
        """)
        # Index for fast lookup by topic + date range
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_narratives_topic_range
            ON ai_narratives (topic, date_range)
        """)
        con.commit()
        print("✓ Created ai_narratives table")

    finally:
        con.close()


if __name__ == "__main__":
    migrate()
