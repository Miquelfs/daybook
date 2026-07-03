"""
Phase 4: CTL/ATL/TSB Fitness & Freshness engine.

Computes per-sport and combined training load series into training_load_daily.

Run from daybook/ root:
    python -m domains.health.compute_training_load [options]

Options:
    --backfill-days N   Backfill last N days (default: 365 on first run, 7 on daily)
    --full-history      Backfill from the earliest activity date
    --sport SPORT       Only compute for one sport (run|ride|swim|combined)

Algorithm (Banister impulse-response):
    daily_tss(t) = sum of TSS from activities on date t
                   (uses training_stress_score if available, else hr_tss from activity_detail)
    CTL(t) = CTL(t-1) + (tss(t) - CTL(t-1)) * (1 - exp(-1/42))   [42-day EWMA]
    ATL(t) = ATL(t-1) + (tss(t) - ATL(t-1)) * (1 - exp(-1/7))    [7-day EWMA]
    TSB(t) = CTL(t-1) - ATL(t-1)                                   [form = yesterday state]
    ramp_rate = CTL(t) - CTL(t-7)                                  [weekly fitness change]
"""

import argparse
import math
import sys
from datetime import date, timedelta
from pathlib import Path

_ROOT = Path(__file__).parents[2]

from infrastructure.db.connection import get_connection

SPORTS = ["run", "ride", "swim", "other"]

SPORT_MAP = {
    "running": "run", "trail_running": "run", "indoor_running": "run",
    "track_running": "run", "virtual_run": "run", "treadmill_running": "run",
    "cycling": "ride", "road_biking": "ride", "mountain_biking": "ride",
    "indoor_cycling": "ride", "virtual_ride": "ride", "gravel_cycling": "ride",
    "swimming": "swim", "lap_swimming": "swim", "open_water_swimming": "swim",
}

# EWMA decay constants
TAU_CTL = 42.0   # chronic (fitness)
TAU_ATL = 7.0    # acute (fatigue)
K_CTL = 1 - math.exp(-1 / TAU_CTL)
K_ATL = 1 - math.exp(-1 / TAU_ATL)


def _normalize_sport(activity_type: str | None) -> str:
    if not activity_type:
        return "other"
    return SPORT_MAP.get(activity_type.lower(), "other")


def _get_date_range(conn, args) -> tuple[date, date]:
    if args.full_history:
        row = conn.execute("SELECT MIN(date) FROM activities WHERE source='garmin'").fetchone()
        start = date.fromisoformat(row[0]) if row and row[0] else date(2019, 1, 1)
    elif args.backfill_days:
        start = date.today() - timedelta(days=args.backfill_days)
    else:
        # Start from earliest date not yet in training_load_daily
        row = conn.execute("SELECT MAX(date) FROM training_load_daily").fetchone()
        if row and row[0]:
            start = date.fromisoformat(row[0]) - timedelta(days=2)  # recalc last 2 days for safety
        else:
            # No data yet — backfill 365 days
            start = date.today() - timedelta(days=365)

    return start, date.today()


def _estimate_tss(duration_s: float | None, avg_hr: float | None,
                   threshold_hr: float = 155.0, max_hr: float = 195.0) -> float:
    """
    Rough hrTSS estimate from duration + avg HR when no stream data is available.
    Uses a simplified TRIMP: 60 min at threshold = 100 TSS.
    """
    if not duration_s or duration_s <= 0:
        return 0.0
    hr = avg_hr or threshold_hr
    hr_reserve_max = max_hr - 60
    hr_ratio = max(0.0, min(1.0, (hr - 60) / hr_reserve_max))
    trimp_per_s = hr_ratio * 0.64 * math.exp(1.92 * hr_ratio)
    trimp_total = duration_s * trimp_per_s
    thr_ratio = (threshold_hr - 60) / hr_reserve_max
    trimp_1hr_thr = 3600 * thr_ratio * 0.64 * math.exp(1.92 * thr_ratio)
    if trimp_1hr_thr <= 0:
        return 0.0
    return (trimp_total / trimp_1hr_thr) * 100


def _build_daily_tss(conn, start: date, end: date) -> dict[str, dict[str, float]]:
    """
    Build {date_str: {sport: tss}} for all dates in range.
    Priority: Garmin native TSS > computed hr_tss from streams > estimated from duration+avgHR.
    """
    rows = conn.execute(
        """SELECT a.date, a.activity_type,
                  a.training_stress_score,
                  ad.hr_tss,
                  a.duration_seconds,
                  a.avg_heart_rate
           FROM activities a
           LEFT JOIN activity_detail ad ON ad.activity_id = a.id
           WHERE a.source='garmin'
             AND a.date >= ? AND a.date <= ?
             AND (a.duration_seconds IS NOT NULL AND a.duration_seconds > 0)
           ORDER BY a.date""",
        (start.isoformat(), end.isoformat())
    ).fetchall()

    daily: dict[str, dict[str, float]] = {}
    for row in rows:
        act_date, act_type, native_tss, hr_tss, duration_s, avg_hr = row
        sport = _normalize_sport(act_type)

        if native_tss and native_tss > 0:
            tss = float(native_tss)
        elif hr_tss and hr_tss > 0:
            tss = float(hr_tss)
        else:
            tss = _estimate_tss(duration_s, avg_hr)

        if act_date not in daily:
            daily[act_date] = {s: 0.0 for s in SPORTS}
        daily[act_date][sport] = daily[act_date].get(sport, 0.0) + tss

    return daily


