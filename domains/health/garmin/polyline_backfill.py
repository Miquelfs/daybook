"""
Fill activities.polyline from Garmin's own GPS data.

Garmin's activity summary (get_activities_by_date / get_activity) carries no
encoded polyline, so Garmin-only activities used to have no route unless a
Strava sync enriched them. The track IS in the get_activity_details payload the
detail sync already caches in activity_detail.raw_detail_json:
  - geoPolylineDTO.polyline  → [{lat, lon, ...}, ...]   (preferred)
  - activityDetailMetrics    → directLatitude / directLongitude columns
Falls back to the activity_streams table (same metric names, lower-cased).

No Garmin API calls — reads only what is already stored. Idempotent: only
touches activities whose polyline is NULL/empty.

Usage:
  python -m domains.health.garmin.polyline_backfill          # last 14 days
  python -m domains.health.garmin.polyline_backfill --all    # all history
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, timedelta

from infrastructure.db.connection import get_connection

MAX_POINTS = 600  # plenty for a day-view / detail map; keeps rows small


def encode(coords: list[tuple[float, float]], precision: int = 5) -> str:
    """Google encoded-polyline for [(lat, lng), ...]."""
    factor = 10 ** precision
    out: list[str] = []
    prev_lat = prev_lng = 0
    for lat, lng in coords:
        ilat, ilng = round(lat * factor), round(lng * factor)
        for delta in (ilat - prev_lat, ilng - prev_lng):
            v = ~(delta << 1) if delta < 0 else delta << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lng = ilat, ilng
    return "".join(out)


def _valid(lat, lng) -> bool:
    return (
        isinstance(lat, (int, float)) and isinstance(lng, (int, float))
        and -90 <= lat <= 90 and -180 <= lng <= 180
        and not (lat == 0 and lng == 0)
    )


def _downsample(coords: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(coords) <= MAX_POINTS:
        return coords
    step = len(coords) / (MAX_POINTS - 1)
    picked = [coords[int(i * step)] for i in range(MAX_POINTS - 1)]
    return picked + [coords[-1]]


def coords_from_detail(raw: dict) -> list[tuple[float, float]]:
    geo = (raw.get("geoPolylineDTO") or {}).get("polyline") or []
    coords = [(p.get("lat"), p.get("lon")) for p in geo if isinstance(p, dict)]
    coords = [c for c in coords if _valid(*c)]
    if len(coords) >= 2:
        return coords

    idx_lat = idx_lng = None
    for d in raw.get("metricDescriptors") or []:
        key = (d.get("key") or "").lower() if isinstance(d, dict) else ""
        if key == "directlatitude":
            idx_lat = d.get("metricsIndex")
        elif key == "directlongitude":
            idx_lng = d.get("metricsIndex")
    if idx_lat is None or idx_lng is None:
        return []
    coords = []
    for point in raw.get("activityDetailMetrics") or []:
        vals = point.get("metrics") if isinstance(point, dict) else None
        if not vals or max(idx_lat, idx_lng) >= len(vals):
            continue
        if _valid(vals[idx_lat], vals[idx_lng]):
            coords.append((vals[idx_lat], vals[idx_lng]))
    return coords


def coords_from_streams(conn: sqlite3.Connection, activity_id: str) -> list[tuple[float, float]]:
    rows = dict(conn.execute(
        """SELECT stream_type, data_json FROM activity_streams
           WHERE activity_id = ? AND stream_type IN ('directlatitude', 'directlongitude')""",
        (activity_id,),
    ).fetchall())
    if len(rows) < 2:
        return []
    lats = json.loads(rows["directlatitude"])
    lngs = json.loads(rows["directlongitude"])
    return [(a, b) for a, b in zip(lats, lngs) if _valid(a, b)]


def backfill(conn: sqlite3.Connection, since: str | None = None, verbose: bool = True) -> int:
    q = """SELECT a.id, d.raw_detail_json
           FROM activities a LEFT JOIN activity_detail d ON d.activity_id = a.id
           WHERE (a.polyline IS NULL OR a.polyline = '')"""
    params: tuple = ()
    if since:
        q += " AND a.date >= ?"
        params = (since,)

    filled = 0
    for act_id, raw_json in conn.execute(q, params).fetchall():
        coords: list[tuple[float, float]] = []
        if raw_json:
            try:
                coords = coords_from_detail(json.loads(raw_json))
            except (ValueError, TypeError, AttributeError):
                coords = []
        if len(coords) < 2:
            coords = coords_from_streams(conn, act_id)
        if len(coords) < 2:
            continue
        conn.execute(
            "UPDATE activities SET polyline = ? WHERE id = ?",
            (encode(_downsample(coords)), act_id),
        )
        filled += 1
        if verbose:
            print(f"  ✓ {act_id}: {len(coords)} pts", file=sys.stderr)
    conn.commit()
    return filled


def main() -> None:
    p = argparse.ArgumentParser(description="Fill activity polylines from cached Garmin GPS")
    p.add_argument("--all", action="store_true", help="All history (default: last 14 days)")
    args = p.parse_args()
    since = None if args.all else (date.today() - timedelta(days=14)).isoformat()
    conn = get_connection()
    try:
        n = backfill(conn, since)
    finally:
        conn.close()
    print(f"{n} activity routes filled.", file=sys.stderr)


if __name__ == "__main__":
    main()
