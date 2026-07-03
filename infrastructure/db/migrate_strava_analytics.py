"""
Phase 1 migration: create Strava Analytics tables and seed athlete_zones.

Run from daybook/ root:
    python -m infrastructure.db.migrate_strava_analytics

Idempotent — safe to run multiple times (all CREATE IF NOT EXISTS).
"""

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(_ROOT))

from infrastructure.db.connection import get_connection

NEW_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS activity_detail (
    activity_id          TEXT PRIMARY KEY,
    sport                TEXT NOT NULL,
    sub_sport            TEXT,
    avg_pace_s_per_km    REAL,
    avg_cadence          REAL,
    normalized_power_w   REAL,
    intensity_factor     REAL,
    variability_index    REAL,
    efficiency_factor    REAL,
    decoupling_pct       REAL,
    relative_effort      REAL,
    hr_tss               REAL,
    zones_json           TEXT,
    garmin_aerobic_te    REAL,
    garmin_anaerobic_te  REAL,
    garmin_activity_load REAL,
    computed_at          TEXT,
    raw_detail_json      TEXT,
    FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_detail_sport ON activity_detail(sport);

CREATE TABLE IF NOT EXISTS activity_split (
    activity_id        TEXT NOT NULL,
    split_index        INTEGER NOT NULL,
    type               TEXT,
    distance_m         REAL,
    time_s             REAL,
    avg_pace_s_per_km  REAL,
    gap_s_per_km       REAL,
    avg_hr             INTEGER,
    avg_power_w        REAL,
    avg_cadence        REAL,
    elev_gain_m        REAL,
    avg_grade          REAL,
    PRIMARY KEY (activity_id, split_index),
    FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_split_id ON activity_split(activity_id);

CREATE TABLE IF NOT EXISTS best_effort (
    activity_id  TEXT NOT NULL,
    date         TEXT NOT NULL,
    sport        TEXT NOT NULL,
    channel      TEXT NOT NULL,
    bucket       INTEGER NOT NULL,
    value        REAL NOT NULL,
    PRIMARY KEY (activity_id, channel, bucket),
    FOREIGN KEY (date) REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_best_effort_sport_channel ON best_effort(sport, channel, bucket);
CREATE INDEX IF NOT EXISTS idx_best_effort_date          ON best_effort(date);

CREATE TABLE IF NOT EXISTS training_load_daily (
    date       TEXT NOT NULL,
    sport      TEXT NOT NULL,
    daily_tss  REAL NOT NULL DEFAULT 0,
    ctl        REAL,
    atl        REAL,
    tsb        REAL,
    ramp_rate  REAL,
    PRIMARY KEY (date, sport),
    FOREIGN KEY (date) REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_training_load_sport ON training_load_daily(sport, date);

CREATE TABLE IF NOT EXISTS athlete_zones (
    valid_from               TEXT NOT NULL,
    sport                    TEXT NOT NULL,
    max_hr                   INTEGER,
    threshold_hr             INTEGER,
    ftp_w                    REAL,
    threshold_pace_s_per_km  REAL,
    css_pace_s_per_100m      REAL,
    zones_json               TEXT NOT NULL,
    PRIMARY KEY (valid_from, sport)
);

CREATE TABLE IF NOT EXISTS training_goal (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sport        TEXT,
    metric       TEXT,
    period       TEXT,
    target       REAL,
    period_start TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS garmin_physio (
    date                      TEXT PRIMARY KEY,
    vo2max_run                REAL,
    vo2max_bike               REAL,
    training_readiness_score  INTEGER,
    acute_load                REAL,
    chronic_load              REAL,
    acute_chronic_ratio       REAL,
    training_status           TEXT,
    load_focus_json           TEXT,
    raw_payload               TEXT,
    FOREIGN KEY (date) REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_garmin_physio_date ON garmin_physio(date);
"""

# Initial athlete zones — best estimate based on typical endurance athlete.
# Update valid_from and values after a threshold test on Pi.
INITIAL_ZONES = [
    {
        "valid_from": "2019-01-01",
        "sport": "run",
        "max_hr": 195,
        "threshold_hr": 165,
        "ftp_w": None,
        "threshold_pace_s_per_km": 270,   # ~4:30/km threshold pace
        "css_pace_s_per_100m": None,
        "zones_json": json.dumps([
            {"name": "Z1", "min_hr": 0,   "max_hr": 126},  # < 65% max
            {"name": "Z2", "min_hr": 126, "max_hr": 146},  # 65-75%
            {"name": "Z3", "min_hr": 146, "max_hr": 160},  # 75-82%
            {"name": "Z4", "min_hr": 160, "max_hr": 172},  # 82-88%
            {"name": "Z5", "min_hr": 172, "max_hr": 999},  # > 88%
        ]),
    },
    {
        "valid_from": "2019-01-01",
        "sport": "ride",
        "max_hr": 195,
        "threshold_hr": 162,
        "ftp_w": 220,                     # placeholder — update from FTP test
        "threshold_pace_s_per_km": None,
        "css_pace_s_per_100m": None,
        "zones_json": json.dumps([
            {"name": "Z1", "min_hr": 0,   "max_hr": 123},
            {"name": "Z2", "min_hr": 123, "max_hr": 143},
            {"name": "Z3", "min_hr": 143, "max_hr": 156},
            {"name": "Z4", "min_hr": 156, "max_hr": 168},
            {"name": "Z5", "min_hr": 168, "max_hr": 999},
        ]),
    },
    {
        "valid_from": "2019-01-01",
        "sport": "swim",
        "max_hr": 195,
        "threshold_hr": 158,
        "ftp_w": None,
        "threshold_pace_s_per_km": None,
        "css_pace_s_per_100m": 95,        # ~1:35/100m CSS placeholder
        "zones_json": json.dumps([
            {"name": "Z1", "min_hr": 0,   "max_hr": 120},
            {"name": "Z2", "min_hr": 120, "max_hr": 140},
            {"name": "Z3", "min_hr": 140, "max_hr": 153},
            {"name": "Z4", "min_hr": 153, "max_hr": 165},
            {"name": "Z5", "min_hr": 165, "max_hr": 999},
        ]),
    },
]


def main() -> None:
    conn = get_connection()
    try:
        print("Creating new tables...", file=sys.stderr)
        conn.executescript(NEW_TABLES_SQL)

        print("Seeding initial athlete_zones...", file=sys.stderr)
        for z in INITIAL_ZONES:
            existing = conn.execute(
                "SELECT 1 FROM athlete_zones WHERE valid_from=? AND sport=?",
                (z["valid_from"], z["sport"])
            ).fetchone()
            if not existing:
                conn.execute(
                    """INSERT INTO athlete_zones
                       (valid_from, sport, max_hr, threshold_hr, ftp_w,
                        threshold_pace_s_per_km, css_pace_s_per_100m, zones_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (z["valid_from"], z["sport"], z["max_hr"], z["threshold_hr"],
                     z["ftp_w"], z["threshold_pace_s_per_km"], z["css_pace_s_per_100m"],
                     z["zones_json"])
                )
                print(f"  Seeded zones: {z['sport']} from {z['valid_from']}", file=sys.stderr)
            else:
                print(f"  Already exists: {z['sport']} from {z['valid_from']} — skipped",
                      file=sys.stderr)

        conn.commit()

        # Verify
        tables = [
            "activity_detail", "activity_split", "best_effort",
            "training_load_daily", "athlete_zones", "training_goal", "garmin_physio"
        ]
        print("\nVerification:", file=sys.stderr)
        for t in tables:
            count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"  {t}: {count} rows", file=sys.stderr)

        zones = conn.execute("SELECT valid_from, sport FROM athlete_zones").fetchall()
        print(f"\n  athlete_zones seeded: {zones}", file=sys.stderr)

        print("\nMigration complete.", file=sys.stderr)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
