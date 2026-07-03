"""
Training dashboard API — weekly load, sport breakdown, PRs, activity list,
CTL/ATL/TSB, best-effort curves, readiness panel, goals, year-in-sport.
"""

import json
import math
import sqlite3
import polyline as _polyline_lib
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from infrastructure.db.connection import get_connection

router = APIRouter(prefix="/training", tags=["training"])

DB = Annotated[sqlite3.Connection, Depends(get_connection)]

# Human-readable sport names
_SPORT_LABELS: dict[str, str] = {
    "running": "Running", "trail_running": "Trail Run",
    "treadmill_running": "Treadmill", "indoor_running": "Treadmill",
    "virtual_run": "Virtual Run",
    "cycling": "Cycling", "road_biking": "Road Cycling",
    "mountain_biking": "MTB", "indoor_cycling": "Indoor Cycling",
    "virtual_ride": "Virtual Ride", "gravel_cycling": "Gravel",
    "lap_swimming": "Pool Swim", "open_water_swimming": "OW Swim",
    "swimming": "Swimming",
    "strength_training": "Strength", "fitness_equipment": "Gym",
    "yoga": "Yoga", "pilates": "Pilates",
    "tennis_v2": "Tennis", "tennis": "Tennis",
    "paddelball": "Padel", "padel": "Padel",
    "walking": "Walking", "hiking": "Hiking",
    "rowing": "Rowing", "other": "Other",
}

def _sport_label(raw: str | None) -> str:
    if not raw:
        return "Other"
    return _SPORT_LABELS.get(raw.lower(), raw.replace("_", " ").title())

# Sport group normalization (for CTL/ATL grouping)
_SPORT_GROUP: dict[str, str] = {
    "running": "run", "trail_running": "run", "treadmill_running": "run",
    "indoor_running": "run", "virtual_run": "run",
    "cycling": "ride", "road_biking": "ride", "mountain_biking": "ride",
    "indoor_cycling": "ride", "virtual_ride": "ride", "gravel_cycling": "ride",
    "lap_swimming": "swim", "open_water_swimming": "swim", "swimming": "swim",
}

# Strava-only duplicates excluded (same logic as days router)
_DEDUP = """
    AND NOT (source='strava' AND EXISTS (
      SELECT 1 FROM activities g
      WHERE g.date = activities.date
        AND g.source = 'garmin'
        AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
    ))
"""


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


def _tss_expr(conn: sqlite3.Connection, alias: str = "activities") -> str:
    """Return a SQL expression for TSS that falls back gracefully when activity_detail missing."""
    if _table_exists(conn, "activity_detail"):
        return f"COALESCE({alias}.training_stress_score, (SELECT hr_tss FROM activity_detail WHERE activity_id = {alias}.id), 0)"
    return f"COALESCE({alias}.training_stress_score, 0)"


@router.get("/weekly")
def weekly_load(
    conn: DB,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    weeks: int = Query(16),
):
    """Weekly training load grouped by sport type."""
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(weeks=weeks)).isoformat()

    tss = _tss_expr(conn)
    rows = conn.execute(
        f"""
        SELECT
            strftime('%Y-W%W', date)                    AS week,
            MIN(date)                                   AS week_start,
            activity_type,
            COUNT(*)                                    AS count,
            ROUND(SUM(distance_meters) / 1000.0, 1)    AS km,
            ROUND(SUM(duration_seconds) / 3600.0, 1)   AS hours,
            ROUND(SUM(elevation_gain_meters), 0)        AS elevation_m,
            ROUND(SUM({tss}), 0)                        AS tss
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY week, activity_type
        ORDER BY week, activity_type
        """,
        (start, end),
    ).fetchall()

    return [dict(r) for r in rows]


@router.get("/sport-breakdown")
def sport_breakdown(
    conn: DB,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    days: int = Query(90),
):
    """Distance, count and time grouped by sport for the given period."""
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(days=days)).isoformat()

    rows = conn.execute(
        f"""
        SELECT
            COALESCE(activity_type, 'other')            AS sport,
            COUNT(*)                                    AS count,
            ROUND(SUM(distance_meters) / 1000.0, 1)    AS km,
            ROUND(SUM(duration_seconds) / 3600.0, 2)   AS hours,
            ROUND(SUM(elevation_gain_meters), 0)        AS elevation_m,
            ROUND(AVG(avg_heart_rate), 0)               AS avg_hr
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY sport
        ORDER BY hours DESC
        """,
        (start, end),
    ).fetchall()

    return [{**dict(r), "sport_label": _sport_label(r["sport"])} for r in rows]


@router.get("/personal-records")
def personal_records(conn: DB, limit: int = Query(20)):
    """Most recent personal records on segments."""
    rows = conn.execute(
        """
        SELECT
            se.id,
            se.activity_id,
            a.date,
            a.activity_type,
            a.name                              AS activity_name,
            sg.name                             AS segment_name,
            sg.distance_meters                  AS segment_distance_m,
            sg.segment_type,
            se.duration_seconds,
            se.avg_heart_rate,
            se.avg_power_watts
        FROM segment_efforts se
        JOIN segments  sg ON sg.id = se.segment_id
        JOIN activities a  ON a.id  = se.activity_id
        WHERE se.is_personal_record = 1
        ORDER BY a.date DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    return [dict(r) for r in rows]


@router.get("/summary")
def training_summary(conn: DB, days: int = Query(30)):
    """KPI cards: total distance, hours, activities, elevation this period."""
    end = date.today()
    start = end - timedelta(days=days - 1)

    tss = _tss_expr(conn)
    row = conn.execute(
        f"""
        SELECT
            COUNT(*)                                    AS activity_count,
            ROUND(SUM(distance_meters) / 1000.0, 1)    AS total_km,
            ROUND(SUM(duration_seconds) / 3600.0, 1)   AS total_hours,
            ROUND(SUM(elevation_gain_meters), 0)        AS total_elevation_m,
            ROUND(AVG(avg_heart_rate), 0)               AS avg_hr,
            ROUND(SUM({tss}), 0)                        AS total_tss
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchone()

    # Previous period for comparison
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)

    prev = conn.execute(
        f"""
        SELECT
            COUNT(*)                                    AS activity_count,
            ROUND(SUM(distance_meters) / 1000.0, 1)    AS total_km
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        """,
        (prev_start.isoformat(), prev_end.isoformat()),
    ).fetchone()

    return {
        **dict(row),
        "prev_activity_count": prev["activity_count"],
        "prev_total_km": prev["total_km"],
        "period_days": days,
    }


