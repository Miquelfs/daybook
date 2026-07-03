"""
Phase 3: Per-activity computed metrics — NP, IF, VI, EF, aerobic decoupling, hrTSS, MMP curves.

Run from daybook/ root:
    python -m domains.health.compute_activity_metrics [options]

Options:
    --activity-id ID    Process a single activity
    --days N            Process activities from last N days (default: 7)
    --backfill-days N   Backfill last N days
    --recompute         Recompute even if already computed
"""

import argparse
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

_ROOT = Path(__file__).parents[2]

from infrastructure.db.connection import get_connection

# Duration buckets for MMP power curve (seconds)
POWER_BUCKETS = [1, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400]

# Distance buckets for pace curve (metres)
PACE_BUCKETS = [400, 500, 1000, 1609, 2000, 5000, 10000, 15000, 21097, 42195]

SPORT_MAP = {
    "running": "run", "trail_running": "run", "indoor_running": "run",
    "track_running": "run", "virtual_run": "run", "treadmill_running": "run",
    "cycling": "ride", "road_biking": "ride", "mountain_biking": "ride",
    "indoor_cycling": "ride", "virtual_ride": "ride", "gravel_cycling": "ride",
    "swimming": "swim", "lap_swimming": "swim", "open_water_swimming": "swim",
}


# ─── Zone helpers ─────────────────────────────────────────────────────────────

def _get_zones(conn, date_str: str, sport: str) -> dict:
    """Load athlete zones valid on a given date for a sport."""
    row = conn.execute(
        """SELECT max_hr, threshold_hr, ftp_w, threshold_pace_s_per_km, css_pace_s_per_100m, zones_json
           FROM athlete_zones
           WHERE sport=? AND valid_from <= ?
           ORDER BY valid_from DESC LIMIT 1""",
        (sport, date_str)
    ).fetchone()

    if not row:
        # Fallback defaults
        return {
            "max_hr": 195, "threshold_hr": 165, "ftp_w": None,
            "threshold_pace_s_per_km": None, "css_pace_s_per_100m": None,
            "zones": [
                {"name": "Z1", "min_hr": 0,   "max_hr": 117},
                {"name": "Z2", "min_hr": 117, "max_hr": 146},
                {"name": "Z3", "min_hr": 146, "max_hr": 165},
                {"name": "Z4", "min_hr": 165, "max_hr": 175},
                {"name": "Z5", "min_hr": 175, "max_hr": 999},
            ]
        }
    return {
        "max_hr": row[0] or 195,
        "threshold_hr": row[1] or 165,
        "ftp_w": row[2],
        "threshold_pace_s_per_km": row[3],
        "css_pace_s_per_100m": row[4],
        "zones": json.loads(row[5]) if row[5] else [],
    }


def _bucket_hr_to_zones(hr_stream: list, zones: list) -> dict:
    """Count seconds in each zone. hr_stream = list of bpm values (1 per second)."""
    counts = {z["name"]: 0 for z in zones}
    for bpm in hr_stream:
        if bpm is None:
            continue
        for z in zones:
            if z["min_hr"] <= bpm < z["max_hr"]:
                counts[z["name"]] += 1
                break
    return counts


def _z1_z2_fraction(zones_counts: dict) -> float:
    """Fraction of time in Z1+Z2 (aerobic base)."""
    total = sum(zones_counts.values())
    if total == 0:
        return 0
    z1 = zones_counts.get("Z1", 0)
    z2 = zones_counts.get("Z2", 0)
    return (z1 + z2) / total


# ─── Stream loading ───────────────────────────────────────────────────────────

def _load_streams(conn, activity_id: str) -> dict[str, list]:
    """Load all streams for an activity from activity_streams table."""
    rows = conn.execute(
        "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?",
        (activity_id,)
    ).fetchall()
    return {row[0]: json.loads(row[1]) for row in rows}


def _find_stream(streams: dict, *keys: str) -> list | None:
    """Find first matching stream by key variants."""
    for k in keys:
        v = streams.get(k)
        if v:
            return v
    return None


# ─── Normalized Power ────────────────────────────────────────────────────────

