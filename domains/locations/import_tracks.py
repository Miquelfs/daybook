#!/usr/bin/env python3
"""
Import Google Maps Timeline (timelinePath format) into locations.db tracks table.
Handles the newer export format where each entry has a timelinePath array of GPS points.
Optionally reverse-geocodes the midpoint of each segment via Nominatim.

Usage:
  python -m domains.locations.import_tracks data/raw/locations/"location-history 2.json"
  python -m domains.locations.import_tracks --no-geocode data/raw/locations/"location-history 2.json"
"""

import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT    = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "locations.db"

GEO_RE        = re.compile(r"geo:([-\d.]+),([-\d.]+)")
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT    = "daybook-personal/1.0 (personal data project)"


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def parse_geo(geo_str: str) -> tuple[float, float] | tuple[None, None]:
    m = GEO_RE.match(str(geo_str))
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def iso_to_date(iso: str) -> str:
    return str(iso)[:10]


def reverse_geocode(lat: float, lng: float) -> dict:
    params = urllib.parse.urlencode({
        "lat": lat, "lon": lng,
        "format": "jsonv2", "zoom": 14, "addressdetails": 1,
    })
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def extract_place(data: dict) -> tuple[str, str, str]:
    addr = data.get("address", {})
    name = (
        data.get("name")
        or addr.get("amenity")
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


def midpoint(points: list[dict]) -> tuple[float, float] | tuple[None, None]:
    valid = []
    for p in points:
        lat, lng = parse_geo(p.get("point", ""))
        if lat is not None:
            valid.append((lat, lng))
    if not valid:
        return None, None
    mid = len(valid) // 2
    return valid[mid]


def import_file(json_path: Path, geocode: bool, force: bool) -> None:
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    con = _conn()

    if force:
        con.execute("DELETE FROM tracks WHERE 1")
        con.commit()
        print("--force: cleared tracks table")

    inserted = skipped = geo_done = geo_err = 0

    for entry in data:
        if "timelinePath" not in entry:
            skipped += 1
            continue

        start = entry["startTime"]
        end   = entry["endTime"]
        date  = iso_to_date(start)
        points = entry["timelinePath"]

        points_serialized = json.dumps([
            {"lat": lat, "lng": lng, "t": int(p.get("durationMinutesOffsetFromStartTime", 0))}
            for p in points
            for lat, lng in [parse_geo(p.get("point", ""))]
            if lat is not None
        ])

        try:
            con.execute(
                """INSERT OR IGNORE INTO tracks
                     (date, segment_start, segment_end, points_json)
                   VALUES (?,?,?,?)""",
                (date, start, end, points_serialized),
            )
            inserted += 1
        except Exception as e:
            print(f"  Skip {start}: {e}")
            skipped += 1
            continue

        if geocode:
            row = con.execute(
                "SELECT id FROM tracks WHERE segment_start=? AND geocode_city IS NULL",
                (start,),
            ).fetchone()
            if row:
                lat, lng = midpoint(points)
                if lat is not None:
                    try:
                        geo = reverse_geocode(lat, lng)
                        name, city, country = extract_place(geo)
                        con.execute(
                            "UPDATE tracks SET geocode_name=?, geocode_city=?, geocode_country=? WHERE id=?",
                            (name, city, country, row["id"]),
                        )
                        geo_done += 1
                        time.sleep(1.1)
                    except Exception as e:
                        print(f"  Geocode error {lat},{lng}: {e}")
                        geo_err += 1

    con.commit()
    con.close()

    print(f"Done: {inserted} inserted, {skipped} skipped")
    if geocode:
        print(f"Geocoded: {geo_done} ok, {geo_err} errors")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import timelinePath GPS tracks to locations.db")
    parser.add_argument("json", help="Path to location-history JSON")
    parser.add_argument("--no-geocode", action="store_true", help="Skip reverse-geocoding")
    parser.add_argument("--force", action="store_true", help="Wipe all tracks before import")
    args = parser.parse_args()

    path = Path(args.json)
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)

    import_file(path, geocode=not args.no_geocode, force=args.force)


if __name__ == "__main__":
    main()
