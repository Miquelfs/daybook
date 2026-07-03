"""
Phase 2: Garmin extended ingestion — activity details, splits, and physio metrics.

For each Garmin activity missing from activity_detail:
  - Fetches get_activity_details() → raw_detail_json + Garmin-native TE/load
  - Fetches get_activity_splits() → activity_split rows

Also syncs daily physio metrics to garmin_physio:
  - get_training_status() → acute/chronic load, status, load focus
  - get_max_metrics()     → VO2max run/bike
  - get_training_readiness() → readiness score

Usage from daybook/ root:
    python -m domains.health.garmin.garmin_activity_detail_sync [options]

Options:
    --days N          Process activities from the last N days (default: 7)
    --backfill-days N Process activities from the last N days for backfill
    --recompute       Re-fetch even if activity_detail row exists
    --skip-physio     Skip daily physio metrics
    --skip-splits     Skip splits ingestion
"""

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

_ROOT = Path(__file__).parents[3]

from infrastructure.db.connection import get_connection
from domains.health.garmin.garmin_client import get_client

RATE_LIMIT_SLEEP = 1.2


# ─── Sport normalisation ─────────────────────────────────────────────────────

SPORT_MAP = {
    "running": "run", "trail_running": "run", "indoor_running": "run",
    "track_running": "run", "virtual_run": "run", "treadmill_running": "run",
    "cycling": "ride", "road_biking": "ride", "mountain_biking": "ride",
    "indoor_cycling": "ride", "virtual_ride": "ride", "gravel_cycling": "ride",
    "swimming": "swim", "lap_swimming": "swim", "open_water_swimming": "swim",
    "walking": "other", "hiking": "other", "strength_training": "other",
    "yoga": "other", "fitness_equipment": "other",
}

def _normalize_sport(activity_type: str | None) -> tuple[str, str | None]:
    if not activity_type:
        return "other", None
    at = activity_type.lower()
    sport = SPORT_MAP.get(at, "other")
    sub_sport = at if at != sport else None
    return sport, sub_sport


# ─── Activity detail ingestion ───────────────────────────────────────────────

def _parse_detail_summary(raw: dict) -> dict:
    """Extract Garmin-native computed metrics from get_activity_details response."""
    summary = raw.get("summaryDTO") or {}
    meta = raw.get("metaData") or {}
    return {
        "garmin_aerobic_te": summary.get("trainingEffect"),
        "garmin_anaerobic_te": summary.get("anaerobicTrainingEffect"),
        "garmin_activity_load": summary.get("activityTrainingLoad"),
        "avg_cadence": summary.get("averageRunCadence") or summary.get("averageBikeCadence"),
        "avg_pace_s_per_km": _speed_to_pace(summary.get("averageSpeed")),
    }


def _speed_to_pace(speed_mps: float | None) -> float | None:
    if not speed_mps or speed_mps <= 0:
        return None
    return 1000 / speed_mps  # seconds per km


def sync_activity_detail(client, conn, activity_id: str, native_id: str,
                          activity_type: str | None, recompute: bool) -> bool:
    """Fetch and store activity detail + splits for one activity. Returns True if synced."""
    if not recompute:
        row = conn.execute(
            "SELECT activity_id FROM activity_detail WHERE activity_id=?", (activity_id,)
        ).fetchone()
        if row:
            return False

    sport, sub_sport = _normalize_sport(activity_type)

    try:
        raw = client.get_activity_details(native_id)
        if not raw or not isinstance(raw, dict):
            return False

        parsed = _parse_detail_summary(raw)

        conn.execute(
            """INSERT OR REPLACE INTO activity_detail
               (activity_id, sport, sub_sport, avg_pace_s_per_km, avg_cadence,
                garmin_aerobic_te, garmin_anaerobic_te, garmin_activity_load,
                computed_at, raw_detail_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)""",
            (
                activity_id, sport, sub_sport,
                parsed["avg_pace_s_per_km"], parsed["avg_cadence"],
                parsed["garmin_aerobic_te"], parsed["garmin_anaerobic_te"],
                parsed["garmin_activity_load"],
                json.dumps(raw, ensure_ascii=False),
            )
        )
        return True

    except Exception as e:
        print(f"  WARN detail {activity_id}: {e}", file=sys.stderr)
        return False