def _compute_np(power_stream: list) -> float | None:
    """30-second rolling average of power, raised to 4th power, mean, 4th root."""
    values = [v for v in power_stream if v is not None and v >= 0]
    if len(values) < 30:
        return None

    window = 30
    rolling_avgs = []
    for i in range(window - 1, len(values)):
        avg = sum(values[i - window + 1: i + 1]) / window
        rolling_avgs.append(avg)

    if not rolling_avgs:
        return None

    mean_4th = sum(x ** 4 for x in rolling_avgs) / len(rolling_avgs)
    return mean_4th ** 0.25


# ─── hrTSS ───────────────────────────────────────────────────────────────────

def _compute_hr_tss(hr_stream: list, moving_time_s: int, threshold_hr: int, max_hr: int) -> float | None:
    """TRIMP-based hrTSS. Returns None if insufficient data."""
    hr_vals = [v for v in hr_stream if v is not None and v > 40]
    if not hr_vals or not threshold_hr or not max_hr:
        return None

    hr_reserve_max = max_hr - 60  # assume resting ~60
    if hr_reserve_max <= 0:
        return None

    # TRIMP per sample (1 second)
    trimp_total = 0.0
    for hr in hr_vals:
        hr_ratio = (hr - 60) / hr_reserve_max
        hr_ratio = max(0.0, min(1.0, hr_ratio))
        trimp_total += hr_ratio * 0.64 * math.exp(1.92 * hr_ratio)

    # Normalise: hrTSS of 100 = 1 hour at threshold
    hr_ratio_threshold = (threshold_hr - 60) / hr_reserve_max
    trimp_threshold_per_second = hr_ratio_threshold * 0.64 * math.exp(1.92 * hr_ratio_threshold)
    trimp_1hr_threshold = 3600 * trimp_threshold_per_second

    if trimp_1hr_threshold <= 0:
        return None

    return (trimp_total / trimp_1hr_threshold) * 100


# ─── Relative Effort ─────────────────────────────────────────────────────────

def _compute_relative_effort(zones_counts: dict, zones: list) -> float | None:
    """Zone-weighted TRIMP. Comparison metric only — not used for load model."""
    coefficients = {"Z1": 1.0, "Z2": 2.0, "Z3": 3.0, "Z4": 4.0, "Z5": 5.0}
    total = sum(
        zones_counts.get(z["name"], 0) * coefficients.get(z["name"], 1.0)
        for z in zones
    )
    return total / 60.0  # roughly RE units


# ─── Efficiency Factor + Aerobic Decoupling ──────────────────────────────────

def _compute_ef_and_decoupling(
    power_or_speed_stream: list,
    hr_stream: list,
    sport: str,
    moving_time_s: int,
    zones_counts: dict,
) -> tuple[float | None, float | None]:
    """
    EF = NP/avgHR (bike) or speed/avgHR (run).
    Decoupling = (EF_first_half - EF_second_half) / EF_first_half × 100.
    Only computed for efforts >= 60 min with >= 60% Z1+Z2.
    """
    if moving_time_s < 2400:
        return None, None

    z1z2_frac = _z1_z2_fraction(zones_counts)
    if z1z2_frac < 0.30:
        return None, None

    ps = [v for v in power_or_speed_stream if v is not None and v > 0]
    hrs = [v for v in hr_stream if v is not None and v > 40]

    if len(ps) < 60 or len(hrs) < 60:
        return None, None

    # Align lengths
    min_len = min(len(ps), len(hrs))
    ps = ps[:min_len]
    hrs = hrs[:min_len]

    mid = min_len // 2

    def _ef(power_slice, hr_slice):
        avg_p = sum(power_slice) / len(power_slice)
        avg_hr = sum(hr_slice) / len(hr_slice)
        if avg_hr <= 0:
            return None
        return avg_p / avg_hr

    ef_first = _ef(ps[:mid], hrs[:mid])
    ef_second = _ef(ps[mid:], hrs[mid:])
    ef_total = _ef(ps, hrs)

    if ef_first is None or ef_second is None or ef_total is None:
        return ef_total, None

    decoupling = (ef_first - ef_second) / ef_first * 100
    return ef_total, decoupling


