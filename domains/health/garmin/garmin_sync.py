"""
Garmin sync: pulls sleep, daily_stats, hrv, and activities from Garmin Connect
and writes them into daybook.db + data/raw/garmin/{type}/{date}.json.

Usage (from daybook/ root):
    python -m domains.health.garmin.garmin_sync [options]

Options:
    --start-date YYYY-MM-DD   default: day after last synced date
    --end-date   YYYY-MM-DD   default: today
    --full-history            set start-date to 2015-01-01
    --types sleep,daily_stats,hrv,activities   default: all
    --force                   re-sync even if row already exists
"""

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).parents[3]   # daybook/

from infrastructure.db.connection import get_connection
from domains.health.garmin.garmin_client import get_client

ALL_TYPES = ["sleep", "daily_stats", "hrv", "activities"]
RAW_DIR = _ROOT / "data" / "raw" / "garmin"
RATE_LIMIT_SLEEP = 1.0   # seconds between API calls


# ─── Parsers ─────────────────────────────────────────────────────────────────

def _parse_sleep(raw: dict, d: str) -> dict | None:
    dto = raw.get("dailySleepDTO") or {}
    if not dto:
        return None
    return {
        "date": d,
        "duration_seconds": dto.get("sleepTimeSeconds"),
        "deep_seconds": dto.get("deepSleepSeconds"),
        "light_seconds": dto.get("lightSleepSeconds"),
        "rem_seconds": dto.get("remSleepSeconds"),
        "awake_seconds": dto.get("awakeSleepSeconds"),
        "avg_hrv": dto.get("avgSleepStress"),
        "avg_spo2": dto.get("averageSpO2Value"),
        "score": dto.get("sleepScores", {}).get("overall", {}).get("value")
                 if isinstance(dto.get("sleepScores"), dict) else None,
    }


def _parse_daily_stats(raw: dict, d: str) -> dict | None:
    if not raw:
        return None
    return {
        "date": d,
        "steps": raw.get("totalSteps"),
        "active_calories": raw.get("activeKilocalories"),
        "total_calories": raw.get("totalKilocalories"),
        "resting_hr": raw.get("restingHeartRate"),
        "stress_avg": raw.get("averageStressLevel"),
        "body_battery_low": raw.get("bodyBatteryLowestValue"),
        "body_battery_high": raw.get("bodyBatteryHighestValue"),
    }


def _parse_hrv(raw: dict | list, d: str) -> dict | None:
    if not raw:
        return None
    summary = raw.get("hrvSummary") if isinstance(raw, dict) else {}
    if not summary:
        return None
    return {
        "date": d,
        "last_night_avg": summary.get("lastNightAvg"),
        "weekly_avg": summary.get("weeklyAvg"),
        "status": summary.get("status"),
    }


def _parse_activity(raw: dict) -> dict:
    start = raw.get("startTimeGMT") or raw.get("startTimeLocal", "")
    d = start[:10] if start else ""
    native_id = str(raw.get("activityId", ""))
    act_type = raw.get("activityType", {})
    if isinstance(act_type, dict):
        act_type = act_type.get("typeKey")

    # Speed: Garmin returns m/s directly in averageSpeed
    avg_speed = raw.get("averageSpeed")

    return {
        "id": f"garmin_{native_id}",
        "date": d,
        "source": "garmin",
        "activity_type": act_type,
        "name": raw.get("activityName"),
        "start_time": start,
        "duration_seconds": int(raw.get("duration", 0) or 0),
        "moving_time_seconds": int(raw.get("movingDuration", 0) or 0),
        "distance_meters": raw.get("distance"),
        "elevation_gain_meters": raw.get("elevationGain"),
        "avg_heart_rate": raw.get("averageHR"),
        "max_heart_rate": raw.get("maxHR"),
        "avg_speed_mps": avg_speed,
        "avg_power_watts": raw.get("avgPower"),
        "calories": raw.get("calories"),
        "training_stress_score": raw.get("trainingStressScore"),
        "start_lat": raw.get("startLatitude"),
        "start_lng": raw.get("startLongitude"),
    }


# ─── Writers ─────────────────────────────────────────────────────────────────

def _write_raw(data_type: str, name: str, payload: object) -> None:
    path = RAW_DIR / data_type / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def _log(conn, source: str, data_type: str, status: str, records: int = 0, error: str | None = None) -> None:
    conn.execute(
        "INSERT INTO sync_log (source, data_type, status, records_synced, error) VALUES (?, ?, ?, ?, ?)",
        (source, data_type, status, records, error),
    )


