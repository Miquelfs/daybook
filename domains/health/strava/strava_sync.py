"""
Strava sync: enriches existing Garmin activities with Strava cross-references,
pulls segment efforts, and imports Strava-only activities (no Garmin counterpart).

Garmin is the source of truth for matched activities. Strava-only activities
(619 total vs 350 Garmin) are imported as source='strava' rows so they appear
in the day view and on maps.

Usage (from daybook/ root):
    python -m domains.health.strava.strava_sync [options]

Options:
    --days N          Look back N days (default: 30)
    --full-history    Process all Strava activities (slow — use once)
    --no-segments     Skip segment effort fetch
    --no-import       Skip importing Strava-only activities
    --force           Re-process activities that already have strava_id set
"""

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).parents[3]

from infrastructure.db.connection import get_connection
from domains.health.strava.strava_client import StravaClient

RAW_DIR = _ROOT / "data" / "raw" / "strava"
RATE_LIMIT_SLEEP = 1.0
MATCH_WINDOW_SECONDS = 90   # generous window: Garmin stores local time, Strava UTC


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _write_raw(data_type: str, name: str, payload: object) -> None:
    path = RAW_DIR / data_type / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def _log(conn, source: str, data_type: str, status: str, records: int = 0, error: str | None = None) -> None:
    conn.execute(
        "INSERT INTO sync_log (source, data_type, status, records_synced, error) VALUES (?,?,?,?,?)",
        (source, data_type, status, records, error),
    )


def _update_sync_status(conn, success: bool, records: int = 0, error: str | None = None) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        """
        INSERT INTO sync_status (source, last_attempt_at, last_success_at, last_error, records_synced)
        VALUES ('strava', ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_success_at = CASE WHEN ? THEN excluded.last_success_at ELSE last_success_at END,
            last_error      = excluded.last_error,
            records_synced  = excluded.records_synced
        """,
        (now, now if success else None, error, records, success),
    )


