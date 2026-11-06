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
"""


def migrate(conn) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("coll_courses, coll_rides ready")
