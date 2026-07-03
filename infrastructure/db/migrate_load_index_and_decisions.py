"""
Migration: add load_index and decisions tables.

Run on Pi:
    python3 infrastructure/db/migrate_load_index_and_decisions.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"

_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS load_index (
        date             TEXT PRIMARY KEY,
        fatigue_score    REAL,       -- composite 0-100, higher = more fatigued
        hrv_load         REAL,       -- HRV deviation from 7-day baseline (lower HRV → higher load)
        sleep_debt       REAL,       -- hours of sleep deficit vs 8h target (cumulative 3-day)
        tss_load         REAL,       -- training stress score from activities (same day)
        timezone_penalty REAL,       -- hours of timezone displacement
        duty_load        REAL,       -- consecutive duty days factor
        recovery_status  TEXT,       -- "recovering", "balanced", "accumulating"
        computed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS decisions (
        id               TEXT PRIMARY KEY,   -- UUID
        date             TEXT NOT NULL,      -- date the decision was logged (FK days.date)
        description      TEXT NOT NULL,      -- what you decided
        expected_outcome TEXT,               -- what you predict will happen
        confidence       INTEGER,            -- 1-10: how sure are you?
        horizon_date     TEXT,               -- when to resurface (YYYY-MM-DD)
        actual_outcome   TEXT,               -- filled in when horizon_date arrives
        outcome_score    INTEGER,            -- 1-10: how close was the prediction?
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        resolved_at      TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_decisions_date ON decisions(date)",
    "CREATE INDEX IF NOT EXISTS idx_decisions_horizon ON decisions(horizon_date) WHERE horizon_date IS NOT NULL",
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
                    print(f"  already exists — skipping")
                else:
                    raise
        print(f"✓ load_index and decisions tables ready ({db_path})")
    finally:
        con.close()


if __name__ == "__main__":
    migrate()
