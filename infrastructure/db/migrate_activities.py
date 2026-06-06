"""
Migration: reshape activities + add new tables for Garmin/Strava integration.

Safe to run multiple times (idempotent).

Changes:
  1. Rename activities → activities_v1 (old schema, preserve data)
  2. Create activities (new schema matching integration vision)
  3. Copy 350 existing rows from v1, keying them as "garmin_{activity_id}"
  4. Add activity_streams, segments, segment_efforts, sync_status tables
  5. Drop activities_v1 once migration is confirmed
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from connection import get_connection


def run() -> None:
    conn = get_connection()

    # ── 1. Check whether migration already ran ────────────────────────────────
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }

    already_done = "activities_v1" not in tables and "activity_streams" in tables
    if already_done:
        print("Migration already applied — nothing to do.")
        conn.close()
        return

    print("Starting activities schema migration...")

    # ── 2. Rename old activities table ────────────────────────────────────────
    if "activities_v1" not in tables and "activities" in tables:
        conn.execute("ALTER TABLE activities RENAME TO activities_v1")
        print("  Renamed activities → activities_v1")

    # ── 3. Create new activities table ────────────────────────────────────────
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS activities (
            id                      TEXT PRIMARY KEY,   -- e.g. "garmin_19284756"
            date                    TEXT NOT NULL,       -- ISO date, joins to days.date
            source                  TEXT NOT NULL,       -- 'garmin' | 'strava' | 'manual'
            strava_id               TEXT,               -- cross-reference if matched
            activity_type           TEXT,               -- run, ride, hike, swim, walk, etc.
            name                    TEXT,
            start_time              TEXT,               -- ISO 8601 with timezone
            duration_seconds        INTEGER,
            moving_time_seconds     INTEGER,
            distance_meters         REAL,
            elevation_gain_meters   REAL,
            avg_heart_rate          INTEGER,
            max_heart_rate          INTEGER,
            avg_speed_mps           REAL,
            avg_power_watts         INTEGER,
            calories                INTEGER,
            training_stress_score   REAL,
            polyline                TEXT,               -- encoded GPS path (Google format)
            start_lat               REAL,
            start_lng               REAL,
            raw_payload             TEXT NOT NULL DEFAULT '{}',
            created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            FOREIGN KEY (date) REFERENCES days(date)
        );

        CREATE INDEX IF NOT EXISTS idx_activities_date   ON activities(date);
        CREATE INDEX IF NOT EXISTS idx_activities_type   ON activities(activity_type);
        CREATE INDEX IF NOT EXISTS idx_activities_source ON activities(source);
    """)
    print("  Created new activities table")

    # ── 4. Copy existing rows from v1 ─────────────────────────────────────────
    if "activities_v1" in tables or conn.execute(
        "SELECT name FROM sqlite_master WHERE name='activities_v1'"
    ).fetchone():
        rows = conn.execute("SELECT * FROM activities_v1").fetchall()
        count = 0
        for r in rows:
            new_id = f"garmin_{r['activity_id']}"
            # Skip if already migrated (idempotent re-run)
            exists = conn.execute(
                "SELECT id FROM activities WHERE id=?", (new_id,)
            ).fetchone()
            if exists:
                continue
            raw = r["raw_json"] if r["raw_json"] else "{}"
            conn.execute(
                """
                INSERT OR IGNORE INTO activities
                    (id, date, source, activity_type, name, start_time,
                     duration_seconds, distance_meters, elevation_gain_meters,
                     avg_heart_rate, max_heart_rate, calories, raw_payload)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    new_id,
                    r["date"],
                    "garmin",
                    r["type"],
                    r["name"],
                    r["start_time"],
                    r["duration_seconds"],
                    r["distance_meters"],
                    r["elevation_gain"],
                    r["avg_hr"],
                    r["max_hr"],
                    r["calories"],
                    raw,
                ),
            )
            count += 1
        conn.commit()
        print(f"  Migrated {count} rows from activities_v1 → activities")

    # ── 5. New tables ─────────────────────────────────────────────────────────
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS activity_streams (
            activity_id  TEXT NOT NULL,
            stream_type  TEXT NOT NULL,   -- heart_rate, altitude, velocity, cadence, etc.
            data_json    TEXT NOT NULL,   -- JSON array of per-second values
            PRIMARY KEY (activity_id, stream_type),
            FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS segments (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL,
            activity_type       TEXT,               -- run, ride
            polyline            TEXT NOT NULL,
            distance_meters     REAL,
            elevation_gain_meters REAL,
            created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            source              TEXT NOT NULL,       -- 'manual' | 'strava'
            strava_segment_id   TEXT                -- nullable
        );

        CREATE TABLE IF NOT EXISTS segment_efforts (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            segment_id          INTEGER NOT NULL,
            activity_id         TEXT NOT NULL,
            date                TEXT NOT NULL,
            duration_seconds    INTEGER NOT NULL,
            avg_heart_rate      INTEGER,
            avg_power_watts     INTEGER,
            is_personal_record  INTEGER DEFAULT 0,
            FOREIGN KEY (segment_id)  REFERENCES segments(id),
            FOREIGN KEY (activity_id) REFERENCES activities(id),
            FOREIGN KEY (date)        REFERENCES days(date)
        );

        CREATE INDEX IF NOT EXISTS idx_segment_efforts_segment ON segment_efforts(segment_id);
        CREATE INDEX IF NOT EXISTS idx_segment_efforts_date    ON segment_efforts(date);

        CREATE TABLE IF NOT EXISTS sync_status (
            source           TEXT PRIMARY KEY,   -- 'garmin' | 'strava'
            last_attempt_at  TEXT NOT NULL,
            last_success_at  TEXT,
            last_error       TEXT,
            records_synced   INTEGER DEFAULT 0
        );
    """)
    print("  Created activity_streams, segments, segment_efforts, sync_status")

    # ── 6. Drop v1 (data is safe in new table) ────────────────────────────────
    if conn.execute(
        "SELECT name FROM sqlite_master WHERE name='activities_v1'"
    ).fetchone():
        conn.execute("DROP TABLE activities_v1")
        print("  Dropped activities_v1")

    conn.commit()
    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    run()
