"""
Bootstrap the database from pre-existing raw JSON files (no API calls).

Scans a source directory for files matching the naming convention used by
miquelOS and this project's own garmin_sync.py:
    sleep_YYYY-MM-DD.json
    daily_stats_YYYY-MM-DD.json
    hrv_status_YYYY-MM-DD.json
    activities_YYYY-MM-DD.json  (list of activity objects)

Usage (from daybook/ root):
    python -m domains.health.garmin.import_raw \\
        --source-dir /path/to/garmin/raw/
"""

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).parents[3]   # daybook/

from infrastructure.db.connection import get_connection
from domains.health.garmin.garmin_sync import (
    _parse_sleep,
    _parse_daily_stats,
    _parse_hrv,
    _parse_activity,
    _log,
)

DEFAULT_SOURCE = _ROOT / "data" / "raw" / "garmin"


def _date_from_name(stem: str) -> str | None:
    """Extract YYYY-MM-DD from filename stem like 'sleep_2024-03-15'."""
    parts = stem.rsplit("_", 3)
    for i in range(len(parts) - 1, 0, -1):
        candidate = "_".join(parts[i:])
        if len(candidate) == 10:
            try:
                from datetime import date
                date.fromisoformat(candidate)
                return candidate
            except ValueError:
                pass
    return None


def import_raw(source_dir: Path, force: bool = False) -> None:
    conn = get_connection()
    counts = {"sleep": 0, "daily_stats": 0, "hrv": 0, "activities": 0, "skipped": 0, "errors": 0}

    files = sorted(source_dir.glob("*.json"))
    print(f"Scanning {len(files)} files in {source_dir}", file=sys.stderr)

    for path in files:
        stem = path.stem
        raw_text = path.read_text()

        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError as e:
            print(f"  SKIP (bad JSON) {path.name}: {e}", file=sys.stderr)
            counts["errors"] += 1
            continue

        # ── Sleep ────────────────────────────────────────────────────────────
        if stem.startswith("sleep_"):
            d = _date_from_name(stem)
            if not d:
                counts["skipped"] += 1
                continue
            if not force and conn.execute("SELECT date FROM sleep WHERE date=?", (d,)).fetchone():
                counts["skipped"] += 1
                continue
            parsed = _parse_sleep(raw, d)
            if parsed:
                conn.execute(
                    "INSERT OR REPLACE INTO sleep (date, duration_seconds, deep_seconds, light_seconds, rem_seconds, awake_seconds, avg_hrv, avg_spo2, score, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (parsed["date"], parsed["duration_seconds"], parsed["deep_seconds"], parsed["light_seconds"],
                     parsed["rem_seconds"], parsed["awake_seconds"], parsed["avg_hrv"], parsed["avg_spo2"],
                     parsed["score"], raw_text),
                )
                counts["sleep"] += 1

        # ── Daily stats ───────────────────────────────────────────────────────
        elif stem.startswith("daily_stats_"):
            d = _date_from_name(stem)
            if not d:
                counts["skipped"] += 1
                continue
            if not force and conn.execute("SELECT date FROM daily_stats WHERE date=?", (d,)).fetchone():
                counts["skipped"] += 1
                continue
            parsed = _parse_daily_stats(raw, d)
            if parsed:
                conn.execute(
                    "INSERT OR REPLACE INTO daily_stats (date, steps, active_calories, total_calories, resting_hr, stress_avg, body_battery_low, body_battery_high, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (parsed["date"], parsed["steps"], parsed["active_calories"], parsed["total_calories"],
                     parsed["resting_hr"], parsed["stress_avg"], parsed["body_battery_low"],
                     parsed["body_battery_high"], raw_text),
                )
                counts["daily_stats"] += 1

        # ── HRV ──────────────────────────────────────────────────────────────
        elif stem.startswith("hrv_status_"):
            d = _date_from_name(stem)
            if not d:
                counts["skipped"] += 1
                continue
            if not force and conn.execute("SELECT date FROM hrv WHERE date=?", (d,)).fetchone():
                counts["skipped"] += 1
                continue
            parsed = _parse_hrv(raw, d)
            if parsed:
                conn.execute(
                    "INSERT OR REPLACE INTO hrv (date, last_night_avg, weekly_avg, status, raw_json) VALUES (?, ?, ?, ?, ?)",
                    (parsed["date"], parsed["last_night_avg"], parsed["weekly_avg"], parsed["status"], raw_text),
                )
                counts["hrv"] += 1

        # ── Activities ───────────────────────────────────────────────────────
        elif stem.startswith("activities_"):
            items = raw if isinstance(raw, list) else raw.get("activityList", [raw])
            for item in items:
                parsed = _parse_activity(item)
                if not parsed["activity_id"]:
                    continue
                if not force and conn.execute("SELECT activity_id FROM activities WHERE activity_id=?", (parsed["activity_id"],)).fetchone():
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO activities (activity_id, date, type, name, start_time, duration_seconds, distance_meters, avg_hr, max_hr, calories, elevation_gain, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (parsed["activity_id"], parsed["date"], parsed["type"], parsed["name"], parsed["start_time"],
                     parsed["duration_seconds"], parsed["distance_meters"], parsed["avg_hr"], parsed["max_hr"],
                     parsed["calories"], parsed["elevation_gain"], json.dumps(item)),
                )
                counts["activities"] += 1
        else:
            counts["skipped"] += 1

        conn.commit()

    conn.close()
    _print_summary(counts)


def _print_summary(counts: dict) -> None:
    print("\nImport complete:", file=sys.stderr)
    for k, v in counts.items():
        print(f"  {k}: {v}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import pre-existing raw Garmin JSON into daybook.db")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE,
                        help=f"Directory containing raw JSON files (default: {DEFAULT_SOURCE})")
    parser.add_argument("--force", action="store_true", help="Re-import even if row already exists")
    args = parser.parse_args()

    if not args.source_dir.exists():
        sys.exit(f"ERROR: source-dir does not exist: {args.source_dir}")

    import_raw(args.source_dir, args.force)


if __name__ == "__main__":
    main()
