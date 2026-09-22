#!/usr/bin/env python3
"""
Recompute overland_locations.date and tracks.date using the LOCAL calendar
date at each point's coordinates, instead of the UTC calendar date they were
originally stamped with.

Overland timestamps are UTC. Bucketing by UTC date misattributes points near
local midnight during international travel — e.g. a 5am arrival in Osaka
(UTC+9) is ~8pm the previous day in UTC, so the whole morning at the airport
got stamped onto the wrong day, and the previous day's view showed "finishing"
somewhere the traveler hadn't actually reached yet in local time.

This is a one-time backfill for data ingested before the fix in
infrastructure/api/routers/locations.py (ingest_overland) started using
domains.locations.tz_lookup.local_date_for_point going forward. Safe to
re-run — it's idempotent (recomputing an already-correct date is a no-op).

What it touches:
  1. overland_locations.date  — recomputed from (recorded_at, lat, lng)
  2. tracks.date              — recomputed from (segment_start, first point
                                  in points_json)
  3. location_days            — recomputed for every date whose tracks
                                  changed (rows with no remaining tracks are
                                  deleted; the rest are recomputed via the
                                  same logic overland_process.py uses)

Note: a track segment is a single dwell/move cluster (typically small, tens
to hundreds of metres), so using its first point's coordinates for the whole
segment is accurate. The one edge case this doesn't handle is a segment that
itself straddles local midnight (e.g. an overnight stop) — such a segment
still gets a single date (whichever side its first point falls on), matching
the existing one-date-per-segment model rather than splitting it.

Usage (run on the Pi, per CLAUDE.md — never against a Mac copy of the DB):
    cd ~/daybook && python -m infrastructure.db.migrate_gps_local_dates --dry-run
    cd ~/daybook && python -m infrastructure.db.migrate_gps_local_dates
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "locations.db"


def run(dry_run: bool = False, db_path: Path = DB_PATH) -> None:
    from domains.locations.overland_process import _upsert_location_day
    from domains.locations.tz_lookup import local_date_for_point

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    # ── 1. overland_locations ────────────────────────────────────────────────
    rows = con.execute("SELECT id, recorded_at, date, lat, lng FROM overland_locations").fetchall()
    changed_points = 0
    for r in rows:
        try:
            new_date = local_date_for_point(r["recorded_at"], r["lat"], r["lng"])
        except Exception as e:
            print(f"  [skip] overland_locations id={r['id']}: {e}")
            continue
        if new_date != r["date"]:
            changed_points += 1
            print(f"  overland_locations id={r['id']}  {r['date']} → {new_date}  ({r['lat']:.4f},{r['lng']:.4f})")
            if not dry_run:
                con.execute("UPDATE overland_locations SET date = ? WHERE id = ?", (new_date, r["id"]))

    print(f"\noverland_locations: {changed_points}/{len(rows)} rows would change date"
          f"{'' if dry_run else ' — updated'}\n")

    # ── 2. tracks ─────────────────────────────────────────────────────────────
    rows = con.execute("SELECT id, date, segment_start, points_json FROM tracks").fetchall()
    changed_tracks = 0
    touched_dates: set[str] = set()
    for r in rows:
        try:
            pts = json.loads(r["points_json"])
            if not pts:
                continue
            lat, lng = pts[0]["lat"], pts[0]["lng"]
            new_date = local_date_for_point(r["segment_start"], lat, lng)
        except Exception as e:
            print(f"  [skip] tracks id={r['id']}: {e}")
            continue
        if new_date != r["date"]:
            changed_tracks += 1
            touched_dates.add(r["date"])
            touched_dates.add(new_date)
            print(f"  tracks id={r['id']}  {r['date']} → {new_date}  ({lat:.4f},{lng:.4f})")
            if not dry_run:
                con.execute("UPDATE tracks SET date = ? WHERE id = ?", (new_date, r["id"]))

    print(f"\ntracks: {changed_tracks}/{len(rows)} rows would change date"
          f"{'' if dry_run else ' — updated'}\n")

    con.commit()

    # ── 3. location_days ─────────────────────────────────────────────────────
    if dry_run:
        print(f"(dry run — would recompute location_days for {len(touched_dates)} affected dates)")
    else:
        for d in sorted(touched_dates):
            remaining = con.execute("SELECT COUNT(*) FROM tracks WHERE date = ?", (d,)).fetchone()[0]
            if remaining == 0:
                con.execute("DELETE FROM location_days WHERE date = ?", (d,))
                print(f"  location_days {d}: no tracks left — deleted")
            else:
                _upsert_location_day(con, d)
                print(f"  location_days {d}: recomputed")
        con.commit()

    con.close()
    print("\n✓ Done" if not dry_run else "\n(dry run — nothing written)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db", default=str(DB_PATH))
    args = parser.parse_args()
    run(dry_run=args.dry_run, db_path=Path(args.db))