def _parse_streams_from_raw(conn, activity_id: str, raw: dict) -> int:
    """Parse streams from an already-fetched get_activity_details payload and store them."""
    try:
        metrics = raw.get("activityDetailMetrics") or []
        if not metrics:
            return 0

        descriptors = raw.get("metricDescriptors") or []
        if not descriptors:
            return 0

        idx_to_name: dict[int, str] = {}
        for d in descriptors:
            if not isinstance(d, dict):
                continue
            idx = d.get("metricsIndex")
            # API uses "key" not "metricsType"
            name = (d.get("key") or d.get("metricsType") or "").lower()
            if idx is not None and name:
                idx_to_name[idx] = name

        if not idx_to_name:
            return 0

        streams: dict[str, list] = {}
        for point in metrics:
            if not isinstance(point, dict):
                continue
            vals = point.get("metrics", [])
            for idx, val in enumerate(vals):
                name = idx_to_name.get(idx)
                if name:
                    streams.setdefault(name, []).append(val)

        count = 0
        for stream_type, values in streams.items():
            if not values:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO activity_streams (activity_id, stream_type, data_json) VALUES (?,?,?)",
                (activity_id, stream_type, json.dumps(values)),
            )
            count += 1
        return count
    except Exception as e:
        print(f"  WARN streams {activity_id}: {e}", file=sys.stderr)
        return 0


def sync_streams(client, conn, activity_id: str, native_id: str, recompute: bool) -> int:
    """Fetch streams for an activity. Reuses cached raw_detail_json if available."""
    if not recompute:
        existing = conn.execute(
            "SELECT COUNT(*) FROM activity_streams WHERE activity_id=?", (activity_id,)
        ).fetchone()[0]
        if existing > 0:
            return 0

    # Try to reuse already-fetched raw JSON from activity_detail (avoids a second API call)
    row = conn.execute(
        "SELECT raw_detail_json FROM activity_detail WHERE activity_id=?", (activity_id,)
    ).fetchone()
    if row and row[0]:
        try:
            raw = json.loads(row[0])
            return _parse_streams_from_raw(conn, activity_id, raw)
        except Exception:
            pass

    # Fallback: fetch fresh from API
    try:
        raw = client.get_activity_details(native_id)
        if not raw or not isinstance(raw, dict):
            return 0
        return _parse_streams_from_raw(conn, activity_id, raw)
    except Exception as e:
        print(f"  WARN streams {activity_id}: {e}", file=sys.stderr)
        return 0


