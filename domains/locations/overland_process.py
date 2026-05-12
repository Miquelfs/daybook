#!/usr/bin/env python3
"""
Process raw overland_locations points into tracks + geocoded stops.

Pipeline:
  1. Load unprocessed points (those not yet in a track segment) for a date range
  2. Dwell detection — group consecutive points within DWELL_RADIUS_M for at
     least DWELL_MIN_MINUTES into a "stop"; gaps between stops become "move" segments
  3. Write each segment (stop or move) as a row in the tracks table
  4. Reverse-geocode the centroid of each new segment at zoom 18 (venue level)
     via Nominatim — gets restaurant/café/airport names, not just districts

Dwell parameters (tune to taste):
  DWELL_RADIUS_M    = 80   — points within 80m of each other = same place
  DWELL_MIN_MINUTES = 3    — must stay ≥ 3 min to count as a stop vs passing through

Usage:
  python -m domains.locations.overland_process            # process all pending
  python -m domains.locations.overland_process 2026-05-09 # single date
  python -m domains.locations.overland_process --no-geocode
"""

import argparse
import json
import math
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT    = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "locations.db"

DWELL_RADIUS_M    = 80   # max displacement from anchor to still count as "stopped"
DWELL_MIN_MINUTES = 3    # minimum time at an anchor to be a "stop" vs passing through
MOVE_SPEED_MS     = 0.8  # m/s — above this between consecutive points = moving, reset anchor
NOMINATIM_URL     = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT        = "daybook-personal/1.0 (personal data project)"


# ── DB helpers ────────────────────────────────────────────────────────────────

def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def _ensure_processed_col(con: sqlite3.Connection) -> None:
    """Add processed flag to overland_locations if it doesn't exist yet."""
    cols = {r[1] for r in con.execute("PRAGMA table_info(overland_locations)")}
    if "processed" not in cols:
        con.execute("ALTER TABLE overland_locations ADD COLUMN processed INTEGER NOT NULL DEFAULT 0")
        con.commit()


# ── Geometry ─────────────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lng2 - lng1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _centroid(pts: list[dict]) -> tuple[float, float]:
    lat = sum(p["lat"] for p in pts) / len(pts)
    lng = sum(p["lng"] for p in pts) / len(pts)
    return lat, lng


# ── Geocoding ─────────────────────────────────────────────────────────────────

def _reverse_geocode(lat: float, lng: float, zoom: int = 18) -> dict:
    params = urllib.parse.urlencode({
        "lat": lat, "lon": lng,
        "format": "jsonv2", "zoom": zoom, "addressdetails": 1,
    })
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def _extract_place(data: dict) -> tuple[str | None, str | None, str | None]:
    addr = data.get("address", {})
    # Try specific venue names before falling back to road/district
    name = (
        data.get("name")
        or addr.get("amenity")
        or addr.get("tourism")
        or addr.get("aeroway")      # airport terminals etc
        or addr.get("shop")
        or addr.get("building")
        or addr.get("road")
        or data.get("display_name", "").split(",")[0]
    )
    city = (
        addr.get("city") or addr.get("town")
        or addr.get("village") or addr.get("municipality")
        or addr.get("county")
    )
    return name, city, addr.get("country")


# ── Dwell detection ───────────────────────────────────────────────────────────