@router.get("/activities")
def list_activities(
    conn: DB,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    sport: Optional[str] = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
):
    """Paginated activity list with optional sport filter."""
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(days=89)).isoformat()

    _SPORT_FAMILIES: dict[str, tuple[str, ...]] = {
        "run": _RUN_SPORT_TYPES,
        "running": _RUN_SPORT_TYPES,
        "ride": _RIDE_SPORT_TYPES,
        "cycling": _RIDE_SPORT_TYPES,
        "swim": ("lap_swimming", "open_water_swimming", "swimming"),
        "swimming": ("lap_swimming", "open_water_swimming", "swimming"),
        "walk": ("walking", "hiking", "indoor_walking"),
        "walking": ("walking", "hiking", "indoor_walking"),
    }

    _dedup_clause = _DEDUP.strip()
    if _dedup_clause.upper().startswith("AND "):
        _dedup_clause = _dedup_clause[4:]
    clauses = ["date BETWEEN ? AND ?", _dedup_clause]
    params: list = [start, end]

    if sport:
        family = _SPORT_FAMILIES.get(sport.lower())
        if family:
            placeholders = ",".join("?" * len(family))
            clauses.append(f"activity_type IN ({placeholders})")
            params.extend(family)
        else:
            clauses.append("activity_type = ?")
            params.append(sport)

    where = " AND ".join(clauses)

    rows = conn.execute(
        f"""
        SELECT
            id, date, source, activity_type, name, start_time,
            duration_seconds, moving_time_seconds,
            distance_meters, elevation_gain_meters,
            avg_heart_rate, max_heart_rate,
            avg_speed_mps, avg_power_watts, calories,
            training_stress_score, strava_id,
            CASE WHEN polyline IS NOT NULL THEN 1 ELSE 0 END AS has_polyline
        FROM activities
        WHERE {where}
        ORDER BY date DESC, start_time DESC
        LIMIT ? OFFSET ?
        """,
        (*params, limit, offset),
    ).fetchall()

    return [dict(r) for r in rows]


# ─── CTL / ATL / TSB (Fitness & Freshness) ──────────────────────────────────

@router.get("/load")
def training_load(
    conn: DB,
    sport: str = Query("combined"),
    range: int = Query(90),
):
    """
    CTL/ATL/TSB series for Fitness & Freshness chart.
    sport: run | ride | swim | combined
    range: days back from today
    """
    start = (date.today() - timedelta(days=range)).isoformat()
    if not _table_exists(conn, "training_load_daily"):
        return []
    rows = conn.execute(
        """SELECT date, sport, daily_tss, ctl, atl, tsb, ramp_rate
           FROM training_load_daily
           WHERE sport=? AND date >= ?
           ORDER BY date ASC""",
        (sport, start)
    ).fetchall()

    result = [dict(r) for r in rows]

    # Flag high ramp rate
    for row in result:
        row["warning"] = "high_ramp_rate" if (row.get("ramp_rate") or 0) > 7 else None

    # Attach contributing activities for the most recent day (for click-through)
    if result:
        last_date = result[-1]["date"]
        acts = conn.execute(
            f"""SELECT id, activity_type, name, start_time, training_stress_score
                FROM activities
                WHERE date=? {_DEDUP}
                ORDER BY start_time""",
            (last_date,)
        ).fetchall()
        result[-1]["activities"] = [dict(a) for a in acts]

    return result


@router.get("/load/{date_str}/activities")
def load_day_activities(conn: DB, date_str: str):
    """Activities contributing to a specific day's TSS — for click-through on F&F chart."""
    acts = conn.execute(
        f"""SELECT id, activity_type, name, start_time,
                   training_stress_score, distance_meters, duration_seconds
            FROM activities
            WHERE date=? {_DEDUP}
            ORDER BY start_time""",
        (date_str,)
    ).fetchall()
    return [dict(a) for a in acts]


# ─── Relative Effort band ────────────────────────────────────────────────────

@router.get("/relative-effort")
def relative_effort(
    conn: DB,
    range: int = Query(12),  # weeks
):
    """Weekly relative effort + 3-week rolling band."""
    weeks_back = range + 3  # need 3 extra weeks for band seed
    start = (date.today() - timedelta(weeks=weeks_back)).isoformat()

    _ad = _table_exists(conn, "activity_detail")
    # Use garmin_activity_load (native, always available) falling back to computed relative_effort
    _re_expr = (
        "ROUND(SUM(COALESCE(ad.garmin_activity_load, ad.relative_effort, 0)), 1)"
        if _ad else "0.0"
    )
    rows = conn.execute(
        f"""SELECT
               strftime('%Y-W%W', date) AS week,
               MIN(date) AS week_start,
               {_re_expr} AS weekly_re
            FROM activities
            {'LEFT JOIN activity_detail ad ON ad.activity_id = activities.id' if _ad else ''}
            WHERE activities.date >= ? {_DEDUP}
            GROUP BY week
            ORDER BY week ASC""",
        (start,)
    ).fetchall()

    data = [dict(r) for r in rows]

    # 3-week rolling mean ± 1 stddev band
    for i, row in enumerate(data):
        window = [data[j]["weekly_re"] for j in range(max(0, i - 2), i + 1) if data[j]["weekly_re"]]
        if len(window) >= 2:
            mean = sum(window) / len(window)
            variance = sum((x - mean) ** 2 for x in window) / len(window)
            std = math.sqrt(variance)
            row["band_low"] = round(max(0, mean - std), 1)
            row["band_high"] = round(mean + std, 1)
        else:
            row["band_low"] = None
            row["band_high"] = None

    return data[3:]  # trim the seed weeks used for band calculation