def sync_splits(client, conn, activity_id: str, native_id: str, recompute: bool) -> int:
    """Fetch and store splits for one activity. Returns count inserted."""
    if not recompute:
        existing = conn.execute(
            "SELECT COUNT(*) FROM activity_split WHERE activity_id=?", (activity_id,)
        ).fetchone()[0]
        if existing > 0:
            return 0

    try:
        raw = client.get_activity_splits(native_id)
        if not raw or not isinstance(raw, dict):
            return 0

        laps = raw.get("lapDTOs") or raw.get("laps") or []
        if not laps:
            return 0

        conn.execute("DELETE FROM activity_split WHERE activity_id=?", (activity_id,))

        count = 0
        for i, lap in enumerate(laps):
            avg_speed = lap.get("averageSpeed")
            avg_pace = _speed_to_pace(avg_speed)

            conn.execute(
                """INSERT INTO activity_split
                   (activity_id, split_index, type, distance_m, time_s,
                    avg_pace_s_per_km, avg_hr, avg_power_w, avg_cadence, elev_gain_m, avg_grade)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    activity_id, i,
                    lap.get("lapTrigger", "auto_km"),
                    lap.get("distance"),
                    lap.get("duration"),
                    avg_pace,
                    lap.get("averageHR"),
                    lap.get("averagePower"),
                    lap.get("averageRunCadence") or lap.get("averageBikeCadence"),
                    lap.get("elevationGain"),
                    lap.get("averageGrade"),
                )
            )
            count += 1
        return count

    except Exception as e:
        print(f"  WARN splits {activity_id}: {e}", file=sys.stderr)
        return 0


# ─── Physio ingestion ────────────────────────────────────────────────────────

def _parse_training_status(raw) -> dict:
    if not raw or not isinstance(raw, dict):
        return {}

    result = {
        "training_status": None,
        "acute_load": None,
        "chronic_load": None,
        "acute_chronic_ratio": None,
        "load_focus_json": "{}",
    }

    # mostRecentTrainingStatus → latestTrainingStatusData → {deviceId: {...}}
    mrs = raw.get("mostRecentTrainingStatus") or {}
    ltd = (mrs if isinstance(mrs, dict) else {}).get("latestTrainingStatusData") or {}
    if isinstance(ltd, dict) and ltd:
        device_data = next(iter(ltd.values()), {})
        if isinstance(device_data, dict):
            status_code = device_data.get("trainingStatus")
            result["training_status"] = device_data.get("trainingStatusFeedbackPhrase") or (
                str(status_code) if status_code is not None else None
            )
            acwr = device_data.get("acuteTrainingLoadDTO") or {}
            if isinstance(acwr, dict):
                result["acute_load"] = acwr.get("dailyTrainingLoadAcute")
                result["chronic_load"] = acwr.get("dailyTrainingLoadChronic")
                result["acute_chronic_ratio"] = acwr.get("dailyAcuteChronicWorkloadRatio")

    # mostRecentTrainingLoadBalance → metricsTrainingLoadBalanceDTOMap → {deviceId: {...}}
    mlb = raw.get("mostRecentTrainingLoadBalance") or {}
    lb_map = (mlb if isinstance(mlb, dict) else {}).get("metricsTrainingLoadBalanceDTOMap") or {}
    if isinstance(lb_map, dict) and lb_map:
        lb = next(iter(lb_map.values()), {})
        if isinstance(lb, dict):
            result["load_focus_json"] = json.dumps({
                "aerobic_low": lb.get("monthlyLoadAerobicLow"),
                "aerobic_high": lb.get("monthlyLoadAerobicHigh"),
                "anaerobic": lb.get("monthlyLoadAnaerobic"),
                "feedback": lb.get("trainingBalanceFeedbackPhrase"),
            })

    # mostRecentVO2Max → generic → vo2MaxPreciseValue
    vo2_raw = raw.get("mostRecentVO2Max") or {}
    if isinstance(vo2_raw, dict):
        generic = vo2_raw.get("generic") or {}
        if isinstance(generic, dict):
            result["vo2max_run"] = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        cycling = vo2_raw.get("cycling") or {}
        if isinstance(cycling, dict):
            result["vo2max_bike"] = cycling.get("vo2MaxPreciseValue") or cycling.get("vo2MaxValue")

    return result


def _parse_max_metrics(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, list):
        result = {}
        for item in raw:
            if isinstance(item, dict):
                sport = item.get("sport", "").lower()
                vo2 = item.get("vo2MaxPreciseValue") or item.get("vo2Max")
                if "run" in sport and vo2:
                    result["vo2max_run"] = vo2
                elif "cycling" in sport or "bike" in sport and vo2:
                    result["vo2max_bike"] = vo2
        return result
    if isinstance(raw, dict):
        return {
            "vo2max_run": raw.get("vo2MaxPreciseValue") or raw.get("runningMaxMetricValues", {}).get("vo2MaxPreciseValue"),
            "vo2max_bike": raw.get("cyclingMaxMetricValues", {}).get("vo2MaxPreciseValue"),
        }
    return {}


def _parse_readiness(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, list):
        raw = raw[0] if raw else {}
    if not isinstance(raw, dict):
        return {}
    score = (
        (raw.get("trainingReadinessDTO") or {}).get("score")
        or raw.get("score")
        or raw.get("overallScore")
    )
    return {"training_readiness_score": score}


def sync_physio(client, conn, d: str, recompute: bool = False) -> bool:
    """Sync physio metrics for a given date into garmin_physio."""
    existing = conn.execute(
        "SELECT date, acute_load, chronic_load, training_readiness_score, vo2max_run FROM garmin_physio WHERE date=?", (d,)
    ).fetchone()
    if existing and not recompute:
        # Skip only if the row has at least one real value
        if any(existing[i] is not None for i in range(1, 5)):
            return False
        # Row exists but is all-NULL — re-fetch

    data = {"date": d}
    raw_payloads = {}

    try:
        ts_raw = client.get_training_status(d)
        raw_payloads["training_status"] = ts_raw
        data.update(_parse_training_status(ts_raw))
    except Exception as e:
        print(f"  WARN physio training_status {d}: {e}", file=sys.stderr)

    time.sleep(RATE_LIMIT_SLEEP)

    try:
        mm_raw = client.get_max_metrics(d)
        raw_payloads["max_metrics"] = mm_raw
        data.update(_parse_max_metrics(mm_raw))
    except Exception as e:
        print(f"  WARN physio max_metrics {d}: {e}", file=sys.stderr)

    time.sleep(RATE_LIMIT_SLEEP)

    try:
        tr_raw = client.get_training_readiness(d)
        raw_payloads["training_readiness"] = tr_raw
        data.update(_parse_readiness(tr_raw))
    except Exception as e:
        print(f"  WARN physio readiness {d}: {e}", file=sys.stderr)

    # Only insert if we got at least something useful
    if any(v for k, v in data.items() if k != "date"):
        conn.execute(
            """INSERT OR REPLACE INTO garmin_physio
               (date, vo2max_run, vo2max_bike, training_readiness_score,
                acute_load, chronic_load, acute_chronic_ratio,
                training_status, load_focus_json, raw_payload)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                d,
                data.get("vo2max_run"),
                data.get("vo2max_bike"),
                data.get("training_readiness_score"),
                data.get("acute_load"),
                data.get("chronic_load"),
                data.get("acute_chronic_ratio"),
                data.get("training_status"),
                data.get("load_focus_json"),
                json.dumps(raw_payloads, ensure_ascii=False),
            )
        )
        return True
    return False


# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Garmin activity details + physio")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--backfill-days", type=int, default=None,
                        help="Backfill activities from last N days (overrides --days)")
    parser.add_argument("--recompute", action="store_true")
    parser.add_argument("--skip-physio", action="store_true")
    parser.add_argument("--skip-splits", action="store_true")
    parser.add_argument("--fetch-streams", action="store_true",
                        help="Also fetch per-second HR/speed/distance streams")
    args = parser.parse_args()

    lookback = args.backfill_days or args.days
    cutoff = (date.today() - timedelta(days=lookback)).isoformat()
    today = date.today().isoformat()

    print(f"Garmin activity detail sync: last {lookback} days  recompute={args.recompute}",
          file=sys.stderr)

    conn = get_connection()
    client = get_client()

    # ── Activity details + splits ─────────────────────────────────────────────
    activities = conn.execute(
        """SELECT id, activity_type, date,
                  REPLACE(id, 'garmin_', '') AS native_id
           FROM activities
           WHERE source='garmin' AND date >= ?
           ORDER BY date DESC""",
        (cutoff,)
    ).fetchall()

    print(f"  Found {len(activities)} Garmin activities to process", file=sys.stderr)

    detail_count = 0
    split_count = 0
    for act_id, act_type, act_date, native_id in activities:
        print(f"  {act_id} ({act_type} {act_date})", file=sys.stderr, end="")

        synced = sync_activity_detail(client, conn, act_id, native_id, act_type, args.recompute)
        if synced:
            detail_count += 1
            print("  detail✓", file=sys.stderr, end="")
            time.sleep(RATE_LIMIT_SLEEP)

        if args.fetch_streams:
            n_streams = sync_streams(client, conn, act_id, native_id, args.recompute)
            if n_streams:
                print(f"  streams={n_streams}", file=sys.stderr, end="")
                time.sleep(RATE_LIMIT_SLEEP)

        if not args.skip_splits:
            n_splits = sync_splits(client, conn, act_id, native_id, args.recompute)
            if n_splits:
                split_count += n_splits
                print(f"  splits={n_splits}", file=sys.stderr, end="")
                time.sleep(RATE_LIMIT_SLEEP)

        print("", file=sys.stderr)
        conn.commit()

    # ── Physio metrics ────────────────────────────────────────────────────────
    physio_count = 0
    if not args.skip_physio:
        print("\n  Syncing physio metrics...", file=sys.stderr)
        d = date.today() - timedelta(days=lookback)
        while d <= date.today():
            ds = d.isoformat()
            ok = sync_physio(client, conn, ds, recompute=args.recompute)
            if ok:
                physio_count += 1
                print(f"  physio {ds} ✓", file=sys.stderr)
            conn.commit()
            d += timedelta(days=1)
            time.sleep(RATE_LIMIT_SLEEP)

    conn.close()

    print(f"\nDone: {detail_count} details, {split_count} splits, {physio_count} physio rows",
          file=sys.stderr)


if __name__ == "__main__":
    main()