def _detect_segments(points: list[dict]) -> list[dict]:
    """
    Convert a chronologically sorted list of GPS points into segments.

    Two-pass algorithm:
    1. If consecutive points show speed > MOVE_SPEED_MS the device is moving —
       advance the anchor so a run/cycle isn't collapsed to one cluster.
    2. Otherwise use distance-from-anchor dwell detection (original logic).

    Returns list of dicts:
      {type: "stop"|"move", start: ISO, end: ISO,
       points: [...], lat: float, lng: float}
    """
    if not points:
        return []

    def _ts(pt: dict) -> datetime:
        return datetime.fromisoformat(pt["recorded_at"].replace("Z", "+00:00"))

    def _flush_cluster(cls: list[dict]) -> dict | None:
        if not cls:
            return None
        t0, t1 = _ts(cls[0]), _ts(cls[-1])
        duration_min = (t1 - t0).total_seconds() / 60
        lat, lng = _centroid(cls)
        seg_type = "stop" if duration_min >= DWELL_MIN_MINUTES else "move"
        return {
            "type": seg_type,
            "start": cls[0]["recorded_at"],
            "end":   cls[-1]["recorded_at"],
            "points": cls,
            "lat": lat,
            "lng": lng,
        }

    segments: list[dict] = []
    cluster: list[dict] = [points[0]]
    anchor = points[0]

    for pt in points[1:]:
        prev = cluster[-1]
        dist_from_prev = _haversine_m(prev["lat"], prev["lng"], pt["lat"], pt["lng"])
        elapsed_s = (_ts(pt) - _ts(prev)).total_seconds()
        speed_ms = dist_from_prev / elapsed_s if elapsed_s > 0 else 0

        dist_from_anchor = _haversine_m(anchor["lat"], anchor["lng"], pt["lat"], pt["lng"])

        if speed_ms >= MOVE_SPEED_MS:
            # Device is actively moving — flush current cluster and start fresh
            # so the path is preserved as many small segments rather than one blob.
            seg = _flush_cluster(cluster)
            if seg:
                segments.append(seg)
            cluster = [pt]
            anchor = pt
        elif dist_from_anchor <= DWELL_RADIUS_M:
            # Still near the anchor — same stop cluster.
            cluster.append(pt)
        else:
            # Moved away from anchor but not at running speed — new cluster.
            seg = _flush_cluster(cluster)
            if seg:
                segments.append(seg)
            cluster = [pt]
            anchor = pt

    seg = _flush_cluster(cluster)
    if seg:
        segments.append(seg)

    return segments


# ── Main processing ───────────────────────────────────────────────────────────

def process(date_filter: str | None = None, geocode: bool = True) -> int:
    """
    Process unprocessed Overland points into tracks.
    Returns number of new track segments created.
    """
    con = _conn()
    _ensure_processed_col(con)

    # Load unprocessed points
    q = """
        SELECT id, recorded_at, date, lat, lng, altitude, speed, motion
        FROM   overland_locations
        WHERE  processed = 0
    """
    params: tuple = ()
    if date_filter:
        q += " AND date = ?"
        params = (date_filter,)
    q += " ORDER BY recorded_at"

    rows = con.execute(q, params).fetchall()
    if not rows:
        print("No unprocessed Overland points.")
        return 0

    print(f"Processing {len(rows)} Overland points...")

    # Group by date
    by_date: dict[str, list[dict]] = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(dict(r))

    created = 0
    for date, pts in sorted(by_date.items()):
        segments = _detect_segments(pts)
        print(f"  {date}: {len(pts)} points → {len(segments)} segments")

        for seg in segments:
            # Build points_json in the same format as import_tracks
            pts_json = json.dumps([
                {"lat": p["lat"], "lng": p["lng"], "t": 0}
                for p in seg["points"]
            ])

            # Derive start/end times as 2-hour bucket keys to match existing tracks
            # format (or use exact times — both work since UNIQUE is on segment_start+end)
            seg_start = seg["start"]
            seg_end   = seg["end"]

            try:
                con.execute(
                    """INSERT OR IGNORE INTO tracks
                         (date, segment_start, segment_end, points_json)
                       VALUES (?,?,?,?)""",
                    (date, seg_start, seg_end, pts_json),
                )
                created += 1
            except Exception as e:
                print(f"    Skip segment {seg_start}: {e}")
                continue

            if geocode and len(seg["points"]) >= 1:
                row = con.execute(
                    "SELECT id FROM tracks WHERE segment_start=? AND geocode_city IS NULL",
                    (seg_start,),
                ).fetchone()
                if row:
                    try:
                        # zoom 18 = venue level (gets café/restaurant/airport names)
                        geo = _reverse_geocode(seg["lat"], seg["lng"], zoom=18)
                        name, city, country = _extract_place(geo)
                        con.execute(
                            "UPDATE tracks SET geocode_name=?, geocode_city=?, geocode_country=? WHERE id=?",
                            (name, city, country, row["id"]),
                        )
                        print(f"    geocoded: {name}, {city}")
                        time.sleep(1.1)
                    except Exception as e:
                        print(f"    geocode error: {e}")

        # Mark all processed points as done
        ids = [p["id"] for p in pts]
        con.execute(
            f"UPDATE overland_locations SET processed=1 WHERE id IN ({','.join('?'*len(ids))})",
            ids,
        )
        con.commit()

    print(f"Done: {created} track segments created.")
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description="Process Overland GPS into tracks")
    parser.add_argument("date", nargs="?", help="Process only this date (YYYY-MM-DD)")
    parser.add_argument("--no-geocode", action="store_true")
    args = parser.parse_args()
    process(date_filter=args.date, geocode=not args.no_geocode)


if __name__ == "__main__":
    main()