# ─── Training log (bubble calendar) ─────────────────────────────────────────

@router.get("/log")
def training_log(
    conn: DB,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    weeks: int = Query(16),
):
    """Per-day activity list for the bubble calendar."""
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(weeks=weeks)).isoformat()

    # activity_detail may not exist yet (migration pending) — fall back gracefully
    _ad_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_detail'"
    ).fetchone()
    _tss_expr = (
        "COALESCE(a.training_stress_score, ad.hr_tss, 0) AS tss"
        if _ad_exists else
        "COALESCE(a.training_stress_score, 0) AS tss"
    )
    _join = "LEFT JOIN activity_detail ad ON ad.activity_id = a.id" if _ad_exists else ""

    rows = conn.execute(
        f"""SELECT
               activities.id, activities.date, activities.activity_type, activities.start_time,
               activities.distance_meters, activities.duration_seconds,
               {'COALESCE(activities.training_stress_score, ad.hr_tss, 0) AS tss' if _ad_exists else 'COALESCE(activities.training_stress_score, 0) AS tss'}
            FROM activities
            {'LEFT JOIN activity_detail ad ON ad.activity_id = activities.id' if _ad_exists else ''}
            WHERE activities.date BETWEEN ? AND ? {_DEDUP}
            ORDER BY activities.date ASC, activities.start_time ASC""",
        (start, end)
    ).fetchall()

    # Group by date
    by_date: dict[str, list] = {}
    for r in rows:
        d = r["date"]
        if d not in by_date:
            by_date[d] = []
        by_date[d].append({
            "id": r["id"],
            "sport": r["activity_type"],
            "start_time": r["start_time"],
            "distance_m": r["distance_meters"],
            "duration_s": r["duration_seconds"],
            "tss": round(r["tss"] or 0, 1),
        })

    return [{"date": d, "activities": acts} for d, acts in sorted(by_date.items())]


# ─── Volume bars ─────────────────────────────────────────────────────────────

@router.get("/volume")
def training_volume(
    conn: DB,
    period: str = Query("week"),   # week | month
    metric: str = Query("distance"),  # distance | time | elevation | tss
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    weeks: int = Query(26),
):
    """Weekly or monthly volume bars."""
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(weeks=weeks)).isoformat()

    if period == "month":
        period_fmt = "strftime('%Y-%m', date)"
        period_col = "period_start"
    else:
        period_fmt = "MIN(date)"
        period_col = "period_start"

    metric_expr = {
        "distance": "ROUND(SUM(distance_meters) / 1000.0, 1)",
        "time": "ROUND(SUM(duration_seconds) / 3600.0, 2)",
        "elevation": "ROUND(SUM(elevation_gain_meters), 0)",
        "tss": f"ROUND(SUM({_tss_expr(conn)}), 0)",
    }.get(metric, "ROUND(SUM(distance_meters) / 1000.0, 1)")

    group_expr = "strftime('%Y-%m', date)" if period == "month" else "strftime('%Y-W%W', date)"

    rows = conn.execute(
        f"""SELECT
               MIN(date) AS period_start,
               {metric_expr} AS value
            FROM activities
            WHERE date BETWEEN ? AND ? {_DEDUP}
            GROUP BY {group_expr}
            ORDER BY MIN(date) ASC""",
        (start, end)
    ).fetchall()

    return [dict(r) for r in rows]


# ─── Progress + date-range comparison ────────────────────────────────────────

@router.get("/progress")
def training_progress(
    conn: DB,
    sport: Optional[str] = Query(None),
    metric: str = Query("distance"),  # distance | time | tss | sessions
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    compare_start: Optional[str] = Query(None),
    compare_end: Optional[str] = Query(None),
    weeks: int = Query(12),
):
    """Weekly progress with optional date-range comparison overlay."""
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(weeks=weeks)).isoformat()

    sport_clause = "AND activity_type = ?" if sport else ""
    sport_params = [sport] if sport else []

    metric_expr = {
        "distance": "ROUND(SUM(distance_meters) / 1000.0, 1)",
        "time": "ROUND(SUM(duration_seconds) / 3600.0, 2)",
        "tss": f"ROUND(SUM({_tss_expr(conn)}), 0)",
        "sessions": "COUNT(*)",
    }.get(metric, "ROUND(SUM(distance_meters) / 1000.0, 1)")

    def _fetch(s, e, extra_params):
        rows = conn.execute(
            f"""SELECT MIN(date) AS period_start, {metric_expr} AS value
                FROM activities
                WHERE date BETWEEN ? AND ? {_DEDUP} {sport_clause}
                GROUP BY strftime('%Y-W%W', date)
                ORDER BY MIN(date) ASC""",
            [s, e] + extra_params
        ).fetchall()
        return {r["period_start"]: r["value"] for r in rows}

    primary = _fetch(start, end, sport_params)

    compare = {}
    if compare_start and compare_end:
        compare = _fetch(compare_start, compare_end, sport_params)

    # Align weeks by ordinal offset
    primary_weeks = sorted(primary.keys())
    compare_weeks = sorted(compare.keys())

    result = []
    for i, week in enumerate(primary_weeks):
        compare_val = None
        if compare_weeks and i < len(compare_weeks):
            compare_val = compare.get(compare_weeks[i])
        result.append({
            "period_start": week,
            "value": primary.get(week),
            "compare_value": compare_val,
        })

    return result


