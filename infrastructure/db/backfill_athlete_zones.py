"""
Derive personalized athlete_zones from recent activity history and insert a fresh
row per sport with valid_from = today. Never mutates the 2019 placeholder seed —
date-aware readers (`_get_zones`) automatically pick up the newest row.

No power meter this year → the ride row carries threshold HR + a reference flat
speed (stored as threshold_pace_s_per_km, seconds/km) instead of FTP watts.

Run on the Pi:  python -m infrastructure.db.backfill_athlete_zones [--dry-run]
"""

import argparse
import json
import sys
from datetime import date, timedelta

from infrastructure.db.connection import get_connection

# %max-HR band edges (shared shape with migrate_strava_analytics seed)
_HR_BANDS = [
    ("Z1", 0.00, 0.65),
    ("Z2", 0.65, 0.75),
    ("Z3", 0.75, 0.82),
    ("Z4", 0.82, 0.88),
    ("Z5", 0.88, 1.60),
]


def _zones_json(max_hr: int) -> str:
    bands = []
    for name, lo, hi in _HR_BANDS:
        bands.append({
            "name": name,
            "min_hr": round(max_hr * lo),
            "max_hr": 999 if hi >= 1.5 else round(max_hr * hi),
        })
    return json.dumps(bands)


def _observed_max_hr(conn) -> int:
    """Best-guess max HR from recent efforts, clamped to a sane [180, 205]."""
    row = conn.execute(
        """SELECT MAX(max_heart_rate) AS mx FROM activities
           WHERE max_heart_rate IS NOT NULL AND max_heart_rate BETWEEN 120 AND 205
             AND date >= date('now','-365 days')"""
    ).fetchone()
    prev = conn.execute(
        "SELECT max_hr FROM athlete_zones WHERE sport='run' ORDER BY valid_from DESC LIMIT 1"
    ).fetchone()
    if row and row["mx"]:
        return max(180, min(205, int(row["mx"])))
    return int(prev["max_hr"]) if prev and prev["max_hr"] else 195


def _run_threshold_s_km(conn, max_hr: int):
    """Z2-HR-bucket anchor over the last 90 days → threshold pace (same method as
    the /pace-zones tier-2 path). Returns None if too little data."""
    z2_lo, z2_hi = round(max_hr * 0.76), round(max_hr * 0.86)
    runs = conn.execute(
        """SELECT avg_speed_mps FROM activities
           WHERE activity_type IN ('running','trail_running')
             AND date >= date('now','-90 days')
             AND avg_heart_rate BETWEEN ? AND ?
             AND avg_speed_mps > 0""",
        (z2_lo, z2_hi),
    ).fetchall()
    if len(runs) < 3:
        return None
    avg_speed = sum(r["avg_speed_mps"] for r in runs) / len(runs)
    z2_pace = 1000.0 / avg_speed
    return round(z2_pace / 1.15)  # Z2 ≈ threshold × 1.15


def _ride_reference_s_km(conn):
    """Reference flat speed from the faster longer rides (>20km, last 120 days).
    Returns seconds/km, or None. Stored in threshold_pace_s_per_km (no power meter)."""
    rows = conn.execute(
        """SELECT avg_speed_mps FROM activities
           WHERE activity_type IN ('cycling','road_biking','gravel_cycling','virtual_ride','indoor_cycling')
             AND date >= date('now','-120 days')
             AND distance_meters > 20000 AND avg_speed_mps > 0
           ORDER BY avg_speed_mps DESC"""
    ).fetchall()
    if not rows:
        return None
    speeds = [r["avg_speed_mps"] for r in rows]
    # 75th-percentile speed → a sustainable "hard steady" reference
    idx = max(0, int(len(speeds) * 0.25) - 1)
    ref_speed = speeds[idx]
    return round(1000.0 / ref_speed) if ref_speed > 0 else None


def _swim_css_s_100m(conn):
    """
    Provisional CSS (s/100m). Whole-activity pace is contaminated by drills/rest,
    so the median badly overstates it. Use the FASTEST session (closest to
    continuous swimming) and only trust it if it lands in a plausible CSS band —
    otherwise return None so the caller uses a sane default. A real swim CSS test
    (400+200) replaces this properly.
    """
    rows = conn.execute(
        """SELECT duration_seconds, distance_meters FROM activities
           WHERE activity_type IN ('lap_swimming','open_water_swimming','swimming','pool_swimming')
             AND date >= date('now','-120 days')
             AND distance_meters >= 400 AND duration_seconds > 0"""
    ).fetchall()
    paces = sorted(r["duration_seconds"] / r["distance_meters"] * 100.0 for r in rows)
    if not paces:
        return None
    fastest = paces[0] * 0.97  # a touch faster than the best continuous-ish effort
    if 70 <= fastest <= 140:    # sane CSS band; anything slower is rest-contaminated
        return round(fastest)
    return None


def _prev(conn, sport: str, field: str):
    r = conn.execute(
        f"SELECT {field} FROM athlete_zones WHERE sport=? ORDER BY valid_from DESC LIMIT 1",
        (sport,),
    ).fetchone()
    return r[field] if r else None


def backfill(conn, dry_run: bool = False):
    today = date.today().isoformat()
    max_hr = _observed_max_hr(conn)

    run_thr = _run_threshold_s_km(conn, max_hr) or _prev(conn, "run", "threshold_pace_s_per_km") or 270
    ride_ref = _ride_reference_s_km(conn) or _prev(conn, "ride", "threshold_pace_s_per_km")
    # Swim: never fall back to the previous row (it may be a rest-contaminated
    # backfill value). Use a sane 1:45/100m default until a CSS test refines it.
    swim_css = _swim_css_s_100m(conn) or 105

    rows = [
        {"sport": "run",  "max_hr": max_hr, "threshold_hr": round(max_hr * 0.90),
         "ftp_w": None, "threshold_pace_s_per_km": run_thr, "css_pace_s_per_100m": None},
        {"sport": "ride", "max_hr": max_hr, "threshold_hr": round(max_hr * 0.85),
         "ftp_w": None, "threshold_pace_s_per_km": ride_ref, "css_pace_s_per_100m": None},
        {"sport": "swim", "max_hr": max_hr, "threshold_hr": round(max_hr * 0.85),
         "ftp_w": None, "threshold_pace_s_per_km": None, "css_pace_s_per_100m": swim_css},
    ]

    for z in rows:
        disp = z["threshold_pace_s_per_km"] or z["css_pace_s_per_100m"] or "-"
        print(f"  {z['sport']:4}  max_hr={z['max_hr']}  thr_hr={z['threshold_hr']}  "
              f"pace/css={disp}", file=sys.stderr)
        if dry_run:
            continue
        conn.execute(
            """INSERT OR REPLACE INTO athlete_zones
               (valid_from, sport, max_hr, threshold_hr, ftp_w,
                threshold_pace_s_per_km, css_pace_s_per_100m, zones_json)
               VALUES (?,?,?,?,?,?,?,?)""",
            (today, z["sport"], z["max_hr"], z["threshold_hr"], z["ftp_w"],
             z["threshold_pace_s_per_km"], z["css_pace_s_per_100m"], _zones_json(z["max_hr"])),
        )

    if not dry_run:
        conn.commit()
        print(f"Inserted athlete_zones rows for {today}.", file=sys.stderr)
    else:
        print("Dry run — nothing written.", file=sys.stderr)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    conn = get_connection()
    backfill(conn, dry_run=args.dry_run)
    conn.close()
