"""
Ask — questions put to your own data, answered by Claude reading the databases.

  ask_threads    one per conversation; `title` is the first question.
  ask_messages   the turns. role user | assistant; `queries_json` holds the SQL the
                 answer was built on (list of {sql, rows, error}) so it can be shown.

Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_ask
"""

from infrastructure.db.connection import get_connection


def migrate(conn) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ask_threads (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS ask_messages (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id     INTEGER NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
            role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content       TEXT NOT NULL,
            queries_json  TEXT,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ask_messages_thread ON ask_messages(thread_id);
    """)
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("ask tables ready")
