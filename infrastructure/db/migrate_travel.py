#!/usr/bin/env python3
"""
Travel journal — the moments of a trip, so it can be relived (and exported) years later.

  moments          one thing that happened: a title, a few lines, when and where. Keyed by
                   the day it belongs to — never by a trip id — because trips are detected
                   nightly and rebuilt (their end date grows while you're away), and a moment
                   logged on a planned trip must still be there once the real one is found.
                   Where comes from the photo's GPS, else the Overland track at that minute,
                   else what you typed (place_source = exif | track | manual).
  moment_photos    the photos of a moment (data/photos/moments/…), each with its own time and
                   position from EXIF so a dropped batch sorts and groups itself.
  trip_stories     per trip: the cover photo and the trip in a few lines. Keyed by the trip's
                   first day; looked up by overlap so a planned and a detected trip share it.

Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_travel
"""

from infrastructure.db.connection import get_connection

DDL = """
CREATE TABLE IF NOT EXISTS moments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    date          TEXT NOT NULL,                  -- YYYY-MM-DD, local day it belongs to
    taken_at      TEXT,                           -- UTC, YYYY-MM-DDTHH:MM:SSZ
    title         TEXT,
    story         TEXT,
    lat           REAL,
    lng           REAL,
    place         TEXT,
    city          TEXT,
    country       TEXT,
    place_source  TEXT,                           -- exif | track | manual
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_moments_date ON moments(date, taken_at);

CREATE TABLE IF NOT EXISTS moment_photos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id   INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,                    -- under data/photos/, e.g. moments/ab12….jpg
    thumb_path  TEXT,
    taken_at    TEXT,                             -- UTC from EXIF
    lat         REAL,
    lng         REAL,
    width       INTEGER,
    height      INTEGER,
    caption     TEXT,
    sort        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_moment_photos ON moment_photos(moment_id, sort);

CREATE TABLE IF NOT EXISTS trip_stories (
    start_date      TEXT PRIMARY KEY,
    cover_photo_id  INTEGER REFERENCES moment_photos(id) ON DELETE SET NULL,
    summary         TEXT,
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
"""


def migrate(conn) -> None:
    conn.executescript(DDL)
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("moments / moment_photos / trip_stories ready")
