"""
Adaptation history log — one row per Omyra re-evaluation of a goal.
Lets the UI show why volume/intensity changed week to week, and preserves the
inputs (readiness/risk/tsb/compliance) that drove each decision.

Idempotent. Run: python -m infrastructure.db.migrate_adaptation_log
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS adaptation_log (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id          INTEGER NOT NULL REFERENCES race_goals(id) ON DELETE CASCADE,
            date             TEXT NOT NULL,
            week_number      INTEGER,
            readiness_score  REAL,
            risk_level       TEXT,
            recommendation   TEXT,
            volume_factor    REAL,
            intensity_factor REAL,
            inputs_json      TEXT,
            narrative        TEXT,
            created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_adaptation_log_goal ON adaptation_log(goal_id, date);
    """)
    conn.commit()
    print("adaptation_log table ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