def _update_sync_status(conn, source: str, success: bool, records: int = 0, error: str | None = None) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        """
        INSERT INTO sync_status (source, last_attempt_at, last_success_at, last_error, records_synced)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_success_at = CASE WHEN ? THEN excluded.last_success_at ELSE last_success_at END,
            last_error      = excluded.last_error,
            records_synced  = excluded.records_synced
        """,
        (source, now, now if success else None, error, records, success),
    )


# ─── Sync functions ──────────────────────────────────────────────────────────

def sync_sleep(client, conn, d: str, force: bool) -> int:
    if not force:
        row = conn.execute("SELECT date FROM sleep WHERE date=?", (d,)).fetchone()
        if row:
            return 0

    try:
        raw = client.get_sleep_data(d)
        _write_raw("sleep", f"sleep_{d}", raw)
        parsed = _parse_sleep(raw, d)
        if parsed:
            conn.execute(
                """INSERT OR REPLACE INTO sleep
                   (date, duration_seconds, deep_seconds, light_seconds, rem_seconds,
                    awake_seconds, avg_hrv, avg_spo2, score, raw_payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (parsed["date"], parsed["duration_seconds"], parsed["deep_seconds"],
                 parsed["light_seconds"], parsed["rem_seconds"], parsed["awake_seconds"],
                 parsed["avg_hrv"], parsed["avg_spo2"], parsed["score"], json.dumps(raw)),
            )
        _log(conn, "garmin", "sleep", "ok", 1 if parsed else 0)
        return 1 if parsed else 0
    except Exception as e:
        _log(conn, "garmin", "sleep", "error", 0, str(e))
        print(f"  WARN sleep {d}: {e}", file=sys.stderr)
        return 0


def sync_daily_stats(client, conn, d: str, force: bool) -> int:
    if not force:
        row = conn.execute("SELECT date FROM daily_stats WHERE date=?", (d,)).fetchone()
        if row:
            return 0

    try:
        raw = client.get_stats(d)
        _write_raw("daily_stats", f"daily_stats_{d}", raw)
        parsed = _parse_daily_stats(raw, d)
        if parsed:
            conn.execute(
                """INSERT OR REPLACE INTO daily_stats
                   (date, steps, active_calories, total_calories, resting_hr,
                    stress_avg, body_battery_low, body_battery_high, raw_payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (parsed["date"], parsed["steps"], parsed["active_calories"],
                 parsed["total_calories"], parsed["resting_hr"], parsed["stress_avg"],
                 parsed["body_battery_low"], parsed["body_battery_high"], json.dumps(raw)),
            )
        _log(conn, "garmin", "daily_stats", "ok", 1 if parsed else 0)
        return 1 if parsed else 0
    except Exception as e:
        _log(conn, "garmin", "daily_stats", "error", 0, str(e))
        print(f"  WARN daily_stats {d}: {e}", file=sys.stderr)
        return 0


def sync_hrv(client, conn, d: str, force: bool) -> int:
    if not force:
        row = conn.execute("SELECT date FROM hrv WHERE date=?", (d,)).fetchone()
        if row:
            return 0

    try:
        raw = client.get_hrv_data(d)
        _write_raw("hrv", f"hrv_status_{d}", raw)
        parsed = _parse_hrv(raw, d)
        if parsed:
            conn.execute(
                """INSERT OR REPLACE INTO hrv
                   (date, last_night_avg, weekly_avg, status, raw_payload)
                   VALUES (?, ?, ?, ?, ?)""",
                (parsed["date"], parsed["last_night_avg"], parsed["weekly_avg"],
                 parsed["status"], json.dumps(raw)),
            )
        _log(conn, "garmin", "hrv", "ok", 1 if parsed else 0)
        return 1 if parsed else 0
    except Exception as e:
        _log(conn, "garmin", "hrv", "error", 0, str(e))
        print(f"  WARN hrv {d}: {e}", file=sys.stderr)
        return 0


def _fetch_activity_polyline(client, native_id: str) -> str | None:
    """Fetch GPS polyline for a single activity. Returns Google-encoded polyline or None."""
    try:
        # GPX gives us a track we can encode; some Garmin activities expose a
        # pre-encoded polyline directly via the activity details endpoint.
        details = client.get_activity(native_id)
        # garminconnect returns the activity summary dict from get_activity
        # The polyline may be in summarizedActivitiesExport or direct field
        if isinstance(details, dict):
            poly = details.get("polylineEncoded") or details.get("encodedPolyline")
            if poly:
                return poly
        return None
    except Exception:
        return None


def _fetch_and_store_streams(client, conn, activity_id_full: str, native_id: str) -> None:
    """Fetch per-second streams and store in activity_streams."""
    # garminconnect exposes get_activity_splits and get_activity_hr_in_timezones
    # but the most reliable stream data comes from get_activity_details
    try:
        details = client.get_activity_details(native_id)
        if not details or not isinstance(details, dict):
            return
        metrics = details.get("activityDetailMetrics") or []
        if not metrics:
            return

        # metricDescriptors maps column position → stream name
        descriptors = details.get("metricDescriptors") or []
        idx_to_name: dict[int, str] = {}
        for d in descriptors:
            if not isinstance(d, dict):
                continue
            idx = d.get("metricsIndex")
            name = (d.get("key") or d.get("metricsType") or "").lower()
            if idx is not None and name:
                idx_to_name[idx] = name

        streams: dict[str, list] = {}
        for point in metrics:
            if not isinstance(point, dict):
                continue
            vals = point.get("metrics", [])
            for i, val in enumerate(vals):
                name = idx_to_name.get(i)
                if name:
                    streams.setdefault(name, []).append(val)

        for stream_type, values in streams.items():
            if not values:
                continue
            conn.execute(
                """INSERT OR REPLACE INTO activity_streams (activity_id, stream_type, data_json)
                   VALUES (?, ?, ?)""",
                (activity_id_full, stream_type, json.dumps(values)),
            )
    except Exception as e:
        print(f"    WARN streams {native_id}: {e}", file=sys.stderr)


def sync_activities(client, conn, start: str, end: str, force: bool, fetch_streams: bool = False) -> int:
    try:
        raw_list = client.get_activities_by_date(start, end)
        if not raw_list:
            _log(conn, "garmin", "activities", "ok", 0)
            return 0

        _write_raw("activities", f"activities_{start}_to_{end}", raw_list)
        count = 0
        for raw in raw_list:
            parsed = _parse_activity(raw)
            if not parsed["id"] or not parsed["date"]:
                continue

            activity_id = parsed["id"]
            native_id = str(raw.get("activityId", ""))

            if not force:
                row = conn.execute("SELECT id FROM activities WHERE id=?", (activity_id,)).fetchone()
                if row:
                    continue

            # Fetch polyline for activities that have GPS
            polyline = None
            has_gps = raw.get("hasPolyline") or raw.get("startLatitude") is not None
            if has_gps and native_id:
                polyline = _fetch_activity_polyline(client, native_id)
                if polyline:
                    time.sleep(RATE_LIMIT_SLEEP)

            conn.execute(
                """INSERT OR REPLACE INTO activities
                   (id, date, source, activity_type, name, start_time,
                    duration_seconds, moving_time_seconds, distance_meters,
                    elevation_gain_meters, avg_heart_rate, max_heart_rate,
                    avg_speed_mps, avg_power_watts, calories,
                    training_stress_score, polyline, start_lat, start_lng,
                    raw_payload, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                           strftime('%Y-%m-%dT%H:%M:%SZ','now'))""",
                (
                    activity_id, parsed["date"], parsed["source"],
                    parsed["activity_type"], parsed["name"], parsed["start_time"],
                    parsed["duration_seconds"], parsed["moving_time_seconds"],
                    parsed["distance_meters"], parsed["elevation_gain_meters"],
                    parsed["avg_heart_rate"], parsed["max_heart_rate"],
                    parsed["avg_speed_mps"], parsed["avg_power_watts"],
                    parsed["calories"], parsed["training_stress_score"],
                    polyline, parsed["start_lat"], parsed["start_lng"],
                    json.dumps(raw),
                ),
            )

            if fetch_streams and native_id:
                _fetch_and_store_streams(client, conn, activity_id, native_id)
                time.sleep(RATE_LIMIT_SLEEP)

            count += 1

        _log(conn, "garmin", "activities", "ok", count)
        return count
    except Exception as e:
        _log(conn, "garmin", "activities", "error", 0, str(e))
        print(f"  WARN activities {start}→{end}: {e}", file=sys.stderr)
        return 0


# ─── Plan session auto-linking ───────────────────────────────────────────────

_DISCIPLINE_MAP: dict[str, str] = {
    "running": "running",
    "trail_running": "running",
    "cycling": "ride",
    "cycling_road": "ride",
    "mountain_biking": "ride",
    "swimming": "swimming",
    "open_water_swimming": "swimming",
    "pool_swimming": "swimming",
}


def _link_activities_to_plan_sessions(conn, start_date: str, end_date: str) -> int:
    """After activity sync, match new activities to pending plan_sessions by date+discipline."""
    rows = conn.execute(
        "SELECT id, date, activity_type, duration_seconds FROM activities "
        "WHERE date BETWEEN ? AND ? AND source='garmin'",
        (start_date, end_date),
    ).fetchall()

    linked = 0
    for r in rows:
        discipline = _DISCIPLINE_MAP.get(r["activity_type"] or "")
        if not discipline:
            continue
        session = conn.execute(
            "SELECT id FROM plan_sessions WHERE session_date=? AND discipline=? "
            "AND status='pending' LIMIT 1",
            (r["date"], discipline),
        ).fetchone()
        if session:
            conn.execute(
                "UPDATE plan_sessions SET status='completed', completed_activity_id=?, "
                "effective_duration_min=?, "
                "updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                (r["id"], round((r["duration_seconds"] or 0) / 60), session["id"]),
            )
            linked += 1
    return linked


# ─── Main ────────────────────────────────────────────────────────────────────

def _last_synced_date(conn) -> date:
    """Return the most recent date present in any per-day health table."""
    dates = []
    for table in ("sleep", "daily_stats"):
        row = conn.execute(f"SELECT MAX(date) FROM {table}").fetchone()
        if row and row[0]:
            dates.append(date.fromisoformat(row[0]))
    return max(dates) if dates else date(2015, 1, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Garmin data into daybook.db")
    parser.add_argument("--start-date", default=None)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--full-history", action="store_true")
    parser.add_argument("--types", default=",".join(ALL_TYPES))
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--streams", action="store_true",
                        help="Also fetch per-second activity streams (slower)")
    args = parser.parse_args()

    today = date.today()

    if args.full_history:
        start = date(2015, 1, 1)
    elif args.start_date:
        start = date.fromisoformat(args.start_date)
    else:
        conn_probe = get_connection()
        last = _last_synced_date(conn_probe)
        conn_probe.close()
        start = last + timedelta(days=1)
        if start > today:
            start = today

    end = date.fromisoformat(args.end_date) if args.end_date else today
    types = [t.strip() for t in args.types.split(",")]

    print(f"Garmin sync: {start} → {end}  types={types}  force={args.force}", file=sys.stderr)

    client = get_client()
    conn = get_connection()
    total_records = 0
    sync_error = None

    try:
        totals = {t: 0 for t in types}

        if "activities" in types:
            print(f"  activities {start} → {end}", file=sys.stderr)
            totals["activities"] = sync_activities(
                client, conn, str(start), str(end), args.force, fetch_streams=args.streams
            )
            total_records += totals["activities"]
            linked = _link_activities_to_plan_sessions(conn, str(start), str(end))
            if linked:
                print(f"  auto-linked {linked} activit{'y' if linked == 1 else 'ies'} to plan sessions", file=sys.stderr)
            conn.commit()
            time.sleep(RATE_LIMIT_SLEEP)

        per_day = [t for t in types if t != "activities"]
        if per_day:
            d = start
            while d <= end:
                ds = d.isoformat()
                force_day = args.force or (d == today)
                print(f"  {ds}", file=sys.stderr, end="")
                for t in per_day:
                    if t == "sleep":
                        n = sync_sleep(client, conn, ds, force_day)
                    elif t == "daily_stats":
                        n = sync_daily_stats(client, conn, ds, force_day)
                    elif t == "hrv":
                        n = sync_hrv(client, conn, ds, force_day)
                    else:
                        n = 0
                    totals[t] += n
                    total_records += n
                    print(f"  {t}={n}", file=sys.stderr, end="")
                    time.sleep(RATE_LIMIT_SLEEP)

                conn.commit()
                print("", file=sys.stderr)
                d += timedelta(days=1)

        _update_sync_status(conn, "garmin", success=True, records=total_records)
        conn.commit()

    except Exception as e:
        sync_error = str(e)
        _update_sync_status(conn, "garmin", success=False, error=sync_error)
        conn.commit()
        raise
    finally:
        conn.close()

    print("\nDone.", file=sys.stderr)
    for t, n in totals.items():
        print(f"  {t}: {n} records", file=sys.stderr)


if __name__ == "__main__":
    main()
