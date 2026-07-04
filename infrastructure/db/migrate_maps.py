"""
Maps narrative layer (Plan Phase B):
- life_periods gains centroid_lat / centroid_lng / home_radius_km (home-base anchor)
- new trips table (auto-detected trips, upserted nightly by trip_detection.py)

Run once: python -m infrastructure.db.migrate_maps
Idempotent — safe to re-run.
"""

import sqlite3
from pathlib import Path

from infrastructure.db.connection import get_connection

_LOCATIONS_DB = Path(__file__).parent / "locations.db"


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
    _add_column(conn, "life_periods", "centroid_lat", "REAL")
    _add_column(conn, "life_periods", "centroid_lng", "REAL")
    _add_column(conn, "life_periods", "home_radius_km", "REAL DEFAULT 40")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            primary_country TEXT,
            countries_json TEXT,
            cities_json TEXT,
            total_km REAL,
            max_distance_from_home_km REAL,
            auto_name TEXT,
            user_name TEXT,
            cover_photo_path TEXT,
            home_at_start TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(start_date, end_date)
        );
        CREATE INDEX IF NOT EXISTS idx_trips_dates ON trips(start_date, end_date);
    """)
    conn.commit()
    print("trips table ready.")


def migrate_locations() -> None:
    """Indexes for the fun-facts compass/altitude queries (overland grows daily)."""
    if not _LOCATIONS_DB.exists():
        print("locations.db not found — skipping index migration")
        return
    con = sqlite3.connect(_LOCATIONS_DB)
    con.executescript("""
        CREATE INDEX IF NOT EXISTS idx_overland_lat ON overland_locations(lat);
        CREATE INDEX IF NOT EXISTS idx_overland_lng ON overland_locations(lng);
        CREATE INDEX IF NOT EXISTS idx_overland_alt ON overland_locations(altitude);
    """)
    con.commit()
    con.close()
    print("overland lat/lng/altitude indexes ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
    migrate_locations()
