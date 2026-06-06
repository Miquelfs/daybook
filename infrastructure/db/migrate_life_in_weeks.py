"""
Migration: Life in Weeks tables
Adds user_profile, life_periods, and life_events to daybook.db.
Safe to run multiple times (CREATE TABLE IF NOT EXISTS).

Run on Pi:
    cd ~/daybook && python -m infrastructure.db.migrate_life_in_weeks
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS user_profile (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            birthdate     TEXT NOT NULL,
            display_name  TEXT,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS life_periods (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            label       TEXT NOT NULL,
            category    TEXT NOT NULL,
            layer       TEXT NOT NULL DEFAULT 'main',
            color       TEXT NOT NULL,
            start_date  TEXT NOT NULL,
            end_date    TEXT,
            notes       TEXT,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            CHECK (category IN ('education','work','aviation','relationship','location','health','other')),
            CHECK (layer    IN ('main','top_stripe','bottom_stripe'))
        );

        CREATE INDEX IF NOT EXISTS idx_life_periods_start ON life_periods(start_date);
        CREATE INDEX IF NOT EXISTS idx_life_periods_end   ON life_periods(end_date);
        CREATE INDEX IF NOT EXISTS idx_life_periods_layer ON life_periods(layer);

        CREATE TABLE IF NOT EXISTS life_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            event_date  TEXT NOT NULL,
            label       TEXT NOT NULL,
            type        TEXT NOT NULL,
            notes       TEXT,
            photo_path  TEXT,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            CHECK (type IN ('career','relationship','travel','loss','achievement','other'))
        );

        CREATE INDEX IF NOT EXISTS idx_life_events_date ON life_events(event_date);
    """)
    conn.commit()
    print("Life in Weeks tables created (or already existed): user_profile, life_periods, life_events.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
