"""
Add race_goals and plan_sessions tables to daybook.db.
Run once: python -m infrastructure.db.migrate_race_plans
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS race_goals (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            name                 TEXT NOT NULL,
            race_type            TEXT NOT NULL,
            variant              TEXT NOT NULL DEFAULT 'balanced',
            race_date            TEXT NOT NULL,
            plan_start_date      TEXT,
            status               TEXT NOT NULL DEFAULT 'active',
            available_days       TEXT NOT NULL,
            respect_roster       INTEGER NOT NULL DEFAULT 1,
            volume_factor        REAL NOT NULL DEFAULT 1.0,
            intensity_factor     REAL NOT NULL DEFAULT 1.0,
            last_adaptation_json TEXT,
            notes                TEXT,
            created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS plan_sessions (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id                 INTEGER NOT NULL REFERENCES race_goals(id) ON DELETE CASCADE,
            session_date            TEXT NOT NULL,
            original_date           TEXT NOT NULL,
            week_number             INTEGER NOT NULL,
            session_type            TEXT NOT NULL,
            discipline              TEXT NOT NULL,
            duration_min            INTEGER NOT NULL,
            intensity_zone          TEXT NOT NULL,
            is_optional             INTEGER NOT NULL DEFAULT 0,
            is_displaced            INTEGER NOT NULL DEFAULT 0,
            effective_duration_min  INTEGER,
            status                  TEXT NOT NULL DEFAULT 'pending',
            completed_activity_id   TEXT,
            rpe_actual              INTEGER,
            notes                   TEXT,
            created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_race_goals_status          ON race_goals(status);
        CREATE INDEX IF NOT EXISTS idx_race_goals_race_date       ON race_goals(race_date);
        CREATE INDEX IF NOT EXISTS idx_plan_sessions_goal         ON plan_sessions(goal_id);
        CREATE INDEX IF NOT EXISTS idx_plan_sessions_date         ON plan_sessions(session_date);
        CREATE INDEX IF NOT EXISTS idx_plan_sessions_original     ON plan_sessions(original_date);
        CREATE INDEX IF NOT EXISTS idx_plan_sessions_status       ON plan_sessions(status, session_date);
    """)
    conn.commit()
    print("race_goals and plan_sessions tables created (or already existed).")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
