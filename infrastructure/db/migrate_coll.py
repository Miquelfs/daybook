"""
Coll (the DIY bike computer, ~/Desktop/ciclocomputer) — courses Daybook builds into
.coll course packs for the device: uploaded ones, and one per planned session with a GPX — and
the rides Coll uploads. See ciclocomputer/docs/DAYBOOK.md §3.3, §5.

Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_coll
"""

from infrastructure.db.connection import get_connection

SCHEMA = """
CREATE TABLE IF NOT EXISTS coll_courses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    goal_id       INTEGER REFERENCES race_goals(id) ON DELETE SET NULL,
    session_id    INTEGER REFERENCES plan_sessions(id) ON DELETE SET NULL,
    gpx           TEXT NOT NULL,
    gpx_sha1      TEXT NOT NULL,                     -- same GPX uploaded twice = same course (uploads);
                                                     -- a planned session reuses a twin's pack
    auto          INTEGER NOT NULL DEFAULT 0,        -- 1: made from a planned session's GPX
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending | building | ready | failed
    error         TEXT,
    progress      TEXT,                              -- last builder log line while building
    pack          BLOB,                              -- the .coll bytes
    pack_sha1     TEXT,                              -- ETag: Coll compares it to decide to download
    pack_format   TEXT,                              -- 'COL1'
    summary_json  TEXT,                              -- build() summary + tunnels + waypoint kinds
    turns_json    TEXT,                              -- build() turns, for the review page
    polyline      TEXT,                              -- encoded, ~25 m, for maps
    cutoffs       TEXT,                              -- Coll's 'WHERE@HH:MM name; …' (race courses)
    fuel_plan     TEXT,                              -- override; else derived (domains/coll/fuel.py)
    on_device     INTEGER NOT NULL DEFAULT 1,        -- include in Coll's sync
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    built_at      TEXT
);
CREATE INDEX IF NOT EXISTS coll_courses_status ON coll_courses(status);
CREATE INDEX IF NOT EXISTS coll_courses_sha1 ON coll_courses(gpx_sha1);
CREATE INDEX IF NOT EXISTS coll_courses_session ON coll_courses(session_id);

-- Rides Coll uploaded (DAYBOOK.md §5). The raw upload is kept (gzip) so a ride can be re-imported.
CREATE TABLE IF NOT EXISTS coll_rides (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id       TEXT NOT NULL UNIQUE,              -- X-Coll-Ride-Id (start, UTC ISO): uploads are idempotent
    activity_id   TEXT,                              -- coll_… or, when the watch recorded it too, the Garmin one
    status        TEXT NOT NULL,                     -- activity | merged (the watch's copy is the activity)
    course_id     INTEGER REFERENCES coll_courses(id) ON DELETE SET NULL,
    name          TEXT,
    start_utc     TEXT NOT NULL,
    format        TEXT NOT NULL,                     -- gpx | clg
    raw_gz        BLOB NOT NULL,
    summary_json  TEXT,
    received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS coll_rides_activity ON coll_rides(activity_id);

-- What Coll reported at the end of its last sync (domains/coll/device_state.py)
CREATE TABLE IF NOT EXISTS coll_device (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    seen_at       TEXT,
    firmware      TEXT,
    free_kb       INTEGER,
    battery_pct   INTEGER,
    rides_waiting INTEGER,
    have_json     TEXT                               -- [{id, pack_sha1}] the packs on its flash
);

-- Each ride of a route against its plan (domains/coll/review.py). course_id NULL: looked at, no route.
CREATE TABLE IF NOT EXISTS coll_reviews (
    activity_id   TEXT PRIMARY KEY,
    course_id     INTEGER REFERENCES coll_courses(id) ON DELETE CASCADE,
    date          TEXT,
    covered_km    REAL,
    model_s       REAL,                              -- touring-model seconds over the covered part, at its flat speed
    base_kmh      REAL,                              -- your 6-month pace on the day (before learning)
    moving_s      REAL,                              -- what you rode it in, moving
    version       INTEGER NOT NULL DEFAULT 1,
    review_json   TEXT,
    computed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS coll_reviews_course ON coll_reviews(course_id);

-- The forecast along a dated route (domains/coll/weather.py): the raw hourly answer per sample point,
-- and the one-line summary Coll gets with the course.
CREATE TABLE IF NOT EXISTS coll_weather (
    course_id     INTEGER PRIMARY KEY REFERENCES coll_courses(id) ON DELETE CASCADE,
    day           TEXT NOT NULL,
    fetched_at    TEXT NOT NULL,
    raw_json      TEXT NOT NULL,
    line          TEXT
);

-- Every device request (domains/coll/device_state.py): what went out, what came back, errors.
CREATE TABLE IF NOT EXISTS coll_sync_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    kind          TEXT NOT NULL,                     -- sync | settings | pack | ride | device | firmware | auth
    status        INTEGER NOT NULL,
    detail        TEXT,
    bytes         INTEGER
);

-- Firmware images for Coll to install over Wi-Fi (domains/coll/firmware.py); files in data/coll-firmware/
CREATE TABLE IF NOT EXISTS coll_firmware (
    version       TEXT PRIMARY KEY,
    sha1          TEXT NOT NULL,
    bytes         INTEGER NOT NULL,
    notes         TEXT,
    uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
"""


def migrate(conn) -> None:
    conn.executescript(SCHEMA)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(coll_courses)")}
    if "start_time" not in cols:                     # when you set off (HH:MM): the forecast's ETAs
        conn.execute("ALTER TABLE coll_courses ADD COLUMN start_time TEXT")
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("coll tables ready")
