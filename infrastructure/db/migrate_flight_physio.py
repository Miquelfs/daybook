"""
Persisted per-flight physiological load (CIRQA), so the takeoff/landing HR and
stress spikes become queryable and correlatable — per airport, per phase
(takeoff vs landing), per captain (crew), and later against weather.

The live computation lives in domains/health/stress_context.py; this table is
the durable snapshot written by domains/health/flight_physio.py so we can roll
it up across all of your flying without recomputing intraday windows each time.

Idempotent. Run: python -m infrastructure.db.migrate_flight_physio
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS flight_physio (
            flight_id            TEXT PRIMARY KEY,
            date                 TEXT NOT NULL,
            dep_iata             TEXT,
            arr_iata             TEXT,
            takeoff_hr           REAL,
            takeoff_hr_delta     REAL,
            takeoff_stress       REAL,
            takeoff_stress_delta REAL,
            takeoff_crew         TEXT,
            takeoff_you_flew     INTEGER,     -- 1 if you were the pilot flying
            landing_hr           REAL,
            landing_hr_delta     REAL,
            landing_stress       REAL,
            landing_stress_delta REAL,
            landing_crew         TEXT,
            landing_you_flew     INTEGER,
            updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_flight_physio_date ON flight_physio(date);
        CREATE INDEX IF NOT EXISTS idx_flight_physio_arr  ON flight_physio(arr_iata);
        CREATE INDEX IF NOT EXISTS idx_flight_physio_dep  ON flight_physio(dep_iata);
    """)
    conn.commit()
    print("flight_physio table ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
