#!/usr/bin/env python3
"""
Create location_days table and backfill from existing tracks data.

location_days stores one pre-computed row per date with:
  - distance_meters: total distance traveled (haversine, segment-chain method)
  - unique_places:   count of distinct named stops
  - top_place:       most-dwelt-at named place (by segment duration)

Safe to re-run — uses INSERT OR REPLACE so re-processing a date updates the row.

Usage:
  python infrastructure/db/migrate_location_days.py            # create + full backfill
  python infrastructure/db/migrate_location_days.py 2026-05-01 # single date only
  python infrastructure/db/migrate_location_days.py --dry-run  # print without writing
"""

import argparse
import json
import math
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT    = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "locations.db"

TABLE_DDL = """
CREATE TABLE IF NOT EXISTS location_days (
    date              TEXT PRIMARY KEY,
    distance_meters   REAL    NOT NULL DEFAULT 0,
    unique_places     INTEGER NOT NULL DEFAULT 0,
    top_place         TEXT,
    top_place_city    TEXT,
    computed_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_location_days_date ON location_days(date);
"""


# ── Geometry ──────────────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lng2 - lng1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_coords(points_json: str) -> list[tuple[float, float]]:
    """Return list of (lat, lng) pairs from a track segment's points_json."""
    try:
        pts = json.loads(points_json)
        if not isinstance(pts, list):
            return []
        return [(p["lat"], p["lng"]) for p in pts if "lat" in p and "lng" in p]
    except Exception:
        return []


# ── Core computation ──────────────────────────────────────────────────────────

def compute_day(rows: list[sqlite3.Row]) -> dict:
    """
    Compute location_days fields from a list of track segments for one date.

    Algorithm mirrors LocationSection.tsx computeDistanceM:
      For each segment, add its internal polyline distance.
      Between consecutive segments, add the straight-line jump from
      segment-end to next-segment-start.
    This handles both sparse (mostly single-point stops) and dense GPS correctly.
    """
    # Sort by segment_start so the chain is chronological
    segments = sorted(rows, key=lambda r: r["segment_start"])

    coords_list: list[list[tuple[float, float]]] = []
    for seg in segments:
        coords_list.append(_parse_coords(seg["points_json"]))

    total_m = 0.0

    for i, coords in enumerate(coords_list):
        # Internal polyline distance within this segment
        for j in range(1, len(coords)):
            lat1, lng1 = coords[j - 1]
            lat2, lng2 = coords[j]
            total_m += _haversine_m(lat1, lng1, lat2, lng2)

        # Jump to the start of the next segment
        if i < len(coords_list) - 1 and coords and coords_list[i + 1]:
            end_lat, end_lng = coords[-1]
            nxt_lat, nxt_lng = coords_list[i + 1][0]
            total_m += _haversine_m(end_lat, end_lng, nxt_lat, nxt_lng)

    # Named places: deduplicate by name, pick top place by total dwell duration
    place_durations: dict[str, float] = {}
    place_city: dict[str, str | None] = {}
    seen_names: set[str] = set()

    for seg in segments:
        name = seg["geocode_name"]
        if not name:
            continue
        # Compute dwell duration in seconds
        try:
            t0 = datetime.fromisoformat(seg["segment_start"].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(seg["segment_end"].replace("Z", "+00:00"))
            dur = (t1 - t0).total_seconds()
        except Exception:
            dur = 0.0
        place_durations[name] = place_durations.get(name, 0.0) + dur
        place_city[name] = seg["geocode_city"]
        seen_names.add(name)

    unique_places = len(seen_names)
    top_place = None
    top_place_city = None
    if place_durations:
        top_place = max(place_durations, key=lambda k: place_durations[k])
        top_place_city = place_city.get(top_place)

    return {
        "distance_meters": total_m,
        "unique_places": unique_places,
        "top_place": top_place,
        "top_place_city": top_place_city,
    }


# ── DB helpers ────────────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def upsert_day(con: sqlite3.Connection, date: str, data: dict, dry_run: bool = False) -> None:
    if dry_run:
        print(f"  [dry-run] {date}: {data['distance_meters']/1000:.1f} km, "
              f"{data['unique_places']} places, top={data['top_place']}")
        return
    con.execute(
        """
        INSERT OR REPLACE INTO location_days
            (date, distance_meters, unique_places, top_place, top_place_city, computed_at)
        VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        """,
        (date, data["distance_meters"], data["unique_places"],
         data["top_place"], data["top_place_city"]),
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def run(date_filter: str | None = None, dry_run: bool = False) -> None:
    con = _conn()

    # Create table
    if not dry_run:
        con.executescript(TABLE_DDL)
        con.commit()
        print("location_days table ready.")

    # Fetch track segments
    if date_filter:
        rows = con.execute(
            """
            SELECT date, segment_start, segment_end, points_json,
                   geocode_name, geocode_city
            FROM tracks
            WHERE date = ?
            ORDER BY segment_start
            """,
            (date_filter,),
        ).fetchall()
    else:
        rows = con.execute(
            """
            SELECT date, segment_start, segment_end, points_json,
                   geocode_name, geocode_city
            FROM tracks
            ORDER BY date, segment_start
            """
        ).fetchall()

    if not rows:
        print("No track segments found — nothing to backfill.")
        return

    # Group by date
    by_date: dict[str, list] = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(r)

    print(f"Computing location_days for {len(by_date)} date(s)...")
    updated = 0
    for date, segs in sorted(by_date.items()):
        data = compute_day(segs)
        upsert_day(con, date, data, dry_run=dry_run)
        if not dry_run:
            print(f"  {date}: {data['distance_meters']/1000:.1f} km, "
                  f"{data['unique_places']} places, top={data['top_place']}")
        updated += 1

    if not dry_run:
        con.commit()
        print(f"\nDone: {updated} date(s) written to location_days.")
    else:
        print(f"\n[dry-run] Would write {updated} date(s).")
    con.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create and backfill location_days table")
    parser.add_argument("date", nargs="?", help="Process only this date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    args = parser.parse_args()
    run(date_filter=args.date, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