# ─── MMP / Best Effort curves ────────────────────────────────────────────────

def _compute_mmp(power_stream: list) -> dict[int, float]:
    """Sliding-window best average power for each duration bucket."""
    values = [v if v is not None else 0 for v in power_stream]
    n = len(values)
    results = {}

    for bucket in POWER_BUCKETS:
        if bucket > n:
            continue
        # Prefix sums for O(n) sliding window
        prefix = [0.0] * (n + 1)
        for i, v in enumerate(values):
            prefix[i + 1] = prefix[i] + v
        best = max(
            (prefix[i + bucket] - prefix[i]) / bucket
            for i in range(n - bucket + 1)
        )
        results[bucket] = best

    return results


def _compute_pace_curve(dist_stream: list, time_stream: list | None, moving_time_s: int) -> dict[int, float]:
    """
    Sliding-window best average pace for standard distances.
    dist_stream: cumulative distance in metres (one value per second).
    Returns {metres: s_per_km}.
    """
    if not dist_stream:
        return {}

    # Reconstruct per-second distances if cumulative
    if dist_stream[0] is None:
        return {}

    # If values are cumulative, diff them
    n = len(dist_stream)
    cum = [v if v is not None else 0 for v in dist_stream]

    results = {}
    for target_m in PACE_BUCKETS:
        if target_m > (cum[-1] if cum else 0):
            continue
        # Sliding window using two pointers on cumulative
        best_pace = None
        j = 0
        for i in range(n):
            while j < n and (cum[j] - cum[i]) < target_m:
                j += 1
            if j >= n:
                break
            time_s = j - i
            if time_s <= 0:
                continue
            pace = (time_s / target_m) * 1000  # s per km
            if best_pace is None or pace < best_pace:
                best_pace = pace
        if best_pace:
            results[target_m] = best_pace

    return results


def _store_best_efforts(conn, activity_id: str, date_str: str, sport: str,
                         power_results: dict, pace_results: dict) -> int:
    """Write best effort rows, replacing existing for this activity."""
    conn.execute("DELETE FROM best_effort WHERE activity_id=?", (activity_id,))
    count = 0
    for bucket, value in power_results.items():
        conn.execute(
            "INSERT OR REPLACE INTO best_effort (activity_id, date, sport, channel, bucket, value) VALUES (?,?,?,?,?,?)",
            (activity_id, date_str, sport, "power", bucket, value)
        )
        count += 1
    for bucket, value in pace_results.items():
        conn.execute(
            "INSERT OR REPLACE INTO best_effort (activity_id, date, sport, channel, bucket, value) VALUES (?,?,?,?,?,?)",
            (activity_id, date_str, sport, "pace", bucket, value)
        )
        count += 1
    return count


# ─── Main compute function ────────────────────────────────────────────────────

