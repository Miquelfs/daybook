"""
Coll (the DIY bike computer, ~/Desktop/ciclocomputer) — courses Daybook builds into
.coll course packs for the device: uploaded ones, and one per planned session with a GPX. See ciclocomputer/docs/DAYBOOK.md §3.3.

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
"""


def migrate(conn) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("coll_courses ready")
