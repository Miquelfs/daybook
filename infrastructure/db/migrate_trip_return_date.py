"""
Trips gain `return_date` — the day you travelled back and slept at home again.

Auto-detected trips end on the LAST away night (last night not slept at home).
The following day, when you fly/drive home and sleep in your own bed, is part of
the trip experientially (photos, spending, the journey home) but was excluded
because it's a home night. `return_date` records that home-coming day so the
trip detail/card can show the full span while `n_nights` stays = nights away.

Run once: python -m infrastructure.db.migrate_trip_return_date
Idempotent — safe to re-run. Also invoked from the API startup hook.
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
    _add_column(conn, "trips", "return_date", "TEXT")
    conn.commit()


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
    print("trips.return_date ready.")
