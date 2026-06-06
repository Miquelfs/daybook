"""
Add books table to daybook.db.
Run once: python -m infrastructure.db.migrate_books
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS books (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT NOT NULL,
            author          TEXT NOT NULL,
            date_finished   TEXT,           -- YYYY-MM-DD, NULL = reading/wishlist
            genre           TEXT,
            language        TEXT,
            location        TEXT,           -- where they were when they read it
            ownership       TEXT,           -- 'own' | 'kindle' | 'library'
            pages           INTEGER,
            rating          INTEGER,        -- 1-5, NULL = unrated
            notes           TEXT,
            gift_from       TEXT,           -- person name, NULL if not a gift
            cover_url       TEXT,           -- URL from Open Library / Google Books
            isbn            TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_books_date_finished ON books(date_finished);
        CREATE INDEX IF NOT EXISTS idx_books_author        ON books(author);
        CREATE INDEX IF NOT EXISTS idx_books_genre         ON books(genre);
    """)
    conn.commit()
    print("books table created (or already existed).")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
