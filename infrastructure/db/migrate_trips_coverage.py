"""
Trip dismissal + manual country visits.

- trips gains `hidden` (soft-delete; the nightly detector upserts by start/end
  and never touches this column, so a dismissed trip stays gone).
- new manual_country_visits table (countries visited before tracking existed,
  unioned into /locations/world-coverage).

Run once: python -m infrastructure.db.migrate_trips_coverage
Idempotent — safe to re-run.
"""

import sqlite3

from infrastructure.db.connection import get_connection


def _add_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        print(f"added {table}.{column}")
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            print(f"{table}.{column} already exists")
        else:
            raise


def migrate(conn: sqlite3.Connection) -> None:
    _add_column(conn, "trips", "hidden", "INTEGER NOT NULL DEFAULT 0")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS manual_country_visits (
            iso2 TEXT PRIMARY KEY,
            country TEXT NOT NULL,
            first_visit TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    print("manual_country_visits table ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