def _get_seed_ctl_atl(conn, before_date: date, sport: str) -> tuple[float, float]:
    """Load the last known CTL/ATL before start date as seed values."""
    row = conn.execute(
        """SELECT ctl, atl FROM training_load_daily
           WHERE sport=? AND date < ?
           ORDER BY date DESC LIMIT 1""",
        (sport, before_date.isoformat())
    ).fetchone()
    if row and row[0] is not None:
        return float(row[0]), float(row[1] or 0)
    return 0.0, 0.0


def compute_sport_series(
    conn, sport: str, start: date, end: date, daily_tss: dict
) -> list[dict]:
    """Compute CTL/ATL/TSB series for one sport over date range."""
    ctl, atl = _get_seed_ctl_atl(conn, start, sport)

    # Pre-load CTL 7 days ago for ramp_rate
    ctl_7ago_row = conn.execute(
        """SELECT ctl FROM training_load_daily
           WHERE sport=? AND date <= ?
           ORDER BY date DESC LIMIT 1""",
        (sport, (start - timedelta(days=7)).isoformat())
    ).fetchone()
    ctl_7ago = float(ctl_7ago_row[0]) if ctl_7ago_row and ctl_7ago_row[0] else 0.0

    # Sliding window of CTL values for ramp rate
    ctl_history: list[tuple[date, float]] = []

    results = []
    d = start
    while d <= end:
        ds = d.isoformat()
        day_data = daily_tss.get(ds, {})
        tss = day_data.get(sport, 0.0) if isinstance(day_data, dict) else 0.0

        prev_ctl = ctl
        prev_atl = atl

        ctl = prev_ctl + (tss - prev_ctl) * K_CTL
        atl = prev_atl + (tss - prev_atl) * K_ATL
        tsb = prev_ctl - prev_atl  # form = yesterday's state

        ctl_history.append((d, ctl))

        # Ramp rate = CTL change over last 7 days
        week_ago = d - timedelta(days=7)
        ctl_week_ago = next(
            (v for dt, v in reversed(ctl_history) if dt <= week_ago),
            ctl_7ago
        )
        ramp_rate = ctl - ctl_week_ago

        results.append({
            "date": ds,
            "sport": sport,
            "daily_tss": tss,
            "ctl": round(ctl, 2),
            "atl": round(atl, 2),
            "tsb": round(tsb, 2),
            "ramp_rate": round(ramp_rate, 2),
        })
        d += timedelta(days=1)

    return results


def write_series(conn, series: list[dict]) -> int:
    count = 0
    for row in series:
        conn.execute(
            """INSERT OR REPLACE INTO training_load_daily
               (date, sport, daily_tss, ctl, atl, tsb, ramp_rate)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (row["date"], row["sport"], row["daily_tss"],
             row["ctl"], row["atl"], row["tsb"], row["ramp_rate"])
        )
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill-days", type=int, default=None)
    parser.add_argument("--full-history", action="store_true")
    parser.add_argument("--sport", default=None,
                        choices=SPORTS + ["combined"])
    args = parser.parse_args()

    conn = get_connection()
    start, end = _get_date_range(conn, args)

    print(f"CTL/ATL/TSB engine: {start} → {end}", file=sys.stderr)

    # Build daily TSS map once
    daily_tss = _build_daily_tss(conn, start, end)
    print(f"  Loaded TSS for {len(daily_tss)} days with activity data", file=sys.stderr)

    target_sports = [args.sport] if args.sport and args.sport != "combined" else SPORTS

    total = 0
    for sport in target_sports:
        series = compute_sport_series(conn, sport, start, end, daily_tss)
        n = write_series(conn, series)
        total += n
        if series:
            last = series[-1]
            print(f"  {sport}: CTL={last['ctl']} ATL={last['atl']} TSB={last['tsb']} ramp={last['ramp_rate']}",
                  file=sys.stderr)

    # Combined = sum of all sports per day
    if not args.sport or args.sport == "combined":
        print("  Computing combined series...", file=sys.stderr)

        # Build combined daily_tss
        combined_tss: dict[str, dict] = {}
        for ds, day_data in daily_tss.items():
            combined_tss[ds] = {"combined": sum(day_data.values())}

        # Also sum any "other" sport
        for ds, day_data in daily_tss.items():
            if ds not in combined_tss:
                combined_tss[ds] = {"combined": 0}
            combined_tss[ds]["combined"] = sum(day_data.values())

        combined_series = compute_sport_series(conn, "combined", start, end, combined_tss)
        # Adjust: combined_series uses sport key "combined" but daily_tss has it under "combined"
        for row in combined_series:
            day_data = combined_tss.get(row["date"], {})
            row["daily_tss"] = day_data.get("combined", 0.0)

        n = write_series(conn, combined_series)
        total += n
        if combined_series:
            last = combined_series[-1]
            print(f"  combined: CTL={last['ctl']} ATL={last['atl']} TSB={last['tsb']} ramp={last['ramp_rate']}",
                  file=sys.stderr)

    conn.commit()
    conn.close()
    print(f"\nDone: {total} rows written", file=sys.stderr)


if __name__ == "__main__":
    main()
