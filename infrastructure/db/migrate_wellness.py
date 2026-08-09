"""
All-day wellness tables — for the Garmin CIRQA (or any Garmin worn 24/7).

The base daily_stats table only keeps daily summaries (avg stress, body-battery
min/max). The CIRQA streams continuous stress, Body Battery, respiration and
SpO2 all day — this captures those:

- intraday_stress         per-sample all-day stress (level 0-100; <0 = unmeasured)
- intraday_body_battery   per-sample Body Battery (energy) 0-100
- wellness_daily          daily aggregates for correlations + the recovery flag

Idempotent. Run: python -m infrastructure.db.migrate_wellness
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS intraday_stress (
            date       TEXT NOT NULL,
            time       TEXT NOT NULL,        -- local HH:MM
            level      INTEGER NOT NULL,     -- 0-100 stress; negative = unmeasured/off-wrist
            PRIMARY KEY (date, time)
        );
        CREATE INDEX IF NOT EXISTS idx_intraday_stress_date ON intraday_stress(date);

        CREATE TABLE IF NOT EXISTS intraday_body_battery (
            date       TEXT NOT NULL,
            time       TEXT NOT NULL,        -- local HH:MM
            level      INTEGER NOT NULL,     -- 0-100 Body Battery (energy)
            PRIMARY KEY (date, time)
        );
        CREATE INDEX IF NOT EXISTS idx_intraday_bb_date ON intraday_body_battery(date);

        CREATE TABLE IF NOT EXISTS wellness_daily (
            date             TEXT PRIMARY KEY,
            stress_avg       INTEGER,
            stress_max       INTEGER,
            stress_rest_min  INTEGER,   -- minutes at rest (0-25)
            stress_low_min   INTEGER,   -- 26-50
            stress_med_min   INTEGER,   -- 51-75
            stress_high_min  INTEGER,   -- 76-100
            bb_min           INTEGER,   -- Body Battery low
            bb_max           INTEGER,   -- Body Battery high
            bb_charged       INTEGER,   -- points charged over the day
            bb_drained       INTEGER,   -- points drained over the day
            respiration_avg  REAL,
            respiration_low  REAL,
            respiration_high REAL,
            spo2_avg         REAL,
            spo2_low         INTEGER,
            skin_temp_dev    REAL,      -- deviation from baseline °C (nullable; not in all libs)
            updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
    """)
    conn.commit()
    print("wellness tables ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