# ─── Best effort curves ───────────────────────────────────────────────────────

_RUN_SPORT_TYPES = (
    "running", "trail_running", "treadmill_running", "indoor_running", "virtual_run",
    "road_running", "track_running", "ultra_run", "obstacle_run", "street_running",
)
_RIDE_SPORT_TYPES = (
    "cycling", "road_biking", "mountain_biking", "gravel_cycling", "virtual_ride",
    "indoor_cycling", "road_cycling", "bmx", "cyclocross", "track_cycling",
)

# Standard distance buckets used for fallback curve (metres)
_RUN_PACE_BUCKETS = [400, 500, 1000, 1609, 2000, 5000, 10000, 15000, 21097, 42195]
_RIDE_PACE_BUCKETS = [10000, 20000, 40000, 50000, 80000, 100000, 160000, 200000]


def _fallback_curve(conn: sqlite3.Connection, sport: str, cutoff_90d: str) -> list[dict]:
    """
    Compute a best-effort pace curve directly from activities.avg_speed_mps
    and distance_meters when the best_effort table is missing or empty.
    Returns the same shape as the best_effort table query.
    """
    if sport == "run":
        buckets = _RUN_PACE_BUCKETS
    elif sport == "ride":
        buckets = _RIDE_PACE_BUCKETS
    else:
        return []

    if sport == "run":
        type_filter = "LOWER(activity_type) LIKE '%run%' OR LOWER(activity_type) LIKE '%trail%' OR LOWER(activity_type) LIKE '%jog%'"
    else:
        type_filter = "LOWER(activity_type) LIKE '%cycl%' OR LOWER(activity_type) LIKE '%bik%' OR LOWER(activity_type) LIKE '%ride%'"

    rows = conn.execute(
        f"""SELECT date, distance_meters, duration_seconds, moving_time_seconds, avg_speed_mps
            FROM activities
            WHERE ({type_filter})
              AND distance_meters > 0
              AND (avg_speed_mps > 0 OR (duration_seconds > 0 AND distance_meters > 0))
              {_DEDUP}
            ORDER BY date ASC""",
    ).fetchall()

    # For each bucket, find the best (lowest) pace s/km from any activity >= that distance
    # We approximate: for an activity covering D metres at avg speed V, the pace for
    # any sub-distance d <= D is approximately duration/(D/1000) s/km (avg pace).
    # This is a conservative estimate (not the true sliding-window best) but correct
    # enough for a summary table.
    all_time: dict[int, float] = {}
    recent: dict[int, float] = {}

    for row in rows:
        dist = row["distance_meters"] or 0
        if dist < 400:
            continue
        speed = row["avg_speed_mps"]
        dur = row["moving_time_seconds"] or row["duration_seconds"] or 0
        if speed and speed > 0:
            pace_s_per_km = 1000.0 / speed
        elif dur > 0 and dist > 0:
            pace_s_per_km = dur / (dist / 1000.0)
        else:
            continue

        is_recent = row["date"] >= cutoff_90d

        for bucket in buckets:
            if dist >= bucket * 0.9:  # activity covered at least 90% of target distance
                if bucket not in all_time or pace_s_per_km < all_time[bucket]:
                    all_time[bucket] = pace_s_per_km
                if is_recent and (bucket not in recent or pace_s_per_km < recent[bucket]):
                    recent[bucket] = pace_s_per_km

    return [
        {
            "bucket": b,
            "all_time_best": round(all_time[b], 1) if b in all_time else None,
            "last_90d_best": round(recent[b], 1) if b in recent else None,
        }
        for b in buckets
    ]


@router.get("/curve")
def best_effort_curve(
    conn: DB,
    sport: str = Query("run"),
    channel: str = Query("pace"),  # pace | power
):
    """
    Full MMP/pace curve: all-time best and last-90d best for each bucket.
    Falls back to avg_speed_mps computation when best_effort table is missing/empty.
    """
    cutoff_90d = (date.today() - timedelta(days=90)).isoformat()

    if not _table_exists(conn, "best_effort"):
        return _fallback_curve(conn, sport, cutoff_90d)

    rows = conn.execute(
        """SELECT bucket,
                  MIN(value) AS all_time_best,
                  MIN(CASE WHEN date >= ? THEN value END) AS last_90d_best
           FROM best_effort
           WHERE sport=? AND channel=?
           GROUP BY bucket
           ORDER BY bucket ASC""",
        (cutoff_90d, sport, channel)
    ).fetchall()

    result = [dict(r) for r in rows]

    # Always prefer the avg_speed_mps fallback for pace summary tables.
    # Stream-based sliding-window values represent "fastest interval" (e.g. 400m sprint
    # start) not "best average pace for that distance" — which is what users expect here.
    if channel == "pace":
        return _fallback_curve(conn, sport, cutoff_90d)

    return result


