"""
App-wide key/value settings — server-side preferences for this single-user app.

Currently holds the UI theme ('light' | 'dark'). Storing it here (not in a
browser cookie / localStorage) makes it immune to iOS Safari's storage eviction
and consistent across every device: the server renders the chosen theme on every
request, so a refresh can never fall back to the dark default on its own.

Idempotent. Run: python -m infrastructure.db.migrate_settings
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("app_settings ready")
