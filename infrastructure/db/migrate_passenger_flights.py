"""
Passenger-flight logbook — flights taken as a *passenger*, kept entirely separate
from the pilot flight log (roster / duty flights). One row per sector.

Seeded historically from a Notion export; going forward, added via the day FAB
and the /explore/passenger-flights database page.

Run once on the Pi: python -m infrastructure.db.migrate_passenger_flights
(also runs automatically on API startup).
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS passenger_flights (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            date           TEXT NOT NULL,      -- YYYY-MM-DD, day of the flight
            flight_number  TEXT,               -- e.g. FR524
            origin         TEXT,               -- IATA, e.g. BCN
            destination    TEXT,               -- IATA, e.g. TFN
            airline        TEXT,               -- "company", e.g. Ryanair
            aircraft       TEXT,               -- type, e.g. B737-8200
            price_paid     REAL,               -- ticket price in EUR (NULL = unknown)
            reason         TEXT,               -- free-text reason for the trip
            commuting      INTEGER NOT NULL DEFAULT 0,  -- 1 = work commute
            companion      TEXT,               -- who I flew with, optional
            seat           TEXT,               -- seat, optional
            duration_hours REAL,               -- block hours, optional
            notes          TEXT,
            created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_pax_flights_date    ON passenger_flights(date);
        CREATE INDEX IF NOT EXISTS idx_pax_flights_airline ON passenger_flights(airline);
    """)

    # Richer columns (added incrementally) so the logbook can drive a
    # MyFlightRadar-style dashboard: resolved airports for the map + distances,
    # airline/aircraft codes, and cabin/seat/times metadata.
    _extra = {
        "dep_icao": "TEXT",
        "arr_icao": "TEXT",
        "airline_code": "TEXT",       # IATA airline code, e.g. FR
        "aircraft_code": "TEXT",      # ICAO type code, e.g. B738
        "registration": "TEXT",
        "seat_type": "TEXT",          # Window / Middle / Aisle
        "flight_class": "TEXT",       # Economy / Economy+ / Business / First
        "dep_time": "TEXT",           # HH:MM local
        "arr_time": "TEXT",
        "distance_km": "REAL",        # great-circle dep→arr
    }
    existing = {r[1] for r in conn.execute("PRAGMA table_info(passenger_flights)")}
    for col, typ in _extra.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE passenger_flights ADD COLUMN {col} {typ}")

    conn.execute("CREATE INDEX IF NOT EXISTS idx_pax_flights_dep ON passenger_flights(dep_icao)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pax_flights_arr ON passenger_flights(arr_icao)")

    conn.commit()
    print("passenger_flights table created / upgraded.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
