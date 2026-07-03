"""Add experiments table for H3 N-of-1 experiment tracking."""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"

def migrate(db_path: Path = DB_PATH) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS experiments (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            hypothesis   TEXT NOT NULL,
            protocol     TEXT,
            tag                TEXT,
            metric             TEXT,
            outcome_threshold  REAL,
            start_date         TEXT NOT NULL,
            end_date     TEXT,
            status       TEXT NOT NULL DEFAULT 'active',
            result       TEXT,
            effect_size  REAL,
            p_value      REAL,
            notes        TEXT,
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    """)
    conn.commit()
    conn.close()
    print("✓ experiments table ready")

if __name__ == "__main__":
    migrate()
