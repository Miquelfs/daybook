"""
Auto-detected trips (Plan B.2) — nights-away-from-home semantics.

A day counts as an *away night* when the LAST observation of that day (latest
visit end / Overland ping) is further than the active home's radius from the
home-base centroid for that date (home_base.home_for). Day-trips that end back
home — a pilot flying out and sleeping in their own bed — are NOT trips.

A trip = consecutive away nights. Sleeping at home breaks the trip. Days with
no data between two away nights are bridged (assumed still away, up to 3 days).
Single-night layovers count.

Approximation: a red-eye landing home after midnight still marks the previous
day as away (last observation of that day is at the outstation).

Usage:
  python -m domains.locations.trip_detection            # last 120 days
  python -m domains.locations.trip_detection --full     # all history
Runs nightly from daily_sync.sh. Recomputed windows are wiped before upsert so
rule changes and merged trips never leave stale rows behind.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

from domains.locations.country_names import to_english
from domains.locations.home_base import home_for

_ROOT = Path(__file__).parents[2]
_DAYBOOK_DB = _ROOT / "infrastructure" / "db" / "daybook.db"
_LOCATIONS_DB = _ROOT / "infrastructure" / "db" / "locations.db"

MIN_AWAY_KM = 40.0        # floor for the "not sleeping at home" radius
BRIDGE_UNKNOWN_DAYS = 3   # no-data days between away nights assumed still away


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


def _parse_ts(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _night_coords(lcon: sqlite3.Connection, start: str, end: str) -> dict[str, tuple]:
    """date → (lat, lng) of the LAST observation that day (visits ∪ overland)."""
    best: dict[str, tuple] = {}  # date → (ts, lat, lng)

    for r in lcon.execute(
        """SELECT date, lat, lng, COALESCE(end_time, start_time) AS ts
           FROM visits
           WHERE date BETWEEN ? AND ? AND lat IS NOT NULL AND lat != 0""",
        (start, end),
    ):
        ts = _parse_ts(r["ts"])
        if ts is None:
            continue
        cur = best.get(r["date"])
        if cur is None or ts > cur[0]:
            best[r["date"]] = (ts, r["lat"], r["lng"])

    for r in lcon.execute(
        """SELECT date, lat, lng, recorded_at AS ts
           FROM overland_locations
           WHERE date BETWEEN ? AND ? AND lat IS NOT NULL""",
        (start, end),
    ):
        ts = _parse_ts(r["ts"])
        if ts is None:
            continue
        cur = best.get(r["date"])
        if cur is None or ts > cur[0]:
            best[r["date"]] = (ts, r["lat"], r["lng"])

    return {d: (v[1], v[2]) for d, v in best.items()}


def _day_context(lcon: sqlite3.Connection, start: str, end: str) -> dict[str, dict]:
    """date → countries/cities Counters seen that day (for naming trips)."""
    days: dict[str, dict] = {}

    def _day(d: str) -> dict:
        return days.setdefault(d, {"countries": Counter(), "cities": Counter()})

    for r in lcon.execute(
        """SELECT v.date, p.country, p.city
           FROM visits v LEFT JOIN place_names p ON p.place_id = v.place_id
           WHERE v.date BETWEEN ? AND ?""",
        (start, end),
    ):
        d = _day(r["date"])
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

    return days


def detect(start: str, end: str, verbose: bool = True) -> int:
    lcon = _conn(_LOCATIONS_DB)
    dcon = _conn(_DAYBOOK_DB)
    try:
        nights = _night_coords(lcon, start, end)

        # Classify each observed date: away night / home night
        away: dict[str, float] = {}   # date → distance from home that night
        home_nights: set[str] = set()
        for d in sorted(nights):
            home = home_for(d)
            if home is None:
                continue
            lat, lng = nights[d]
            dist = _haversine_km(home["lat"], home["lng"], lat, lng)
            radius = max(home.get("radius_km") or MIN_AWAY_KM, MIN_AWAY_KM)
            if dist > radius:
                away[d] = dist
            else:
                home_nights.add(d)

        # Group consecutive away nights; bridge short no-data gaps, but a single
        # night at home is a hard break.
        runs: list[list[str]] = []
        for d in sorted(away):
            if runs:
                prev = date.fromisoformat(runs[-1][-1])
                cur = date.fromisoformat(d)
                gap = (cur - prev).days - 1
                gap_dates = [
                    (prev + timedelta(days=i + 1)).isoformat() for i in range(gap)
                ]
                slept_home_between = any(g in home_nights for g in gap_dates)
                if gap <= BRIDGE_UNKNOWN_DAYS and not slept_home_between:
                    runs[-1].append(d)
                    continue
            runs.append([d])

        # Wipe the recompute window first — the nightly upsert must also remove
        # trips that no longer exist under current data/rules.
        dcon.execute("DELETE FROM trips WHERE start_date >= ?", (start,))

        context = _day_context(lcon, start, end)
        has_location_days = bool(lcon.execute(
            "SELECT name FROM sqlite_master WHERE name='location_days'"
        ).fetchone())

        written = 0
        for run in runs:
            start_d, end_d = run[0], run[-1]
            n_nights = (date.fromisoformat(end_d) - date.fromisoformat(start_d)).days + 1

            countries: Counter = Counter()
            cities: Counter = Counter()
            cur = date.fromisoformat(start_d)
            while cur <= date.fromisoformat(end_d):
                ctx = context.get(cur.isoformat())
                if ctx:
                    for c, n in ctx["countries"].items():
                        countries[to_english(c)] += n
                    cities.update(ctx["cities"])
                cur += timedelta(days=1)

            max_dist = max(away[d] for d in run)
            primary = countries.most_common(1)[0][0] if countries else None

            total_km = None
            if has_location_days:
                row = lcon.execute(
                    "SELECT SUM(distance_meters)/1000.0 AS km FROM location_days WHERE date BETWEEN ? AND ?",
                    (start_d, end_d),
                ).fetchone()
                if row and row["km"]:
                    total_km = round(row["km"], 1)

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
                    f"{primary or 'Away'} · {n_nights} night{'s' if n_nights != 1 else ''}",
                    photo_row["photo_path"] if photo_row else None,
                    home["label"] if home else None,
                ),
            )
            written += 1
            if verbose:
                print(f"  ✓ {start_d} → {end_d}: {primary or 'Away'} ({n_nights} nights, max {max_dist:.0f} km)")

        dcon.commit()
        return written
    finally:
        lcon.close()
        dcon.close()


def main() -> None:
    full = "--full" in sys.argv
    end = date.today().isoformat()
    start = "2013-01-01" if full else (date.today() - timedelta(days=120)).isoformat()
    print(f"detecting trips (nights away from home) {start} → {end}")
    n = detect(start, end)
    print(f"{n} trips upserted.")


if __name__ == "__main__":
    main()
