"""
Auto-detected trips (Plan B.2) — nights-away-from-home semantics.

A day counts as an *away night* when the LAST observation of that day (latest
visit end / Overland ping) is further than the active home's radius from the
home-base centroid for that date (home_base.home_for). Day-trips that end back
home — a pilot flying out and sleeping in their own bed — are NOT trips.

A trip = consecutive away nights. Sleeping at home breaks the trip. Days with
no data between two away nights are bridged (assumed still away, up to 3 days).
Single-night layovers count.

Late landings: a pilot working an evening rotation often lands back home after
midnight, so the last observation of the calendar day is still at the
outstation. Two signals rescue those nights (see detect/_home_landings):
  - GPS: if the first fix of the next day is at home and comes within
    LATE_RETURN_MAX_GAP_H of the day's last (away) fix, you flew home that
    night — the night counts as home.
  - Logbook: if the day's last logged flight lands at an airport inside the
    home radius and no GPS fix is later than that on-block, it's a home night.

Manual splits: one detected run can be two trips (Tenerife → Barcelona → somewhere
else, never sleeping at home in between). trip_splits holds the days a new trip
starts; the detector cuts runs there on every rebuild, so a split survives the
nightly recompute. split_trip()/join_trip() add/remove one and rebuild just that
trip's window (bounded detect), keeping the names you gave.

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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from domains.locations.country_names import to_english
from domains.locations.home_base import home_for

_ROOT = Path(__file__).parents[2]
_DAYBOOK_DB = _ROOT / "infrastructure" / "db" / "daybook.db"
_LOCATIONS_DB = _ROOT / "infrastructure" / "db" / "locations.db"

MIN_AWAY_KM = 40.0        # floor for the "not sleeping at home" radius
BRIDGE_UNKNOWN_DAYS = 3   # no-data days between away nights assumed still away
LATE_RETURN_MAX_GAP_H = 7.0  # away fix → home fix gap that still means "flew
                              # home tonight" (sector + turnaround + drive)
TRIP_LOOKBACK_DAYS = 60   # buffer scanned before the window to catch a trip
                          # already in progress at `start` (longest plausible trip)


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
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    # Naive stamps are UTC; normalise so visits and pings compare safely.
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _observations(lcon: sqlite3.Connection, start: str, end: str) -> dict[str, tuple]:
    """date → ((ts, lat, lng) first fix, (ts, lat, lng) last fix), visits ∪ overland."""
    first: dict[str, tuple] = {}
    last: dict[str, tuple] = {}

    def _add(d: str, ts_raw: str, lat: float, lng: float) -> None:
        ts = _parse_ts(ts_raw)
        if ts is None:
            return
        if d not in first or ts < first[d][0]:
            first[d] = (ts, lat, lng)
        if d not in last or ts > last[d][0]:
            last[d] = (ts, lat, lng)

    for r in lcon.execute(
        """SELECT date, lat, lng, start_time, COALESCE(end_time, start_time) AS end_ts
           FROM visits
           WHERE date BETWEEN ? AND ? AND lat IS NOT NULL AND lat != 0""",
        (start, end),
    ):
        _add(r["date"], r["start_time"], r["lat"], r["lng"])
        _add(r["date"], r["end_ts"], r["lat"], r["lng"])

    for r in lcon.execute(
        """SELECT date, lat, lng, recorded_at AS ts
           FROM overland_locations
           WHERE date BETWEEN ? AND ? AND lat IS NOT NULL""",
        (start, end),
    ):
        _add(r["date"], r["ts"], r["lat"], r["lng"])

    return {d: (first[d], last[d]) for d in last}


def _home_landings(dcon: sqlite3.Connection, start: str, end: str) -> dict[str, tuple]:
    """date → (on_block ts, lat, lng) of the day's LAST logged flight arrival."""
    try:
        rows = dcon.execute(
            """SELECT f.date, COALESCE(f.on_block_utc, f.landing_utc) AS ts,
                      a.latitude AS lat, a.longitude AS lng
               FROM flights f JOIN airports a ON a.icao = f.arr_icao
               WHERE f.is_sim = 0 AND f.date BETWEEN ? AND ?
                 AND a.latitude IS NOT NULL""",
            (start, end),
        ).fetchall()
    except sqlite3.OperationalError:
        return {}  # no logbook tables
    out: dict[str, tuple] = {}
    for r in rows:
        ts = _parse_ts(r["ts"])
        if ts is None:
            continue
        cur = out.get(r["date"])
        if cur is None or ts > cur[0]:
            out[r["date"]] = (ts, r["lat"], r["lng"])
    return out


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


SPLITS_DDL = """CREATE TABLE IF NOT EXISTS trip_splits (
    split_date TEXT PRIMARY KEY,               -- a new trip starts on this (away) night
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))"""


def _splits(dcon: sqlite3.Connection) -> list[str]:
    dcon.execute(SPLITS_DDL)
    return [r[0] for r in dcon.execute("SELECT split_date FROM trip_splits ORDER BY split_date")]