def _parse_dt(s: str | None) -> datetime | None:
    """Parse a datetime string to a naive UTC datetime for comparison.

    Garmin stores local time as 'YYYY-MM-DD HH:MM:SS' (no tz, no T).
    Strava start_date is UTC 'YYYY-MM-DDTHH:MM:SSZ'.
    Strava start_date_local is local 'YYYY-MM-DDTHH:MM:SS'.

    We treat Garmin's value as if it were UTC (it's actually local, but the
    offset is small enough that MATCH_WINDOW_SECONDS covers any residual skew).
    We always compare against Strava's start_date (UTC).
    """
    if not s:
        return None
    for fmt in (
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S+00:00",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",   # Garmin format
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _strava_type_to_key(sport_type: str) -> str:
    """Normalise Strava sport type to lowercase activity_type key."""
    mapping = {
        "Run": "running", "TrailRun": "trail_running",
        "Ride": "cycling", "VirtualRide": "virtual_ride",
        "Swim": "swimming",
        "Walk": "walking", "Hike": "hiking",
        "WeightTraining": "strength_training",
        "Yoga": "yoga",
        "AlpineSki": "alpine_skiing", "NordicSki": "nordic_skiing",
        "Workout": "workout",
    }
    return mapping.get(sport_type, sport_type.lower())


# ─── Cross-reference matching ─────────────────────────────────────────────────

def _match_strava_to_garmin(strava_activities: list[dict], garmin_rows: list) -> dict[str, dict]:
    """
    Match Strava activities to Garmin rows by start_date (UTC) within MATCH_WINDOW_SECONDS.
    Returns {garmin_id: strava_activity}.
    """
    matches: dict[str, dict] = {}
    used_strava_ids: set[str] = set()

    for garmin_row in garmin_rows:
        garmin_dt = _parse_dt(garmin_row["start_time"])
        if garmin_dt is None:
            continue

        best: tuple[float, dict] | None = None
        for strava_act in strava_activities:
            sid = str(strava_act.get("id", ""))
            if sid in used_strava_ids:
                continue
            strava_dt = _parse_dt(strava_act.get("start_date"))
            if strava_dt is None:
                continue
            diff = abs((garmin_dt - strava_dt).total_seconds())
            if diff <= MATCH_WINDOW_SECONDS:
                if best is None or diff < best[0]:
                    best = (diff, strava_act)

        if best is not None:
            matches[garmin_row["id"]] = best[1]
            used_strava_ids.add(str(best[1].get("id", "")))

    return matches


def _unmatched_strava(strava_activities: list[dict], matched_strava_ids: set[str]) -> list[dict]:
    """Return Strava activities that have no Garmin counterpart."""
    return [a for a in strava_activities if str(a.get("id", "")) not in matched_strava_ids]


# ─── Segment effort storage ───────────────────────────────────────────────────

def _ensure_segment(conn, strava_segment: dict) -> int:
    strava_id = str(strava_segment.get("id", ""))
    existing = conn.execute(
        "SELECT id FROM segments WHERE strava_segment_id=?", (strava_id,)
    ).fetchone()
    if existing:
        return existing["id"]

    polyline = (strava_segment.get("map") or {}).get("polyline") or ""
    conn.execute(
        """INSERT INTO segments
           (name, activity_type, polyline, distance_meters, elevation_gain_meters,
            source, strava_segment_id)
           VALUES (?,?,?,?,?,'strava',?)""",
        (
            strava_segment.get("name", "Unknown segment"),
            _strava_type_to_key(strava_segment.get("activity_type") or ""),
            polyline,
            strava_segment.get("distance"),
            strava_segment.get("total_elevation_gain"),
            strava_id,
        ),
    )
    return conn.execute(
        "SELECT id FROM segments WHERE strava_segment_id=?", (strava_id,)
    ).fetchone()["id"]


def _store_segment_efforts(conn, activity_id: str, date: str, segment_efforts: list[dict]) -> int:
    count = 0
    for effort in segment_efforts:
        seg_data = effort.get("segment", {})
        if not seg_data:
            continue
        seg_db_id = _ensure_segment(conn, seg_data)
        already = conn.execute(
            "SELECT id FROM segment_efforts WHERE segment_id=? AND activity_id=?",
            (seg_db_id, activity_id),
        ).fetchone()
        if already:
            continue
        conn.execute(
            """INSERT INTO segment_efforts
               (segment_id, activity_id, date, duration_seconds,
                avg_heart_rate, avg_power_watts, is_personal_record)
               VALUES (?,?,?,?,?,?,?)""",
            (
                seg_db_id, activity_id, date,
                effort.get("elapsed_time") or effort.get("moving_time") or 0,
                effort.get("average_heartrate"),
                effort.get("average_watts"),
                1 if effort.get("pr_rank") == 1 else 0,
            ),
        )
        count += 1
    return count


# ─── Import Strava-only activities ────────────────────────────────────────────

def _import_strava_only(conn, strava_act: dict, fetch_detail: bool, client: StravaClient | None) -> bool:
    """Insert a Strava-only activity (no Garmin counterpart) as source='strava'."""
    strava_id = str(strava_act.get("id", ""))
    activity_id = f"strava_{strava_id}"

    already = conn.execute(
        "SELECT id FROM activities WHERE id=?", (activity_id,)
    ).fetchone()
    if already:
        return False

    start_date = strava_act.get("start_date", "")
    date_str = start_date[:10] if start_date else ""
    if not date_str:
        return False

    # Ensure the days spine row exists
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))

    polyline = (strava_act.get("map") or {}).get("summary_polyline") or None

    # Distance/elevation: Strava uses metres
    conn.execute(
        """INSERT OR IGNORE INTO activities
           (id, date, source, strava_id, activity_type, name, start_time,
            duration_seconds, moving_time_seconds, distance_meters,
            elevation_gain_meters, avg_heart_rate, max_heart_rate,
            avg_speed_mps, avg_power_watts, calories,
            training_stress_score, polyline,
            start_lat, start_lng, raw_payload)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            activity_id, date_str, "strava", strava_id,
            _strava_type_to_key(strava_act.get("sport_type") or strava_act.get("type") or ""),
            strava_act.get("name"),
            start_date,
            strava_act.get("elapsed_time"),
            strava_act.get("moving_time"),
            strava_act.get("distance"),
            strava_act.get("total_elevation_gain"),
            int(strava_act.get("average_heartrate") or 0) or None,
            int(strava_act.get("max_heartrate") or 0) or None,
            strava_act.get("average_speed"),
            int(strava_act.get("average_watts") or 0) or None,
            strava_act.get("kilojoules"),         # no direct kcal in list endpoint
            strava_act.get("suffer_score"),        # rough TSS proxy
            polyline,
            strava_act.get("start_latlng", [None, None])[0],
            strava_act.get("start_latlng", [None, None])[1],
            json.dumps(strava_act),
        ),
    )
    return True


# ─── Main sync ────────────────────────────────────────────────────────────────

def sync(days_back: int = 30, full_history: bool = False, no_segments: bool = False,
         no_import: bool = False, force: bool = False) -> None:

    conn = get_connection()
    total_matched = 0
    total_imported = 0
    total_efforts = 0
    sync_error = None

    try:
        client = StravaClient()

        # ── Fetch Strava activities ────────────────────────────────────────────
        after_ts = 0 if full_history else int(
            (datetime.now(timezone.utc) - timedelta(days=days_back)).timestamp()
        )
        print(f"Fetching Strava activities (after={after_ts})...", file=sys.stderr)

        strava_activities: list[dict] = []
        page = 1
        while True:
            batch = client.get_activities(after=after_ts or None, page=page, per_page=100)
            if not batch:
                break
            strava_activities.extend(batch)
            print(f"  page {page}: {len(batch)} activities", file=sys.stderr)
            if len(batch) < 100:
                break
            page += 1
            time.sleep(RATE_LIMIT_SLEEP)

        print(f"  Total: {len(strava_activities)} Strava activities", file=sys.stderr)
        _write_raw("activities", "strava_activities_all", strava_activities)

        if not strava_activities:
            _update_sync_status(conn, success=True, records=0)
            conn.commit()
            conn.close()
            return

        # ── Load Garmin rows in same window ───────────────────────────────────
        if full_history:
            q = "SELECT id, start_time, date FROM activities WHERE source='garmin'"
            params: list = []
            if not force:
                q += " AND strava_id IS NULL"
        else:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")
            q = "SELECT id, start_time, date FROM activities WHERE source='garmin' AND date >= ?"
            params = [cutoff]
            if not force:
                q += " AND strava_id IS NULL"

        garmin_rows = conn.execute(q, params).fetchall()
        print(f"  Garmin rows to match: {len(garmin_rows)}", file=sys.stderr)

        # ── Match ──────────────────────────────────────────────────────────────
        matches = _match_strava_to_garmin(strava_activities, garmin_rows)
        matched_strava_ids = {str(v.get("id", "")) for v in matches.values()}
        print(f"  Matched {len(matches)} Garmin↔Strava pairs", file=sys.stderr)

        for garmin_id, strava_act in matches.items():
            strava_id = str(strava_act.get("id", ""))
            _write_raw("activities", f"strava_{strava_id}", strava_act)

            strava_polyline = (strava_act.get("map") or {}).get("summary_polyline") or ""
            garmin_poly = conn.execute(
                "SELECT polyline, date FROM activities WHERE id=?", (garmin_id,)
            ).fetchone()
            update_polyline = strava_polyline and not garmin_poly["polyline"]

            if update_polyline:
                conn.execute(
                    """UPDATE activities SET strava_id=?, polyline=?,
                       updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?""",
                    (strava_id, strava_polyline, garmin_id),
                )
            else:
                conn.execute(
                    """UPDATE activities SET strava_id=?,
                       updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?""",
                    (strava_id, garmin_id),
                )

            total_matched += 1

            # ── Segment efforts ───────────────────────────────────────────────
            if not no_segments:
                try:
                    detail = client.get_activity(strava_id)
                    _write_raw("activities", f"strava_detail_{strava_id}", detail)
                    time.sleep(RATE_LIMIT_SLEEP)
                    efforts = detail.get("segment_efforts") or []
                    if efforts:
                        date_str = garmin_poly["date"]
                        n = _store_segment_efforts(conn, garmin_id, date_str, efforts)
                        total_efforts += n
                        if n:
                            print(f"    {garmin_id}: {n} segment efforts", file=sys.stderr)
                except Exception as e:
                    print(f"    WARN segment efforts {garmin_id}: {e}", file=sys.stderr)

            conn.commit()
            time.sleep(RATE_LIMIT_SLEEP)

        _log(conn, "strava", "cross_reference", "ok", total_matched)
        if total_efforts:
            _log(conn, "strava", "segment_efforts", "ok", total_efforts)

        # ── Import Strava-only activities ──────────────────────────────────────
        if not no_import:
            unmatched = _unmatched_strava(strava_activities, matched_strava_ids)
            print(f"\n  Strava-only activities to import: {len(unmatched)}", file=sys.stderr)
            for strava_act in unmatched:
                try:
                    imported = _import_strava_only(conn, strava_act, fetch_detail=False, client=client)
                    if imported:
                        total_imported += 1
                except Exception as e:
                    sid = strava_act.get("id")
                    print(f"    WARN import strava_{sid}: {e}", file=sys.stderr)

            if total_imported:
                _log(conn, "strava", "imported_activities", "ok", total_imported)
            conn.commit()
            print(f"  Imported {total_imported} Strava-only activities", file=sys.stderr)

        _update_sync_status(conn, success=True,
                            records=total_matched + total_efforts + total_imported)
        conn.commit()

    except Exception as e:
        sync_error = str(e)
        _update_sync_status(conn, success=False, error=sync_error)
        conn.commit()
        raise
    finally:
        conn.close()

    # Compute best efforts for any running activities that got streams this run
    try:
        from domains.health.insights.best_efforts import _ensure_table, process_all
        conn2 = get_connection()
        _ensure_table(conn2)
        n = process_all(conn2, force=False)
        if n:
            print(f"  best_efforts: {n} new efforts computed", file=sys.stderr)
        conn2.close()
    except Exception as e:
        print(f"  WARN best_efforts: {e}", file=sys.stderr)

    print(
        f"\nDone. matched={total_matched}  imported={total_imported}  segment_efforts={total_efforts}",
        file=sys.stderr,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Strava into daybook.db")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--full-history", action="store_true")
    parser.add_argument("--no-segments", action="store_true")
    parser.add_argument("--no-import", action="store_true",
                        help="Skip importing Strava-only activities")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    sync(
        days_back=args.days,
        full_history=args.full_history,
        no_segments=args.no_segments,
        no_import=args.no_import,
        force=args.force,
    )


if __name__ == "__main__":
    main()
