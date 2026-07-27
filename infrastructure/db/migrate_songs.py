"""
Add songs table to daybook.db — the "song of the day" log.

One row per song that accompanied a given day (usually one/day, but multiple is
allowed). Optional YouTube Music URL powers the year-end playlist export.

Run once on the Pi: python -m infrastructure.db.migrate_songs
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS songs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            date         TEXT NOT NULL,      -- YYYY-MM-DD, the day it soundtracked
            title        TEXT NOT NULL,
            artist       TEXT,
            album        TEXT,
            url          TEXT,               -- YouTube Music (or any) link, optional
            rating       INTEGER,            -- 1-5, NULL = unrated
            mood         TEXT,               -- optional vibe/context
            notes        TEXT,
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_songs_date   ON songs(date);
        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
    """)
    conn.commit()
    print("songs table created (or already existed).")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
