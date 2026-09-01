#!/usr/bin/env python3
"""
Flight-aware filtering of Overland GPS points.

When flying — especially as operating crew — the phone keeps logging GPS while
airborne, scattering random en-route points across the flight path. Those
pollute the map, the "places visited" list, the country/city rollups and the
distance stats (a hop over France logs a bogus "France" visit, etc.).

Two independent defences live here:

  1. is_airborne() — a real-time guard used at ingest (see the /ingest/overland
     endpoint). It drops points that are obviously in the air (high GPS altitude
     or an impossible ground speed) *before* they are ever stored, so it works
     even when the flight has not been logged in the logbook yet.

  2. cleanup_flight_points() — a retroactive sweep. For every logged flight it
     deletes overland points whose UTC timestamp falls inside the flight's block
     window and removes any track segments built purely from those en-route
     points, then rebuilds the location_days summary for the touched dates. This
     is the fix for data captured before the guard existed.

All logbook times are UTC; overland recorded_at is stored UTC ('...Z'). The
logbook stores the offset form ('...+00:00'), overland the 'Z' form — we
normalise both to the 'Z' form before any string comparison.
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT          = Path(__file__).parents[2]
LOCATIONS_DB  = ROOT / "infrastructure" / "db" / "locations.db"
DAYBOOK_DB    = ROOT / "infrastructure" / "db" / "daybook.db"

# ── Ingest guard thresholds ──────────────────────────────────────────────────
# Altitude: highest paved roads / lifts in Europe top out < 4000 m (Pico de
# Veleta ~2.8 km, Aiguille du Midi ~3.8 km), while cruise sits at 10–12 km and
# even the climb/descent that dips below 4000 m happens right over the airport —
# already a legitimately-recorded place. Anything above is airborne.
AIRBORNE_ALT_M    = 4000.0
# Speed: 110 m/s ≈ 396 km/h. No ground transport reaches it; aircraft always do.
AIRBORNE_SPEED_MS = 110.0


def is_airborne(altitude: float | None, speed: float | None) -> bool:
    """True if a GPS fix is almost certainly taken in the air.

    Uses GPS altitude and ground speed, both optional (Overland reports -1 or
    omits them when unavailable), so each signal is only trusted when positive.
    """
    if altitude is not None and altitude > AIRBORNE_ALT_M:
        return True
    if speed is not None and speed > AIRBORNE_SPEED_MS:
        return True
    return False


# ── Flight windows ───────────────────────────────────────────────────────────

def _to_z(iso: str | None) -> str | None:
    """Normalise any ISO timestamp to the UTC 'YYYY-MM-DDTHH:MM:SSZ' form."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def flight_windows(date: str | None = None) -> list[tuple[str, str]]:
    """Return (start_z, end_z) UTC windows for every real (non-sim) flight.

    The window is the block period (off-block → on-block), falling back to the
    airborne period (takeoff → landing) when block times are missing. If `date`
    is given, only windows that touch that calendar date (at either end, so
    midnight-crossing flights are included) are returned.
    """
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


# ── Retroactive cleanup ──────────────────────────────────────────────────────

def cleanup_flight_points(date: str | None = None, verbose: bool = True) -> dict:
    """Delete en-route Overland points (and purely-en-route track segments) that
    fall inside logged flight windows, then rebuild location_days for touched
    dates.

    A track segment is removed only when it lies *entirely* within a flight
    window (segment_start and segment_end both inside) — i.e. it was built from
    nothing but airborne points. Segments that merely clip a window edge (taxi /
    airport dwell) are left alone, so real airport visits survive.

    Pass `date` to limit the sweep to flights touching that day.
    Returns a stats dict.
    """
    windows = flight_windows(date)
    if not windows:
        if verbose:
            print("No flight windows to clean.")
        return {"deleted_points": 0, "deleted_tracks": 0, "affected_dates": []}

    con = sqlite3.connect(LOCATIONS_DB)
    con.row_factory = sqlite3.Row

    deleted_points = deleted_tracks = 0
    affected_dates: set[str] = set()

    for start, end in windows:
        cur = con.execute(
            "DELETE FROM overland_locations WHERE recorded_at >= ? AND recorded_at <= ?",
            (start, end),
        )
        dp = cur.rowcount or 0
        cur = con.execute(
            "DELETE FROM tracks WHERE segment_start >= ? AND segment_end <= ?",
            (start, end),
        )
        dt = cur.rowcount or 0
        if dp or dt:
            affected_dates.add(start[:10])
            affected_dates.add(end[:10])
            if verbose:
                print(f"  {start} → {end}: -{dp} points, -{dt} tracks")
        deleted_points += dp
        deleted_tracks += dt

    con.commit()

    # Rebuild the daily summary for every touched date. If a date lost all its
    # tracks (e.g. a positioning-flight day with nothing but en-route pings),
    # drop its stale location_days row instead of leaving old numbers behind.
    from domains.locations.overland_process import _upsert_location_day
    for d in sorted(affected_dates):
        remaining = con.execute(
            "SELECT COUNT(*) FROM tracks WHERE date = ?", (d,)
        ).fetchone()[0]
        if remaining:
            _upsert_location_day(con, d)
        else:
            con.execute("DELETE FROM location_days WHERE date = ?", (d,))
    con.commit()
    con.close()

    if verbose:
        print(
            f"Done: removed {deleted_points} en-route points and {deleted_tracks} "
            f"track segments across {len(affected_dates)} date(s)."
        )
    return {
        "deleted_points": deleted_points,
        "deleted_tracks": deleted_tracks,
        "affected_dates": sorted(affected_dates),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove en-route Overland GPS points that fall inside logged flight windows"
    )
    parser.add_argument("date", nargs="?", help="Only clean flights touching this date (YYYY-MM-DD)")
    args = parser.parse_args()
    cleanup_flight_points(date=args.date)


if __name__ == "__main__":
    main()
