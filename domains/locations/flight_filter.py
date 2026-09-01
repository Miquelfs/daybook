#!/usr/bin/env python3
"""
Flight-aware filtering of Overland GPS points.

When flying — especially as operating crew — the phone keeps logging GPS while
airborne, scattering random en-route points across the flight path. Those
pollute the map, the "places visited" list, the country/city rollups and the
distance stats (a hop over France logs a bogus "France" visit, etc.).

The robust, logbook-independent signal is the *implied speed between
consecutive fixes*: a point you both arrive at and leave at flight speed, over a
long hop, is a pass-through — you never stopped there. Real places (airports,
cities) always have a slow side (you dwell, taxi, or drive), so they survive.
This works even when altitude/speed are missing on the fix (Overland often
reports neither in flight) and even when the flight has not been logged in the
logbook yet — which is the normal case, since the roster is imported well after
the trip.

Layers, strongest first:

  1. drop_enroute() — the inter-point-speed rule above. Used both retroactively
     (cleanup) and forward (in the background processor, per date).
  2. is_airborne() — a cheap per-fix ingest guard that drops obviously-airborne
     fixes (high GPS altitude / impossible ground speed) before they are stored.
  3. flight windows — when a real flight *is* logged, its block window (UTC) is
     an extra deletion pass. Complementary; never required.

cleanup_flight_points() applies (1) and (3) over stored data and rebuilds the
location_days summary for touched dates. It re-runs safely (idempotent).

All logbook times are UTC; overland recorded_at is stored UTC ('...Z'). The
logbook stores the offset form ('...+00:00'); we normalise both before use.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT          = Path(__file__).parents[2]
LOCATIONS_DB  = ROOT / "infrastructure" / "db" / "locations.db"
DAYBOOK_DB    = ROOT / "infrastructure" / "db" / "daybook.db"

# ── Ingest guard thresholds (per-fix) ────────────────────────────────────────
# Altitude: highest paved roads / lifts in Europe top out < 4000 m (Pico de
# Veleta ~2.8 km, Aiguille du Midi ~3.8 km); cruise sits at 10–12 km. Anything
# above is airborne. Both fields are optional (Overland reports -1 or omits
# them), so each is only trusted when positive.
AIRBORNE_ALT_M    = 4000.0
AIRBORNE_SPEED_MS = 110.0   # ≈ 396 km/h — no ground transport reaches it

# ── Inter-point heuristic thresholds ─────────────────────────────────────────
# A leg is "flight-like" only when it is BOTH long and fast, so GPS jitter (tiny
# fast hops) and normal ground travel (long but slow) are both excluded. 300 km/h
# sits above sustained high-speed rail; 30 km protects short legit hops between
# nearby places from being mistaken for flight.
FLIGHT_SPEED_KMH  = 300.0
MIN_FLIGHT_HOP_KM = 30.0


def is_airborne(altitude: float | None, speed: float | None) -> bool:
    """True if a single GPS fix is almost certainly taken in the air."""
    if altitude is not None and altitude > AIRBORNE_ALT_M:
        return True
    if speed is not None and speed > AIRBORNE_SPEED_MS:
        return True
    return False


# ── Geometry / time helpers ──────────────────────────────────────────────────

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _path_len_km(coords: list[tuple[float, float]]) -> float:
    """Total length of a polyline of (lat, lng) points."""
    return sum(
        _haversine_km(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
        for i in range(1, len(coords))
    )


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _to_z(iso: str | None) -> str | None:
    dt = _parse(iso)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


# ── Core: en-route detection ─────────────────────────────────────────────────

def _leg_is_flight(a: dict, b: dict) -> bool:
    """True if travelling from item `a` to item `b` required flight — a hop both
    long (> MIN_FLIGHT_HOP_KM) and fast (> FLIGHT_SPEED_KMH).

    Timing is midpoint-to-midpoint (`t`), NOT end-to-start: legacy 2-hour
    "bucket" tracks are stored contiguously (one bucket's end == the next's
    start), so an end-to-start gap collapses to zero and a slow continuous drive
    would look like a teleport. Midpoint spacing reflects the real average speed
    of that leg. A non-positive gap (duplicate/degenerate timestamps) is treated
    as "not a flight" — we never flag when we cannot actually measure speed.
    """
    if a["lat"] is None or b["lat"] is None:
        return False
    d_km = _haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])
    if d_km < MIN_FLIGHT_HOP_KM:
        return False
    dt_s = (b["t"] - a["t"]).total_seconds()
    if dt_s <= 0:
        return False
    return (d_km / (dt_s / 3600.0)) > FLIGHT_SPEED_KMH


def drop_enroute(items: list[dict]) -> set[int]:
    """Return the indices of chronologically-ordered items that are en-route: a
    fix reached AND left by a flight-like leg (a pass-through). Terminal points
    of a flight keep a slow side and are never flagged.

    Each item is a dict with keys lat, lng, t (representative midpoint datetime).
    """
    n = len(items)
    flagged: set[int] = set()
    for i in range(n):
        prev_fast = _leg_is_flight(items[i - 1], items[i]) if i > 0 else False
        next_fast = _leg_is_flight(items[i], items[i + 1]) if i < n - 1 else False
        if prev_fast and next_fast:
            flagged.add(i)
    return flagged


# ── Flight windows (complementary layer, only when a flight is logged) ────────

def flight_windows(date: str | None = None) -> list[tuple[str, str]]:
    """(start_z, end_z) UTC block windows for every real (non-sim) flight,
    optionally limited to windows touching `date` (at either end)."""
    if not DAYBOOK_DB.exists():
        return []
    con = sqlite3.connect(DAYBOOK_DB)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """SELECT off_block_utc, takeoff_utc, landing_utc, on_block_utc
               FROM flights WHERE COALESCE(is_sim, 0) = 0"""
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        con.close()

    windows: list[tuple[str, str]] = []
    for r in rows:
        start = _to_z(r["off_block_utc"] or r["takeoff_utc"])
        end   = _to_z(r["on_block_utc"] or r["landing_utc"])
        if not start or not end or end <= start:
            continue
        if date and date not in (start[:10], end[:10]):
            continue
        windows.append((start, end))
    return windows


# ── Per-date cleanup ─────────────────────────────────────────────────────────

def _clean_date(con: sqlite3.Connection, date: str, windows: list[tuple[str, str]]) -> tuple[int, int]:
    """Remove en-route raw points and en-route track segments for one date.
    Returns (deleted_points, deleted_tracks). Does not commit or recompute
    summaries — the caller does that."""
    # 1) Raw overland points — inter-point speed.
    pts = con.execute(
        "SELECT id, recorded_at, lat, lng FROM overland_locations WHERE date = ? ORDER BY recorded_at",
        (date,),
    ).fetchall()
    items = [
        {"id": r["id"], "lat": r["lat"], "lng": r["lng"], "t": _parse(r["recorded_at"])}
        for r in pts
    ]
    drop_ids = {items[i]["id"] for i in drop_enroute(items)}

    # Also drop any raw point inside a logged flight window for this date.
    for i, r in enumerate(pts):
        z = _to_z(r["recorded_at"])
        if z and any(s <= z <= e for s, e in windows):
            drop_ids.add(r["id"])

    deleted_points = 0
    if drop_ids:
        con.executemany("DELETE FROM overland_locations WHERE id = ?", [(i,) for i in drop_ids])
        deleted_points = len(drop_ids)

    # 2) Track segments. Two shapes coexist in this table:
    #    - single-fix pings (Overland): one point, exact timestamp.
    #    - multi-point "bucket" segments (legacy Google import): a whole arc of
    #      the path over a 2-hour window.
    #    So we drop a segment when EITHER
    #    (a) its own points span a long distance at flight speed — an airborne
    #        arc (a drive bucket stays well under the threshold), OR
    #    (b) it is a single fix that is a pass-through (arrived and left by a
    #        flight-like leg). Multi-point buckets are judged only by (a); their
    #        first-coordinate is meaningless for the between-segment test.
    trks = con.execute(
        "SELECT id, segment_start, segment_end, points_json FROM tracks WHERE date = ? ORDER BY segment_start",
        (date,),
    ).fetchall()
    drop_trk: set[int] = set()
    titems = []
    for r in trks:
        coords: list[tuple[float, float]] = []
        try:
            coords = [(p["lat"], p["lng"]) for p in json.loads(r["points_json"])
                      if "lat" in p and "lng" in p]
        except (ValueError, TypeError):
            pass
        s, e = _parse(r["segment_start"]), _parse(r["segment_end"])
        mid = s + (e - s) / 2 if s and e else (s or e)
        n = len(coords)
        lat, lng = coords[0] if coords else (None, None)
        titems.append({"id": r["id"], "lat": lat, "lng": lng, "t": mid, "n": n})

        # (a) airborne arc — segment's own points span far, fast.
        if n >= 2 and s and e:
            dur_h = (e - s).total_seconds() / 3600.0
            span = _path_len_km(coords)
            if dur_h > 0 and span > MIN_FLIGHT_HOP_KM and span / dur_h > FLIGHT_SPEED_KMH:
                drop_trk.add(r["id"])

    # (b) pass-through single fixes (neighbours provide context but only
    #     single-point segments are eligible to be dropped this way).
    for i in drop_enroute(titems):
        if titems[i]["n"] <= 1:
            drop_trk.add(titems[i]["id"])

    # Also drop track segments lying entirely inside a logged flight window.
    for r in trks:
        s, e = _to_z(r["segment_start"]), _to_z(r["segment_end"])
        if s and e and any(ws <= s and e <= we for ws, we in windows):
            drop_trk.add(r["id"])

    deleted_tracks = 0
    if drop_trk:
        con.executemany("DELETE FROM tracks WHERE id = ?", [(i,) for i in drop_trk])
        deleted_tracks = len(drop_trk)

    return deleted_points, deleted_tracks


def cleanup_flight_points(date: str | None = None, verbose: bool = True) -> dict:
    """Remove en-route Overland points and track segments, then rebuild the
    location_days summary for every touched date.

    Pass `date` to clean a single day (used by the ingest processor); omit it to
    sweep the entire history (the one-off retroactive fix). Idempotent.
    """
    con = sqlite3.connect(LOCATIONS_DB)
    con.row_factory = sqlite3.Row

    if date:
        dates = [date]
    else:
        dates = sorted({
            r[0] for r in con.execute(
                "SELECT date FROM overland_locations UNION SELECT date FROM tracks"
            )
        })

    windows_all = flight_windows()  # small; reused across dates
    from domains.locations.overland_process import _upsert_location_day

    deleted_points = deleted_tracks = 0
    touched: list[str] = []
    for d in dates:
        wins = [w for w in windows_all if d in (w[0][:10], w[1][:10])]
        # Removing an en-route segment can make its neighbours adjacent and
        # expose a further pass-through, so converge before recomputing.
        dp = dt = 0
        while True:
            ddp, ddt = _clean_date(con, d, wins)
            dp += ddp
            dt += ddt
            if not (ddp or ddt):
                break
        if dp or dt:
            con.commit()
            remaining = con.execute("SELECT COUNT(*) FROM tracks WHERE date = ?", (d,)).fetchone()[0]
            if remaining:
                _upsert_location_day(con, d)
            else:
                con.execute("DELETE FROM location_days WHERE date = ?", (d,))
            con.commit()
            deleted_points += dp
            deleted_tracks += dt
            touched.append(d)
            if verbose:
                print(f"  {d}: -{dp} points, -{dt} tracks")

    con.close()
    if verbose:
        print(
            f"Done: removed {deleted_points} en-route points and {deleted_tracks} "
            f"track segments across {len(touched)} date(s)."
        )
    return {
        "deleted_points": deleted_points,
        "deleted_tracks": deleted_tracks,
        "affected_dates": touched,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove en-route Overland GPS points (flight pass-throughs) from tracks/places"
    )
    parser.add_argument("date", nargs="?", help="Only clean this date (YYYY-MM-DD); omit to sweep all history")
    args = parser.parse_args()
    cleanup_flight_points(date=args.date)


if __name__ == "__main__":
    main()
