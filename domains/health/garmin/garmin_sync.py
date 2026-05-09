"""
Garmin sync: pulls sleep, daily_stats, hrv, and activities from Garmin Connect
and writes them into daybook.db + data/raw/garmin/{type}/{date}.json.

Usage (from daybook/ root):
    python -m domains.health.garmin.garmin_sync [options]

Options:
    --start-date YYYY-MM-DD   default: yesterday
    --end-date   YYYY-MM-DD   default: today
    --full-history            set start-date to 2015-01-01
    --types sleep,daily_stats,hrv,activities   default: all
    --force                   re-sync even if row already exists
"""

import argparse
import json
import sys
import time
from datetime import date, timedelta
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
        "avg_hrv": dto.get("avgSleepStress"),      # proxy; true HRV in hrv table
        "avg_spo2": dto.get("averageSpO2Value"),
        "score": dto.get("sleepScores", {}).get("overall", {}).get("value") if isinstance(dto.get("sleepScores"), dict) else None,
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
    return {
        "activity_id": str(raw.get("activityId", "")),
        "date": d,
        "type": raw.get("activityType", {}).get("typeKey") if isinstance(raw.get("activityType"), dict) else raw.get("activityType"),
        "name": raw.get("activityName"),
        "start_time": start,
        "duration_seconds": int(raw.get("duration", 0) or 0),
        "distance_meters": raw.get("distance"),
        "avg_hr": raw.get("averageHR"),
        "max_hr": raw.get("maxHR"),
        "calories": raw.get("calories"),
        "elevation_gain": raw.get("elevationGain"),
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
                "INSERT OR REPLACE INTO sleep (date, duration_seconds, deep_seconds, light_seconds, rem_seconds, awake_seconds, avg_hrv, avg_spo2, score, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (parsed["date"], parsed["duration_seconds"], parsed["deep_seconds"], parsed["light_seconds"],
                 parsed["rem_seconds"], parsed["awake_seconds"], parsed["avg_hrv"], parsed["avg_spo2"],
                 parsed["score"], json.dumps(raw)),
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
                "INSERT OR REPLACE INTO daily_stats (date, steps, active_calories, total_calories, resting_hr, stress_avg, body_battery_low, body_battery_high, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (parsed["date"], parsed["steps"], parsed["active_calories"], parsed["total_calories"],
                 parsed["resting_hr"], parsed["stress_avg"], parsed["body_battery_low"],
                 parsed["body_battery_high"], json.dumps(raw)),
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
                "INSERT OR REPLACE INTO hrv (date, last_night_avg, weekly_avg, status, raw_json) VALUES (?, ?, ?, ?, ?)",
                (parsed["date"], parsed["last_night_avg"], parsed["weekly_avg"], parsed["status"], json.dumps(raw)),
            )
        _log(conn, "garmin", "hrv", "ok", 1 if parsed else 0)
        return 1 if parsed else 0
    except Exception as e:
        _log(conn, "garmin", "hrv", "error", 0, str(e))
        print(f"  WARN hrv {d}: {e}", file=sys.stderr)
        return 0


def sync_activities(client, conn, start: str, end: str, force: bool) -> int:
    try:
        raw_list = client.get_activities_by_date(start, end)
        if not raw_list:
            _log(conn, "garmin", "activities", "ok", 0)
            return 0

        _write_raw("activities", f"activities_{start}_to_{end}", raw_list)
        count = 0
        for raw in raw_list:
            parsed = _parse_activity(raw)
            if not parsed["activity_id"]:
                continue
            if not force:
                row = conn.execute("SELECT activity_id FROM activities WHERE activity_id=?", (parsed["activity_id"],)).fetchone()
                if row:
                    continue
            conn.execute(
                "INSERT OR REPLACE INTO activities (activity_id, date, type, name, start_time, duration_seconds, distance_meters, avg_hr, max_hr, calories, elevation_gain, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (parsed["activity_id"], parsed["date"], parsed["type"], parsed["name"], parsed["start_time"],
                 parsed["duration_seconds"], parsed["distance_meters"], parsed["avg_hr"], parsed["max_hr"],
                 parsed["calories"], parsed["elevation_gain"], json.dumps(raw)),
            )
            count += 1

        _log(conn, "garmin", "activities", "ok", count)
        return count
    except Exception as e:
        _log(conn, "garmin", "activities", "error", 0, str(e))
        print(f"  WARN activities {start}→{end}: {e}", file=sys.stderr)
        return 0


# ─── Main ────────────────────────────────────────────────────────────────────

def _last_synced_date(conn) -> date:
    """Return the most recent date present in ALL per-day health tables."""
    dates = []
    for table in ("sleep", "daily_stats"):
        row = conn.execute(f"SELECT MAX(date) FROM {table}").fetchone()
        if row and row[0]:
            dates.append(date.fromisoformat(row[0]))
    return min(dates) if dates else date(2015, 1, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Garmin data into daybook.db")
    parser.add_argument("--start-date", default=None)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--full-history", action="store_true")
    parser.add_argument("--types", default=",".join(ALL_TYPES))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    today = date.today()

    if args.full_history:
        start = date(2015, 1, 1)
    elif args.start_date:
        start = date.fromisoformat(args.start_date)
    else:
        # Default: pick up from the day after the last synced date.
        # This means the first run after a gap automatically fills it.
        conn_probe = get_connection()
        last = _last_synced_date(conn_probe)
        conn_probe.close()
        start = last + timedelta(days=1)
        if start > today:
            print("Already up to date.", file=sys.stderr)
            return

    end = date.fromisoformat(args.end_date) if args.end_date else today
    types = [t.strip() for t in args.types.split(",")]

    print(f"Garmin sync: {start} → {end}  types={types}  force={args.force}", file=sys.stderr)

    client = get_client()
    conn = get_connection()

    totals = {t: 0 for t in types}

    # Activities: one API call covers the whole range
    if "activities" in types:
        print(f"  activities {start} → {end}", file=sys.stderr)
        totals["activities"] = sync_activities(client, conn, str(start), str(end), args.force)
        conn.commit()
        time.sleep(RATE_LIMIT_SLEEP)

    # Per-day types
    per_day = [t for t in types if t != "activities"]
    if per_day:
        d = start
        while d <= end:
            ds = d.isoformat()
            print(f"  {ds}", file=sys.stderr, end="")
            for t in per_day:
                if t == "sleep":
                    n = sync_sleep(client, conn, ds, args.force)
                elif t == "daily_stats":
                    n = sync_daily_stats(client, conn, ds, args.force)
                elif t == "hrv":
                    n = sync_hrv(client, conn, ds, args.force)
                else:
                    n = 0
                totals[t] += n
                print(f"  {t}={n}", file=sys.stderr, end="")
                time.sleep(RATE_LIMIT_SLEEP)

            conn.commit()
            print("", file=sys.stderr)
            d += timedelta(days=1)

    conn.close()
    print("\nDone.", file=sys.stderr)
    for t, n in totals.items():
        print(f"  {t}: {n} records", file=sys.stderr)


if __name__ == "__main__":
    main()