def apply_splits(runs: list[list[str]], splits: list[str]) -> list[list[str]]:
    """Cut each run of away nights at the split days that fall inside it (after its first night)."""
    out: list[list[str]] = []
    for run in runs:
        piece: list[str] = []
        cuts = [s for s in splits if run[0] < s <= run[-1]]
        for d in run:
            if cuts and d >= cuts[0] and piece:
                out.append(piece)
                piece = []
                while cuts and d >= cuts[0]:
                    cuts.pop(0)
            piece.append(d)
        out.append(piece)
    return out


def detect(start: str, end: str, verbose: bool = True, bounded: bool = False) -> int:
    """Rebuild the trips from `start`. Unbounded (nightly): every trip from there on is rewritten.
    Bounded: only trips overlapping [start, end] — for a split/join of one trip in the past."""
    lcon = _conn(_LOCATIONS_DB)
    dcon = _conn(_DAYBOOK_DB)
    try:
        # Scan a buffer *before* the requested window so a trip already in
        # progress at `start` is detected from its true beginning, not split
        # into a duplicate fragment. (The old code wiped only start_date >= start
        # and re-detected from start, leaving the earlier half of a straddling
        # trip behind AND creating an overlapping fragment for the same days.)
        scan_start = (date.fromisoformat(start) - timedelta(days=TRIP_LOOKBACK_DAYS)).isoformat()

        # bounded: look a couple of days past `end` for the late-return check and the home-coming day
        scan_end = (date.fromisoformat(end) + timedelta(days=2)).isoformat() if bounded else end
        obs = _observations(lcon, scan_start, scan_end)
        landings = _home_landings(dcon, scan_start, scan_end)

        # Classify each observed date: away night / home night
        away: dict[str, float] = {}   # date → distance from home that night
        home_nights: set[str] = set()
        for d in sorted(obs):
            home = home_for(d)
            if home is None:
                continue
            radius = max(home.get("radius_km") or MIN_AWAY_KM, MIN_AWAY_KM)

            def _dist(lat: float, lng: float) -> float:
                return _haversine_km(home["lat"], home["lng"], lat, lng)

            last_ts, lat, lng = obs[d][1]
            dist = _dist(lat, lng)
            if dist > radius:
                # Late return: woke up at home after a short gap → flew home
                # after midnight; the night was spent in your own bed.
                nxt = obs.get((date.fromisoformat(d) + timedelta(days=1)).isoformat())
                if nxt:
                    n_ts, n_lat, n_lng = nxt[0]
                    gap_h = (n_ts - last_ts).total_seconds() / 3600
                    if gap_h <= LATE_RETURN_MAX_GAP_H and _dist(n_lat, n_lng) <= radius:
                        dist = 0.0
                # Logbook: last sector landed at home and nothing later says
                # otherwise (GPS gap at the end of a late duty).
                landing = landings.get(d)
                if landing and landing[0] >= last_ts and _dist(landing[1], landing[2]) <= radius:
                    dist = 0.0
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
        runs = apply_splits(runs, _splits(dcon))

        # Only trips reaching into the requested window are this run's
        # responsibility. A run that started in the look-back buffer but
        # continues past `start` is rewritten whole from its true start; runs
        # living entirely in the buffer (end < start) are left untouched.
        relevant = [run for run in runs if run[-1] >= start and (not bounded or run[0] <= end)]
        effective_start = relevant[0][0] if relevant else start
        # bounded: wipe only what overlaps the rebuilt trips; unbounded: everything from there on
        effective_end = max([end] + [r[-1] for r in relevant]) if bounded else "9999-12-31"

        # Preserve user overrides (custom names + dismissed trips) across the
        # wipe. They're keyed by (start_date, end_date) and MUST survive nightly
        # recompute — otherwise a rename or delete of any trip in the look-back
        # window is silently erased the next night.
        has_hidden_col = any(
            r["name"] == "hidden" for r in dcon.execute("PRAGMA table_info(trips)")
        )
        ov_cols = "start_date, end_date, user_name" + (", hidden" if has_hidden_col else "")
        overrides = {
            (r["start_date"], r["end_date"]): r
            for r in dcon.execute(
                f"SELECT {ov_cols} FROM trips WHERE end_date >= ? AND start_date <= ?",
                (effective_start, effective_end),
            ).fetchall()
        }

        # Wipe every existing trip that OVERLAPS [effective_start, end] before
        # re-inserting, so rule/data changes, merged trips, and straddling trips
        # never leave stale or overlapping rows behind.
        dcon.execute("DELETE FROM trips WHERE end_date >= ? AND start_date <= ?", (effective_start, effective_end))

        context = _day_context(lcon, scan_start, end)
        has_location_days = bool(lcon.execute(
            "SELECT name FROM sqlite_master WHERE name='location_days'"
        ).fetchone())

        written = 0
        for run in relevant:
            start_d, end_d = run[0], run[-1]
            n_nights = (date.fromisoformat(end_d) - date.fromisoformat(start_d)).days + 1

            # The home-coming day: the day after the last away night, IF you
            # slept back home that night. That's the travel-home leg — part of
            # the trip (photos, spending, the journey) even though it's not an
            # away night, so it doesn't change n_nights. Left NULL when there's
            # no data for that day (trip may still be ongoing / gap in tracking).
            next_day = (date.fromisoformat(end_d) + timedelta(days=1)).isoformat()
            return_date = next_day if next_day in home_nights else None

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
                """INSERT INTO trips (start_date, end_date, return_date, primary_country, countries_json,
                                      cities_json, total_km, max_distance_from_home_km,
                                      auto_name, cover_photo_path, home_at_start)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(start_date, end_date) DO UPDATE SET
                     return_date=excluded.return_date,
                     primary_country=excluded.primary_country,
                     countries_json=excluded.countries_json,
                     cities_json=excluded.cities_json,
                     total_km=excluded.total_km,
                     max_distance_from_home_km=excluded.max_distance_from_home_km,
                     auto_name=excluded.auto_name,
                     cover_photo_path=excluded.cover_photo_path,
                     home_at_start=excluded.home_at_start""",
                (
                    start_d, end_d, return_date, primary,
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

        # Re-apply user overrides to any window that still exists after recompute
        # (matched by exact start/end — a trip whose boundaries shifted is a new
        # trip and correctly starts without an override).
        for (s_d, e_d), r in overrides.items():
            user_name = r["user_name"]
            hidden = r["hidden"] if has_hidden_col else 0
            sets, params = [], []
            if user_name is not None:
                sets.append("user_name = ?"); params.append(user_name)
            if has_hidden_col and hidden:
                sets.append("hidden = ?"); params.append(hidden)
            if not sets:
                continue
            params += [s_d, e_d]
            dcon.execute(
                f"UPDATE trips SET {', '.join(sets)} WHERE start_date = ? AND end_date = ?",
                params,
            )

        dcon.commit()
        return written
    finally:
        lcon.close()
        dcon.close()


def _trip(dcon: sqlite3.Connection, start: str, end: str):
    return dcon.execute("SELECT * FROM trips WHERE start_date=? AND end_date=?", (start, end)).fetchone()


def _pieces(start: str, end: str) -> list[dict]:
    dcon = _conn(_DAYBOOK_DB)
    try:
        return [dict(r) for r in dcon.execute(
            "SELECT start_date, end_date, return_date, COALESCE(user_name, auto_name) AS name FROM trips "
            "WHERE start_date <= ? AND end_date >= ? ORDER BY start_date", (end, start))]
    finally:
        dcon.close()


def _name(start: str, end: str, name: str | None) -> None:
    if not name or not name.strip():
        return
    dcon = _conn(_DAYBOOK_DB)
    try:
        dcon.execute("UPDATE trips SET user_name=? WHERE start_date=? AND end_date=?", (name.strip(), start, end))
        dcon.commit()
    finally:
        dcon.close()


def split_trip(start: str, end: str, on: str, names: tuple[str | None, str | None] = (None, None)) -> list[dict]:
    """Make `on` (an away night after the first) the first night of a new trip. Returns both trips."""
    dcon = _conn(_DAYBOOK_DB)
    try:
        t = _trip(dcon, start, end)
        if t is None:
            raise LookupError("trip not found")
        if not start < on <= end:
            raise ValueError("the new trip has to start after the first night and by the last one")
        keep = t["user_name"]
        dcon.execute(SPLITS_DDL)
        dcon.execute("INSERT OR IGNORE INTO trip_splits (split_date) VALUES (?)", (on,))
        dcon.commit()
    finally:
        dcon.close()
    detect(start, end, verbose=False, bounded=True)
    pieces = _pieces(start, end)
    for i, p in enumerate(pieces[:2]):
        # the first part keeps the trip's own name unless you gave it another
        _name(p["start_date"], p["end_date"], names[i] or (keep if i == 0 else None))
    return _pieces(start, end)


def join_trip(start: str, end: str) -> list[dict]:
    """Undo the split that started this trip: it joins the trip before it again."""
    dcon = _conn(_DAYBOOK_DB)
    try:
        dcon.execute(SPLITS_DDL)
        if not dcon.execute("SELECT 1 FROM trip_splits WHERE split_date=?", (start,)).fetchone():
            raise ValueError("this trip wasn't split from the one before")
        prev = dcon.execute("SELECT start_date, user_name FROM trips WHERE end_date < ? ORDER BY end_date DESC LIMIT 1",
                            (start,)).fetchone()
        dcon.execute("DELETE FROM trip_splits WHERE split_date=?", (start,))
        dcon.commit()
    finally:
        dcon.close()
    first = prev["start_date"] if prev else start
    detect(first, end, verbose=False, bounded=True)
    pieces = _pieces(first, end)
    if prev is not None and pieces:
        _name(pieces[0]["start_date"], pieces[0]["end_date"], prev["user_name"])
    return _pieces(first, end)


def main() -> None:
    full = "--full" in sys.argv
    end = date.today().isoformat()
    start = "2013-01-01" if full else (date.today() - timedelta(days=120)).isoformat()
    print(f"detecting trips (nights away from home) {start} → {end}")
    n = detect(start, end)
    print(f"{n} trips upserted.")


if __name__ == "__main__":
    main()
