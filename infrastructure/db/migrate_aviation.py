"""
Add airports + flights tables to daybook.db, then seed airports from data/raw/aviation/Airports.csv.
Run once: python -m infrastructure.db.migrate_aviation
"""

import csv
from pathlib import Path

from infrastructure.db.connection import get_connection

ROOT = Path(__file__).parents[2]
AIRPORTS_CSV = ROOT / "data" / "raw" / "aviation" / "Airports.csv"

DDL = """
-- ─── Aviation Logbook ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS airports (
    icao         TEXT PRIMARY KEY,
    iata         TEXT,
    name         TEXT,
    city         TEXT,
    country      TEXT,
    latitude     REAL,
    longitude    REAL,
    elevation_ft INTEGER,
    timezone     TEXT
);

CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata);
CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country);

CREATE TABLE IF NOT EXISTS flights (
    id                  TEXT PRIMARY KEY,
    date                TEXT NOT NULL,
    source              TEXT NOT NULL,
    raw_payload         TEXT NOT NULL DEFAULT '{}',

    dep_icao            TEXT,
    arr_icao            TEXT,
    dep_iata            TEXT,
    arr_iata            TEXT,

    off_block_utc       TEXT,
    takeoff_utc         TEXT,
    landing_utc         TEXT,
    on_block_utc        TEXT,
    block_seconds       INTEGER,
    airborne_seconds    INTEGER,

    flight_number       TEXT,
    aircraft_reg        TEXT,
    aircraft_type       TEXT,
    operator            TEXT,

    crew_role           TEXT,
    takeoff_crew        TEXT,
    landing_crew        TEXT,
    is_sim              INTEGER NOT NULL DEFAULT 0,
    sim_type            TEXT,

    pic_seconds         INTEGER NOT NULL DEFAULT 0,
    sic_seconds         INTEGER NOT NULL DEFAULT 0,
    night_seconds       INTEGER NOT NULL DEFAULT 0,
    ifr_seconds         INTEGER NOT NULL DEFAULT 0,
    distance_nm         REAL,

    pax_total           INTEGER,
    pax_adult           INTEGER,
    pax_child           INTEGER,
    pax_infant          INTEGER,
    freight_kg          REAL,

    fuel_block_kg       REAL,
    fuel_trip_kg        REAL,
    fuel_reserves_kg    REAL,
    fuel_uplift_kg      REAL,
    fuel_burn_kg        REAL,
    fuel_burn_diff_kg   REAL,

    delay_minutes       INTEGER,
    delay_code          TEXT,
    delay_reason        TEXT,

    takeoffs_day        INTEGER NOT NULL DEFAULT 0,
    takeoffs_night      INTEGER NOT NULL DEFAULT 0,
    landings_day        INTEGER NOT NULL DEFAULT 0,
    landings_night      INTEGER NOT NULL DEFAULT 0,

    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (date)     REFERENCES days(date),
    FOREIGN KEY (dep_icao) REFERENCES airports(icao),
    FOREIGN KEY (arr_icao) REFERENCES airports(icao)
);

CREATE INDEX IF NOT EXISTS idx_flights_date   ON flights(date);
CREATE INDEX IF NOT EXISTS idx_flights_dep    ON flights(dep_icao);
CREATE INDEX IF NOT EXISTS idx_flights_arr    ON flights(arr_icao);
CREATE INDEX IF NOT EXISTS idx_flights_type   ON flights(aircraft_type);
CREATE INDEX IF NOT EXISTS idx_flights_role   ON flights(crew_role);
CREATE INDEX IF NOT EXISTS idx_flights_source ON flights(source);
"""


def _seed_airports(conn) -> int:
    if not AIRPORTS_CSV.exists():
        print(f"  Airports.csv not found at {AIRPORTS_CSV}, skipping seed.")
        return 0

    rows = []
    with open(AIRPORTS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            icao = (row.get("ICAO Code") or "").strip()
            if not icao:
                continue
            try:
                lat = float(row.get("Latitude") or 0)
                lon = float(row.get("Longitude") or 0)
            except ValueError:
                lat, lon = None, None
            try:
                elev = int(float(row.get("Elevation (ft)") or 0))
            except ValueError:
                elev = None
            rows.append((
                icao,
                (row.get("IATA Code") or "").strip() or None,
                (row.get("Aiport Name") or row.get("Airport Name") or "").strip() or None,
                (row.get("City") or "").strip() or None,
                (row.get("Country") or "").strip() or None,
                lat,
                lon,
                elev,
                (row.get("Region") or "").strip() or None,
            ))

    conn.executemany(
        """INSERT OR IGNORE INTO airports
           (icao, iata, name, city, country, latitude, longitude, elevation_ft, timezone)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    conn.commit()
    return len(rows)


def migrate(conn):
    conn.executescript(DDL)
    conn.commit()
    print("airports + flights tables created (or already existed).")

    n = _seed_airports(conn)
    print(f"Seeded {n} airports (INSERT OR IGNORE — duplicates skipped).")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
