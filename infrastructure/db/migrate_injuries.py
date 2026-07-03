"""
Add injuries table to daybook.db.
Run once: python -m infrastructure.db.migrate_injuries
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS injuries (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            zone          TEXT NOT NULL,
            side          TEXT,
            pain_scale    INTEGER NOT NULL,
            status        TEXT NOT NULL DEFAULT 'active',
            onset_date    TEXT NOT NULL,
            resolved_date TEXT,
            notes         TEXT,
            mechanism     TEXT,
            activity_type TEXT,
            activity_id   TEXT,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_injuries_status      ON injuries(status);
        CREATE INDEX IF NOT EXISTS idx_injuries_onset_date  ON injuries(onset_date);
        CREATE INDEX IF NOT EXISTS idx_injuries_zone        ON injuries(zone);
        CREATE INDEX IF NOT EXISTS idx_injuries_activity_id ON injuries(activity_id);
    """)
    conn.commit()
    print("injuries table created (or already existed).")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
