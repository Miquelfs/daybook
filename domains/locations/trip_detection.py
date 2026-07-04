"""
Auto-detected trips (Plan B.2).

A trip = consecutive days whose GPS points all sit further than
DEFAULT_TRIP_RADIUS_KM (150 km) from the home-base centroid active on that
date (from home_base.home_for). Runs of away-days separated by ≤1 day back
home are merged ("quick return, then flight out"); trips shorter than 2 days
are ignored. Upserts into daybook.db trips by (start_date, end_date).

Usage:
  python -m domains.locations.trip_detection            # last 120 days
  python -m domains.locations.trip_detection --full     # all history
Runs nightly from daily_sync.sh.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from domains.locations.country_names import to_english
from domains.locations.home_base import DEFAULT_TRIP_RADIUS_KM, home_for

_ROOT = Path(__file__).parents[2]
_DAYBOOK_DB = _ROOT / "infrastructure" / "db" / "daybook.db"
_LOCATIONS_DB = _ROOT / "infrastructure" / "db" / "locations.db"

MERGE_GAP_DAYS = 1   # ≤ this many home-days between away-runs → same trip
MIN_TRIP_DAYS = 2    # ignore shorter trips


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _conn(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def _day_observations(lcon: sqlite3.Connection, start: str, end: str) -> dict[str, dict]:
    """Per date: representative coords + countries + cities seen that day."""
    days: dict[str, dict] = {}

    def _day(d: str) -> dict:
        return days.setdefault(d, {"coords": [], "countries": Counter(), "cities": Counter()})

    for r in lcon.execute(
        """SELECT v.date, v.lat, v.lng, p.country, p.city
           FROM visits v LEFT JOIN place_names p ON p.place_id = v.place_id
           WHERE v.date BETWEEN ? AND ? AND v.lat IS NOT NULL""",
        (start, end),
    ):
        d = _day(r["date"])
        d["coords"].append((r["lat"], r["lng"]))
        if r["country"]:
            d["countries"][r["country"]] += 1
        if r["city"]:
            d["cities"][r["city"]] += 1

    for r in lcon.execute(
        """SELECT date, geocode_country AS country, geocode_city AS city
           FROM tracks WHERE date BETWEEN ? AND ?""",
        (start, end),
    ):
        d = _day(r["date"])
        if r["country"]:
            d["countries"][r["country"]] += 1
        if r["city"]:
            d["cities"][r["city"]] += 1

    # Overland points (sampled) fill days without visits, e.g. transit days
    for r in lcon.execute(
        """SELECT date, AVG(lat) AS lat, AVG(lng) AS lng
           FROM overland_locations WHERE date BETWEEN ? AND ?
           GROUP BY date""",
        (start, end),
    ):
        d = _day(r["date"])
        if not d["coords"] and r["lat"] is not None:
            d["coords"].append((r["lat"], r["lng"]))

    return days


def _min_distance_from_home(day: str, coords: list[tuple[float, float]]) -> float | None:
    home = home_for(day)
    if home is None or not coords:
        return None
    return min(_haversine_km(home["lat"], home["lng"], lat, lng) for lat, lng in coords)


def detect(start: str, end: str, verbose: bool = True) -> int:
    lcon = _conn(_LOCATIONS_DB)
    dcon = _conn(_DAYBOOK_DB)
    try:
        days = _day_observations(lcon, start, end)

        # Classify each observed day: away / home / unknown
        away: dict[str, dict] = {}
        for d in sorted(days):
            obs = days[d]
            dist = _min_distance_from_home(d, obs["coords"])
            if dist is None:
                continue
            if dist > DEFAULT_TRIP_RADIUS_KM:
                away[d] = {**obs, "max_dist": max(
                    _haversine_km(home_for(d)["lat"], home_for(d)["lng"], lat, lng)
                    for lat, lng in obs["coords"]
                )}

        # Group away-days into runs, merging gaps ≤ MERGE_GAP_DAYS
        runs: list[list[str]] = []
        for d in sorted(away):
            if runs:
                prev = date.fromisoformat(runs[-1][-1])
                if (date.fromisoformat(d) - prev).days <= MERGE_GAP_DAYS + 1:
                    runs[-1].append(d)
                    continue
            runs.append([d])

        written = 0
        for run in runs:
            start_d, end_d = run[0], run[-1]
            n_days = (date.fromisoformat(end_d) - date.fromisoformat(start_d)).days + 1
            if n_days < MIN_TRIP_DAYS:
                continue

            countries: Counter = Counter()
            cities: Counter = Counter()
            max_dist = 0.0
            for d in run:
                for c, n in away[d]["countries"].items():
                    countries[to_english(c)] += n
                cities.update(away[d]["cities"])
                max_dist = max(max_dist, away[d]["max_dist"])

            primary = countries.most_common(1)[0][0] if countries else None
            total_km = None
            if lcon.execute(
                "SELECT name FROM sqlite_master WHERE name='location_days'"
            ).fetchone():
                total_km_row = lcon.execute(
                    "SELECT SUM(distance_meters)/1000.0 AS km FROM location_days WHERE date BETWEEN ? AND ?",
                    (start_d, end_d),
                ).fetchone()
                if total_km_row and total_km_row["km"]:
                    total_km = round(total_km_row["km"], 1)
            photo_row = dcon.execute(
                "SELECT photo_path FROM days WHERE date BETWEEN ? AND ? AND photo_path IS NOT NULL ORDER BY date LIMIT 1",
                (start_d, end_d),
            ).fetchone()
            home = home_for(start_d)

            dcon.execute(
                """INSERT INTO trips (start_date, end_date, primary_country, countries_json,
                                      cities_json, total_km, max_distance_from_home_km,
                                      auto_name, cover_photo_path, home_at_start)
                   VALUES (?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(start_date, end_date) DO UPDATE SET
                     primary_country=excluded.primary_country,
                     countries_json=excluded.countries_json,
                     cities_json=excluded.cities_json,
                     total_km=excluded.total_km,
                     max_distance_from_home_km=excluded.max_distance_from_home_km,
                     auto_name=excluded.auto_name,
                     cover_photo_path=excluded.cover_photo_path,
                     home_at_start=excluded.home_at_start""",
                (
                    start_d, end_d, primary,
                    json.dumps([c for c, _ in countries.most_common()]),
                    json.dumps([c for c, _ in cities.most_common(12)]),
                    total_km,
                    round(max_dist, 1),
                    f"{primary or 'Away'} · {n_days} days",
                    photo_row["photo_path"] if photo_row else None,
                    home["label"] if home else None,
                ),
            )
            written += 1
            if verbose:
                print(f"  ✓ {start_d} → {end_d}: {primary or 'Away'} ({n_days}d, max {max_dist:.0f} km)")

        dcon.commit()
        return written
    finally:
        lcon.close()
        dcon.close()


def main() -> None:
    full = "--full" in sys.argv
    end = date.today().isoformat()
    start = "2013-01-01" if full else (date.today() - timedelta(days=120)).isoformat()
    print(f"detecting trips {start} → {end}")
    n = detect(start, end)
    print(f"{n} trips upserted.")


if __name__ == "__main__":
    main()