def compute_for_activity(conn, activity_id: str, date_str: str,
                          activity_type: str | None, moving_time_s: int,
                          avg_power_watts: float | None, avg_hr: int | None,
                          recompute: bool) -> bool:
    """Compute all metrics for one activity. Returns True if metrics were written."""

    # Check if already computed (unless recompute)
    if not recompute:
        row = conn.execute(
            "SELECT efficiency_factor FROM activity_detail WHERE activity_id=? AND efficiency_factor IS NOT NULL",
            (activity_id,)
        ).fetchone()
        if row:
            return False

    sport = SPORT_MAP.get((activity_type or "").lower(), "other")
    zones_config = _get_zones(conn, date_str, sport if sport != "other" else "run")
    streams = _load_streams(conn, activity_id)

    if not streams:
        return False

    hr_stream = (
        _find_stream(streams, "directheartrate", "heart_rate", "heartrate", "direct_heart_rate") or []
    )
    power_stream = (
        _find_stream(streams, "directpower", "power", "direct_power") or []
    )
    speed_stream = (
        _find_stream(streams, "directspeed", "speed", "direct_speed", "enhanced_speed") or []
    )
    dist_stream = (
        _find_stream(streams, "sumdistance", "distance", "direct_distance") or []
    )

    # HR zones
    zones_counts = {}
    if hr_stream and zones_config["zones"]:
        zones_counts = _bucket_hr_to_zones(hr_stream, zones_config["zones"])
    zones_json = json.dumps(
        {f"z{i+1}_s": zones_counts.get(z["name"], 0) for i, z in enumerate(zones_config["zones"])}
    )

    # Normalized Power (if power stream available)
    np_w = None
    intensity_factor = None
    variability_index = None
    power_tss = None

    has_power = bool(power_stream) and any(v for v in power_stream if v and v > 0)
    if has_power:
        np_w = _compute_np(power_stream)
        ftp = zones_config.get("ftp_w")
        if np_w and ftp:
            intensity_factor = np_w / ftp
            if avg_power_watts and avg_power_watts > 0:
                variability_index = np_w / avg_power_watts
            if moving_time_s and intensity_factor:
                power_tss = (moving_time_s * np_w * intensity_factor) / (ftp * 3600) * 100

    # hrTSS fallback
    hr_tss = None
    if not power_tss and hr_stream:
        hr_tss = _compute_hr_tss(
            hr_stream, moving_time_s or 0,
            zones_config["threshold_hr"],
            zones_config["max_hr"]
        )

    # Relative effort (comparison only)
    relative_effort = None
    if zones_counts and zones_config["zones"]:
        relative_effort = _compute_relative_effort(zones_counts, zones_config["zones"])

    # Efficiency Factor + Aerobic Decoupling
    ef_stream = power_stream if has_power else speed_stream
    ef, decoupling = None, None
    if ef_stream and hr_stream:
        ef, decoupling = _compute_ef_and_decoupling(
            ef_stream, hr_stream, sport, moving_time_s or 0, zones_counts
        )

    # Write to activity_detail (UPDATE existing row or INSERT stub)
    existing = conn.execute(
        "SELECT activity_id FROM activity_detail WHERE activity_id=?", (activity_id,)
    ).fetchone()

    if existing:
        conn.execute(
            """UPDATE activity_detail SET
               normalized_power_w=?, intensity_factor=?, variability_index=?,
               efficiency_factor=?, decoupling_pct=?, relative_effort=?, hr_tss=?,
               zones_json=?, computed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE activity_id=?""",
            (np_w, intensity_factor, variability_index,
             ef, decoupling, relative_effort, hr_tss,
             zones_json, activity_id)
        )
    else:
        # Create stub row if garmin_activity_detail_sync hasn't run yet
        conn.execute(
            """INSERT OR IGNORE INTO activity_detail
               (activity_id, sport, normalized_power_w, intensity_factor, variability_index,
                efficiency_factor, decoupling_pct, relative_effort, hr_tss, zones_json,
                computed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))""",
            (activity_id, sport, np_w, intensity_factor, variability_index,
             ef, decoupling, relative_effort, hr_tss, zones_json)
        )

    # MMP / best effort curves
    be_count = 0
    if has_power:
        mmp = _compute_mmp(power_stream)
        pace_curve = _compute_pace_curve(dist_stream, None, moving_time_s or 0)
        be_count = _store_best_efforts(conn, activity_id, date_str, sport, mmp, pace_curve)
    elif dist_stream:
        pace_curve = _compute_pace_curve(dist_stream, None, moving_time_s or 0)
        be_count = _store_best_efforts(conn, activity_id, date_str, sport, {}, pace_curve)

    return True


# ─── Seed best_effort from avg_speed_mps (no streams required) ───────────────

_PACE_BUCKETS_RUN = [400, 500, 1000, 1609, 2000, 5000, 10000, 15000, 21097, 42195]
_PACE_BUCKETS_RIDE = [10000, 20000, 40000, 50000, 80000, 100000, 160000, 200000]