@router.get("/best-effort")
def best_effort_progression(
    conn: DB,
    sport: str = Query("run"),
    channel: str = Query("pace"),
    bucket: int = Query(5000),  # metres for pace, seconds for power
):
    """
    Progression over time for one distance/duration bucket.
    Used for the pace/power progression chart.
    """
    rows = conn.execute(
        """SELECT be.date, be.value, be.activity_id,
                  a.name AS activity_name
           FROM best_effort be
           LEFT JOIN activities a ON a.id = be.activity_id
           WHERE be.sport=? AND be.channel=? AND be.bucket=?
           ORDER BY be.date ASC""",
        (sport, channel, bucket)
    ).fetchall()

    data = [dict(r) for r in rows]

    # Mark PRs (running min/max)
    best_so_far = None
    for row in data:
        v = row["value"]
        if v is None:
            row["is_pr"] = False
            continue
        if channel == "pace":
            is_pr = best_so_far is None or v < best_so_far
        else:
            is_pr = best_so_far is None or v > best_so_far
        if is_pr:
            best_so_far = v
        row["is_pr"] = is_pr

    return data


# ─── Race Readiness Panel ────────────────────────────────────────────────────

@router.get("/readiness")
def race_readiness(
    conn: DB,
    race_date: Optional[str] = Query(None),
):
    """
    Race readiness composite: TSB, decoupling, EF trend, VO2max, load index.
    The Horizon 1 panel — aviation + training fused.
    """
    today = date.today()
    target = date.fromisoformat(race_date) if race_date else today + timedelta(days=90)
    days_to_race = (target - today).days

    _has_load = _table_exists(conn, "training_load_daily")
    _has_detail = _table_exists(conn, "activity_detail")
    _has_physio = _table_exists(conn, "garmin_physio")
    _has_load_index = _table_exists(conn, "load_index")

    # TSB trend (combined, last 14 days)
    tsb_rows = conn.execute(
        """SELECT date, tsb, ctl, atl, ramp_rate
           FROM training_load_daily
           WHERE sport='combined' AND date >= ?
           ORDER BY date ASC""",
        ((today - timedelta(days=14)).isoformat(),)
    ).fetchall() if _has_load else []

    latest_load = dict(tsb_rows[-1]) if tsb_rows else {}
    tsb_trend_direction = None
    if len(tsb_rows) >= 7:
        tsb_values = [r["tsb"] for r in tsb_rows if r["tsb"] is not None]
        if len(tsb_values) >= 2:
            tsb_trend_direction = "improving" if tsb_values[-1] > tsb_values[0] else "declining"

    # Aerobic decoupling — last 3 long Z2 efforts
    decoupling_rows = conn.execute(
        """SELECT ad.decoupling_pct, a.date, a.name, a.duration_seconds
           FROM activity_detail ad
           JOIN activities a ON a.id = ad.activity_id
           WHERE ad.decoupling_pct IS NOT NULL
             AND a.duration_seconds >= 3600
           ORDER BY a.date DESC LIMIT 3""",
    ).fetchall() if _has_detail else []

    decoupling_recent = None
    decoupling_status = None
    if decoupling_rows:
        vals = [r["decoupling_pct"] for r in decoupling_rows if r["decoupling_pct"] is not None]
        if vals:
            decoupling_recent = round(sum(vals) / len(vals), 1)
            decoupling_status = "ready" if decoupling_recent < 5 else ("borderline" if decoupling_recent < 8 else "not_ready")

    # EF trend (last 90 days, long efforts only)
    ef_rows = conn.execute(
        """SELECT a.date, ad.efficiency_factor
           FROM activity_detail ad
           JOIN activities a ON a.id = ad.activity_id
           WHERE ad.efficiency_factor IS NOT NULL
             AND a.duration_seconds >= 3600
             AND a.date >= ?
           ORDER BY a.date ASC""",
        ((today - timedelta(days=90)).isoformat(),)
    ).fetchall() if _has_detail else []

    ef_trend = None
    ef_sparkline = [{"date": r["date"], "ef": r["efficiency_factor"]} for r in ef_rows]
    if len(ef_rows) >= 4:
        first_q = [r["efficiency_factor"] for r in ef_rows[:len(ef_rows)//4] if r["efficiency_factor"]]
        last_q = [r["efficiency_factor"] for r in ef_rows[-len(ef_rows)//4:] if r["efficiency_factor"]]
        if first_q and last_q:
            ef_trend = "improving" if sum(last_q)/len(last_q) > sum(first_q)/len(first_q) else "declining"

    # VO2max and readiness from garmin_physio
    physio = conn.execute(
        """SELECT vo2max_run, vo2max_bike, training_readiness_score, training_status
           FROM garmin_physio
           WHERE date <= ?
           ORDER BY date DESC LIMIT 1""",
        (today.isoformat(),)
    ).fetchone() if _has_physio else None

    # Load Index (aviation + training fused)
    load_index = conn.execute(
        """SELECT fatigue_score, hrv_load, sleep_debt, tss_load,
                  timezone_penalty, duty_load, recovery_status
           FROM load_index
           WHERE date = ?""",
        (today.isoformat(),)
    ).fetchone() if _has_load_index else None

    # Ironman distance progress — longest recent efforts (90 days)
    cutoff_90d = (today - timedelta(days=90)).isoformat()

    longest_recent_ride = conn.execute(
        f"""SELECT MAX(distance_meters) AS max_dist
            FROM activities
            WHERE activity_type IN ('cycling','road_biking','mountain_biking','gravel_cycling')
              AND date >= ? {_DEDUP}""",
        (cutoff_90d,)
    ).fetchone()

    longest_recent_run = conn.execute(
        f"""SELECT MAX(distance_meters) AS max_dist
            FROM activities
            WHERE activity_type IN ('running','trail_running')
              AND date >= ? {_DEDUP}""",
        (cutoff_90d,)
    ).fetchone()

    recent_swim_km = conn.execute(
        f"""SELECT ROUND(SUM(distance_meters) / 1000.0, 1) AS total_km
            FROM activities
            WHERE activity_type IN ('lap_swimming','open_water_swimming','swimming')
              AND date >= ? {_DEDUP}""",
        ((today - timedelta(days=30)).isoformat(),)
    ).fetchone()

    # Training phase based on days to race
    if days_to_race > 365:
        phase = "base"
        phase_advice = "Base building: focus on aerobic volume, long slow efforts, and consistency across all three disciplines."
    elif days_to_race > 180:
        phase = "build"
        phase_advice = "Build phase: increase sport-specific volume, add tempo and threshold work, introduce brick sessions."
    elif days_to_race > 84:
        phase = "peak"
        phase_advice = "Peak phase: race-pace training, long bricks, and your longest long rides and runs."
    elif days_to_race > 21:
        phase = "race_prep"
        phase_advice = "Race prep: reduce volume 15–20%, maintain intensity, test race gear and nutrition."
    else:
        phase = "taper"
        phase_advice = "Taper: cut volume by 40–50%, keep 1–2 quality sessions per week, stay sharp."

    # Flags
    flags = []
    if latest_load.get("ramp_rate", 0) and latest_load["ramp_rate"] > 7:
        flags.append({"code": "high_ramp_rate", "msg": f"Weekly CTL ramp {latest_load['ramp_rate']:.1f} pts — injury risk zone"})
    if decoupling_status == "not_ready":
        flags.append({"code": "poor_decoupling", "msg": f"Aerobic decoupling {decoupling_recent}% — durability not yet established"})
    if load_index and load_index["fatigue_score"] and load_index["fatigue_score"] > 66:
        flags.append({"code": "high_fatigue", "msg": f"Load Index {load_index['fatigue_score']} — accumulating fatigue"})

    # Taper window start (3 weeks before race)
    taper_start = (target - timedelta(weeks=3)).isoformat() if days_to_race > 21 else None

    return {
        "race_date": target.isoformat(),
        "days_to_race": days_to_race,
        "taper_window_start": taper_start,
        "tsb": latest_load.get("tsb"),
        "ctl": latest_load.get("ctl"),
        "atl": latest_load.get("atl"),
        "tsb_trend": tsb_trend_direction,
        "ramp_rate": latest_load.get("ramp_rate"),
        "decoupling_recent_pct": decoupling_recent,
        "decoupling_status": decoupling_status,
        "decoupling_efforts": [dict(r) for r in decoupling_rows],
        "ef_trend": ef_trend,
        "ef_sparkline": ef_sparkline,
        "vo2max_run": dict(physio)["vo2max_run"] if physio else None,
        "vo2max_bike": dict(physio)["vo2max_bike"] if physio else None,
        "training_readiness": dict(physio)["training_readiness_score"] if physio else None,
        "garmin_training_status": dict(physio)["training_status"] if physio else None,
        "load_index": dict(load_index) if load_index else None,
        "flags": flags,
        "longest_recent_ride_m": longest_recent_ride["max_dist"] if longest_recent_ride else None,
        "longest_recent_run_m": longest_recent_run["max_dist"] if longest_recent_run else None,
        "recent_swim_km_30d": recent_swim_km["total_km"] if recent_swim_km else None,
        "training_phase": phase,
        "training_phase_advice": phase_advice,
    }


# ─── Goals ───────────────────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    sport: Optional[str] = None
    metric: str  # distance | time | tss | sessions
    period: str  # week | month | year
    target: float
    period_start: Optional[str] = None


@router.get("/goals")
def list_goals(conn: DB):
    rows = conn.execute(
        "SELECT * FROM training_goal ORDER BY created_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/goals", status_code=201)
def create_goal(goal: GoalCreate, conn: DB):
    cur = conn.execute(
        """INSERT INTO training_goal (sport, metric, period, target, period_start)
           VALUES (?, ?, ?, ?, ?)""",
        (goal.sport, goal.metric, goal.period, goal.target,
         goal.period_start or date.today().isoformat())
    )
    conn.commit()
    return {"id": cur.lastrowid, **goal.model_dump()}


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, conn: DB):
    conn.execute("DELETE FROM training_goal WHERE id=?", (goal_id,))
    conn.commit()


@router.get("/goals/progress")
def goals_progress(conn: DB):
    """Return each goal with current-period actual value and progress percentage."""
    if not _table_exists(conn, "training_goal"):
        return []

    goals = conn.execute("SELECT * FROM training_goal ORDER BY created_at DESC").fetchall()
    today = date.today()
    results = []

    for g in goals:
        g = dict(g)
        period = g.get("period", "week")
        if period == "week":
            start = (today - timedelta(days=today.weekday())).isoformat()
        elif period == "month":
            start = today.replace(day=1).isoformat()
        else:
            start = today.replace(month=1, day=1).isoformat()
        end = today.isoformat()

        sport = g.get("sport")
        metric = g.get("metric", "distance")

        # Build sport filter
        if sport == "run":
            sport_types = _RUN_TYPES
        elif sport == "ride":
            sport_types = _RIDE_TYPES
        elif sport == "swim":
            sport_types = _SWIM_TYPES
        else:
            sport_types = None

        sport_clause = ""
        sport_params: list = []
        if sport_types:
            placeholders = ",".join("?" for _ in sport_types)
            sport_clause = f"AND activity_type IN ({placeholders})"
            sport_params = list(sport_types)

        if metric == "distance":
            row = conn.execute(
                f"SELECT ROUND(SUM(distance_meters)/1000.0, 1) AS val FROM activities WHERE date BETWEEN ? AND ? {sport_clause} {_DEDUP}",
                [start, end] + sport_params,
            ).fetchone()
            actual = float(row["val"] or 0)
            unit = "km"
        elif metric == "time":
            row = conn.execute(
                f"SELECT ROUND(SUM(COALESCE(moving_time_seconds, duration_seconds, 0))/3600.0, 1) AS val FROM activities WHERE date BETWEEN ? AND ? {sport_clause} {_DEDUP}",
                [start, end] + sport_params,
            ).fetchone()
            actual = float(row["val"] or 0)
            unit = "h"
        elif metric == "tss":
            tss_expr = _tss_expr(conn)
            row = conn.execute(
                f"SELECT ROUND(SUM({tss_expr}), 0) AS val FROM activities WHERE date BETWEEN ? AND ? {sport_clause} {_DEDUP}",
                [start, end] + sport_params,
            ).fetchone()
            actual = float(row["val"] or 0)
            unit = "TSS"
        else:  # sessions
            row = conn.execute(
                f"SELECT COUNT(*) AS val FROM activities WHERE date BETWEEN ? AND ? {sport_clause} {_DEDUP}",
                [start, end] + sport_params,
            ).fetchone()
            actual = float(row["val"] or 0)
            unit = "sessions"

        target = float(g.get("target") or 0)
        pct = min(100, round(actual / target * 100)) if target > 0 else 0
        results.append({**g, "actual": actual, "pct": pct, "unit": unit, "period_start": start, "period_end": end})

    return results


# ─── Year in Sport ────────────────────────────────────────────────────────────

@router.get("/year-in-sport/{year}")
def year_in_sport(conn: DB, year: int):
    """Annual recap: totals, PRs, CTL peak, biggest week, EF improvement."""
    start = f"{year}-01-01"
    end = f"{year}-12-31"

    # Per-sport totals
    sport_rows = conn.execute(
        f"""SELECT
               COALESCE(activity_type, 'other') AS sport,
               COUNT(*) AS sessions,
               ROUND(SUM(distance_meters)/1000.0, 1) AS total_km,
               ROUND(SUM(duration_seconds)/3600.0, 1) AS total_hours,
               ROUND(SUM(elevation_gain_meters), 0) AS total_elevation_m
            FROM activities
            WHERE date BETWEEN ? AND ? {_DEDUP}
            GROUP BY sport ORDER BY total_km DESC""",
        (start, end)
    ).fetchall()

    # CTL peak
    ctl_peak_row = conn.execute(
        """SELECT MAX(ctl) AS ctl_peak, date AS ctl_peak_date
           FROM training_load_daily WHERE sport='combined' AND date BETWEEN ? AND ?""",
        (start, end)
    ).fetchone()

    # Biggest week by TSS
    biggest_week_row = conn.execute(
        f"""SELECT MIN(date) AS week_start,
                   ROUND(SUM({_tss_expr(conn)}), 0) AS weekly_tss
            FROM activities
            WHERE date BETWEEN ? AND ? {_DEDUP}
            GROUP BY strftime('%Y-W%W', date)
            ORDER BY weekly_tss DESC LIMIT 1""",
        (start, end)
    ).fetchone()

    # Longest single session
    longest_row = conn.execute(
        f"""SELECT id, name, date, duration_seconds, activity_type
            FROM activities
            WHERE date BETWEEN ? AND ? {_DEDUP}
            ORDER BY duration_seconds DESC LIMIT 1""",
        (start, end)
    ).fetchone()

    # Best efforts PRs set this year
    pr_rows = conn.execute(
        """SELECT be.sport, be.channel, be.bucket, MIN(be.value) AS best_value,
                  be.date, a.name AS activity_name
           FROM best_effort be
           JOIN activities a ON a.id = be.activity_id
           WHERE be.date BETWEEN ? AND ?
           GROUP BY be.sport, be.channel, be.bucket
           ORDER BY be.sport, be.channel, be.bucket""",
        (start, end)
    ).fetchall()

    # EF improvement (first month vs last month of year)
    ef_q1_row = conn.execute(
        """SELECT AVG(ad.efficiency_factor) AS avg_ef
           FROM activity_detail ad JOIN activities a ON a.id = ad.activity_id
           WHERE a.date BETWEEN ? AND ?
             AND ad.efficiency_factor IS NOT NULL AND a.duration_seconds >= 3600""",
        (start, f"{year}-03-31")
    ).fetchone()
    ef_q4_row = conn.execute(
        """SELECT AVG(ad.efficiency_factor) AS avg_ef
           FROM activity_detail ad JOIN activities a ON a.id = ad.activity_id
           WHERE a.date BETWEEN ? AND ?
             AND ad.efficiency_factor IS NOT NULL AND a.duration_seconds >= 3600""",
        (f"{year}-10-01", end)
    ).fetchone()

    ef_improvement = None
    if ef_q1_row and ef_q4_row and ef_q1_row["avg_ef"] and ef_q4_row["avg_ef"] and ef_q1_row["avg_ef"] > 0:
        ef_improvement = round(
            (ef_q4_row["avg_ef"] - ef_q1_row["avg_ef"]) / ef_q1_row["avg_ef"] * 100, 1
        )

    return {
        "year": year,
        "sports": [dict(r) for r in sport_rows],
        "ctl_peak": dict(ctl_peak_row) if ctl_peak_row and ctl_peak_row["ctl_peak"] else None,
        "biggest_week": dict(biggest_week_row) if biggest_week_row and biggest_week_row["weekly_tss"] else None,
        "longest_session": dict(longest_row) if longest_row else None,
        "best_efforts": [dict(r) for r in pr_rows],
        "ef_improvement_pct": ef_improvement,
        "ef_q1_avg": round(ef_q1_row["avg_ef"], 3) if ef_q1_row and ef_q1_row["avg_ef"] else None,
        "ef_q4_avg": round(ef_q4_row["avg_ef"], 3) if ef_q4_row and ef_q4_row["avg_ef"] else None,
    }


# ─── Activity Heatmap ─────────────────────────────────────────────────────────

_INDOOR_TYPES = (
    "indoor_cycling", "virtual_ride", "virtual_run", "lap_swimming",
    "treadmill_running", "indoor_running", "strength_training",
    "fitness_equipment", "yoga", "pilates",
)

_RIDE_TYPES = ("cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling")
_RUN_TYPES = ("running", "trail_running", "treadmill_running", "indoor_running", "virtual_run")
_SWIM_TYPES = ("lap_swimming", "open_water_swimming", "swimming")


# ─── Route Polylines (multi-sport overlay map) ────────────────────────────────

@router.get("/polylines")
def activity_polylines(
    conn: DB,
    sports: str = Query("run,ride"),
    days: int = Query(365),
    limit: int = Query(200),
    metric: str = Query("none"),  # none | pace | elevation | hr
):
    """
    Return decoded polylines grouped by sport for the route overlay map.
    metric_value: pace in s/km, elevation_gain_meters, or avg_heart_rate.
    """
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    sport_list = [s.strip() for s in sports.split(",") if s.strip()]

    result: dict[str, list] = {}

    for sport_key in sport_list:
        if sport_key == "run":
            types = _RUN_TYPES
        elif sport_key == "ride":
            types = _RIDE_TYPES
        elif sport_key == "swim":
            types = _SWIM_TYPES
        else:
            continue

        placeholders = ",".join("?" for _ in types)
        rows = conn.execute(
            f"""SELECT id, name, date, polyline,
                       avg_speed_mps, elevation_gain_meters, avg_heart_rate,
                       distance_meters
                FROM activities
                WHERE date BETWEEN ? AND ?
                  AND polyline IS NOT NULL AND polyline != ''
                  AND activity_type IN ({placeholders})
                  {_DEDUP}
                ORDER BY date DESC
                LIMIT ?""",
            [start, end] + list(types) + [limit],
        ).fetchall()

        routes = []
        for row in rows:
            try:
                coords = _polyline_lib.decode(row["polyline"])
            except Exception:
                continue
            if not coords:
                continue

            # Compute metric_value
            if metric == "pace":
                spd = row["avg_speed_mps"]
                metric_value = round(1000 / spd, 1) if spd and spd > 0 else None
            elif metric == "elevation":
                metric_value = row["elevation_gain_meters"]
            elif metric == "hr":
                metric_value = row["avg_heart_rate"]
            else:
                metric_value = None

            routes.append({
                "id": row["id"],
                "name": row["name"] or sport_key,
                "date": row["date"],
                "distance_km": round(row["distance_meters"] / 1000, 1) if row["distance_meters"] else None,
                "coords": coords,
                "metric_value": metric_value,
            })

        result[sport_key] = routes

    return result


@router.get("/heatmap")
def activity_heatmap(
    conn: DB,
    sport: str = Query("all"),
    days: int = Query(365),
    sample_every: int = Query(5),
):
    """
    Decode stored activity polylines → return [[lat, lng, weight]] for the
    Leaflet heatmap. sport=all excludes indoor-only activities.
    """
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    if sport == "all":
        placeholders = ",".join("?" for _ in _INDOOR_TYPES)
        sport_clause = f"AND activity_type NOT IN ({placeholders})"
        sport_params: list = list(_INDOOR_TYPES)
    elif sport == "run":
        placeholders = ",".join("?" for _ in _RUN_TYPES)
        sport_clause = f"AND activity_type IN ({placeholders})"
        sport_params = list(_RUN_TYPES)
    elif sport == "ride":
        placeholders = ",".join("?" for _ in _RIDE_TYPES)
        sport_clause = f"AND activity_type IN ({placeholders})"
        sport_params = list(_RIDE_TYPES)
    elif sport == "swim":
        placeholders = ",".join("?" for _ in _SWIM_TYPES)
        sport_clause = f"AND activity_type IN ({placeholders})"
        sport_params = list(_SWIM_TYPES)
    else:
        sport_clause = "AND activity_type = ?"
        sport_params = [sport]

    rows = conn.execute(
        f"""SELECT polyline FROM activities
            WHERE date BETWEEN ? AND ?
              AND polyline IS NOT NULL AND polyline != ''
              {sport_clause}
              {_DEDUP}""",
        [start, end] + sport_params,
    ).fetchall()

    points: list[list[float]] = []
    for row in rows:
        try:
            decoded = _polyline_lib.decode(row["polyline"])
            for lat, lng in decoded[::sample_every]:
                points.append([lat, lng, 1.0])
        except Exception:
            continue

    return {"points": points, "count": len(rows)}


# ─── All-time Records ─────────────────────────────────────────────────────────

@router.get("/records")
def activity_records(conn: DB):
    """All-time activity records: longest ride/run, highest elevation ride."""

    def _q(order_col: str, type_filter: tuple[str, ...]) -> dict | None:
        placeholders = ",".join("?" for _ in type_filter)
        row = conn.execute(
            f"""SELECT id, date, name, activity_type,
                       distance_meters, duration_seconds, elevation_gain_meters
                FROM activities
                WHERE activity_type IN ({placeholders}) {_DEDUP}
                ORDER BY {order_col} DESC LIMIT 1""",
            list(type_filter),
        ).fetchone()
        return dict(row) if row else None

    return {
        "longest_ride": _q("distance_meters", _RIDE_TYPES),
        "longest_run": _q("distance_meters", _RUN_TYPES),
        "highest_elevation_ride": _q("elevation_gain_meters", _RIDE_TYPES),
    }
