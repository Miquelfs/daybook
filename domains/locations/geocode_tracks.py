#!/usr/bin/env python3
"""
Background geocoder for tracks table.
Processes un-geocoded rows in batches, respecting Nominatim 1 req/sec limit.
Run this overnight to geocode the full history.

Usage:
  python -m domains.locations.geocode_tracks              # all remaining
  python -m domains.locations.geocode_tracks --limit 100  # test batch
  python -m domains.locations.geocode_tracks --force      # re-geocode all
"""

import argparse
import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT    = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "locations.db"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT    = "daybook-personal/1.0 (personal data project)"


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


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


def midpoint_from_json(points_json: str) -> tuple[float, float] | tuple[None, None]:
    pts = json.loads(points_json)
    if not pts:
        return None, None
    mid = pts[len(pts) // 2]
    return mid.get("lat"), mid.get("lng")


def main() -> None:
    parser = argparse.ArgumentParser(description="Geocode tracks table via Nominatim")
    parser.add_argument("--limit", type=int, default=0, help="Max rows to process (0=all)")
    parser.add_argument("--force", action="store_true", help="Re-geocode already resolved rows")
    args = parser.parse_args()

    con = _conn()

    if args.force:
        con.execute("UPDATE tracks SET geocode_name=NULL, geocode_city=NULL, geocode_country=NULL")
        con.commit()
        print("--force: cleared all geocodes")

    query = "SELECT id, points_json FROM tracks WHERE geocode_city IS NULL ORDER BY date DESC"
    if args.limit:
        query += f" LIMIT {args.limit}"

    rows = con.execute(query).fetchall()
    total = len(rows)
    print(f"Rows to geocode: {total}")
    if not total:
        print("Nothing to do.")
        return

    done = errors = 0
    for i, row in enumerate(rows):
        lat, lng = midpoint_from_json(row["points_json"])
        if lat is None:
            errors += 1
            continue
        try:
            geo = reverse_geocode(lat, lng)
            name, city, country = extract_place(geo)
            con.execute(
                "UPDATE tracks SET geocode_name=?, geocode_city=?, geocode_country=? WHERE id=?",
                (name, city, country, row["id"]),
            )
            if (i + 1) % 50 == 0:
                con.commit()
                pct = round((i + 1) / total * 100)
                print(f"  {i+1}/{total} ({pct}%) — last: {name}, {city}")
            done += 1
            time.sleep(1.1)
        except Exception as e:
            print(f"  Error row {row['id']}: {e}", file=sys.stderr)
            errors += 1

    con.commit()
    con.close()
    print(f"Done: {done} geocoded, {errors} errors")


if __name__ == "__main__":
    main()