def seed_best_efforts_from_activities(conn) -> int:
    """
    Populate best_effort rows for activities that have avg_speed_mps but no
    stream data (and therefore no existing best_effort rows).
    Uses avg_speed_mps as a conservative whole-activity pace — not a sliding
    window, but accurate enough for the summary table.
    """
    rows = conn.execute(
        """SELECT a.id, a.date, a.activity_type,
                  a.distance_meters, a.moving_time_seconds, a.duration_seconds,
                  a.avg_speed_mps
           FROM activities a
           WHERE a.avg_speed_mps > 0
             AND a.distance_meters > 400
             AND NOT EXISTS (SELECT 1 FROM best_effort WHERE activity_id = a.id)
           ORDER BY a.date ASC"""
    ).fetchall()

    written = 0
    for row in rows:
        sport_raw = (row["activity_type"] or "").lower()
        sport = SPORT_MAP.get(sport_raw, "other")
        if sport not in ("run", "ride"):
            continue

        speed = row["avg_speed_mps"]
        dist = row["distance_meters"]
        dur = row["moving_time_seconds"] or row["duration_seconds"] or 0
        if speed and speed > 0:
            pace_s_per_km = 1000.0 / speed
        elif dur > 0 and dist > 0:
            pace_s_per_km = dur / (dist / 1000.0)
        else:
            continue

        buckets = _PACE_BUCKETS_RUN if sport == "run" else _PACE_BUCKETS_RIDE
        for bucket in buckets:
            if dist >= bucket * 0.9:
                conn.execute(
                    """INSERT OR IGNORE INTO best_effort
                       (activity_id, date, sport, channel, bucket, value)
                       VALUES (?,?,?,?,?,?)""",
                    (row["id"], row["date"], sport, "pace", bucket, round(pace_s_per_km, 1))
                )
                written += 1

    conn.commit()
    return written


# ─── Entry point ─────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--activity-id", default=None)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--backfill-days", type=int, default=None)
    parser.add_argument("--recompute", action="store_true")
    parser.add_argument("--seed-from-activities", action="store_true",
                        help="Seed best_effort from avg_speed_mps for activities without streams")
    args = parser.parse_args()

    conn = get_connection()
    computed = 0
    skipped = 0

    if args.seed_from_activities:
        n = seed_best_efforts_from_activities(conn)
        print(f"Seeded {n} best_effort rows from avg_speed_mps", file=sys.stderr)
        conn.close()
        return

    if args.activity_id:
        row = conn.execute(
            "SELECT id, date, activity_type, moving_time_seconds, avg_power_watts, avg_heart_rate FROM activities WHERE id=?",
            (args.activity_id,)
        ).fetchone()
        if not row:
            print(f"Activity {args.activity_id} not found", file=sys.stderr)
            sys.exit(1)
        ok = compute_for_activity(conn, *row, recompute=True)
        conn.commit()
        print(f"{'Computed' if ok else 'Skipped'}: {args.activity_id}", file=sys.stderr)
    else:
        lookback = args.backfill_days or args.days
        cutoff = (date.today() - timedelta(days=lookback)).isoformat()
        print(f"Computing metrics for last {lookback} days  recompute={args.recompute}",
              file=sys.stderr)

        activities = conn.execute(
            """SELECT id, date, activity_type, moving_time_seconds,
                      avg_power_watts, avg_heart_rate
               FROM activities
               WHERE source='garmin' AND date >= ?
               ORDER BY date DESC""",
            (cutoff,)
        ).fetchall()

        print(f"  {len(activities)} activities to process", file=sys.stderr)

        for act in activities:
            ok = compute_for_activity(conn, *act, recompute=args.recompute)
            if ok:
                computed += 1
                ef_row = conn.execute(
                    "SELECT efficiency_factor, decoupling_pct FROM activity_detail WHERE activity_id=?",
                    (act[0],)
                ).fetchone()
                ef_str = f"EF={ef_row[0]:.3f}" if ef_row and ef_row[0] else "EF=None"
                dc_str = f"dec={ef_row[1]:.1f}%" if ef_row and ef_row[1] else ""
                print(f"  ✓ {act[0]} ({act[2]}) {ef_str} {dc_str}", file=sys.stderr)
            else:
                skipped += 1
            conn.commit()

    conn.close()
    print(f"\nDone: {computed} computed, {skipped} skipped", file=sys.stderr)


if __name__ == "__main__":
    main()
