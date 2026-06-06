"""
Training dashboard API — weekly load, sport breakdown, PRs, activity list.
"""

import sqlite3
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from infrastructure.db.connection import get_connection

router = APIRouter(prefix="/training", tags=["training"])

DB = Annotated[sqlite3.Connection, Depends(get_connection)]

# Strava-only duplicates excluded (same logic as days router)
_DEDUP = """
    AND NOT (source='strava' AND EXISTS (
      SELECT 1 FROM activities g
      WHERE g.date = activities.date
        AND g.source = 'garmin'
        AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
    ))
"""


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
            ROUND(SUM(COALESCE(training_stress_score, 0)), 0) AS tss
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
            ROUND(SUM(duration_seconds) / 3600.0, 1)   AS hours,
            ROUND(SUM(elevation_gain_meters), 0)        AS elevation_m,
            ROUND(AVG(avg_heart_rate), 0)               AS avg_hr
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY sport
        ORDER BY km DESC
        """,
        (start, end),
    ).fetchall()

    return [dict(r) for r in rows]


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

    row = conn.execute(
        f"""
        SELECT
            COUNT(*)                                    AS activity_count,
            ROUND(SUM(distance_meters) / 1000.0, 1)    AS total_km,
            ROUND(SUM(duration_seconds) / 3600.0, 1)   AS total_hours,
            ROUND(SUM(elevation_gain_meters), 0)        AS total_elevation_m,
            ROUND(AVG(avg_heart_rate), 0)               AS avg_hr,
            ROUND(SUM(COALESCE(training_stress_score, 0)), 0) AS total_tss
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

    clauses = ["date BETWEEN ? AND ?", _DEDUP.strip().lstrip("AND ")]
    params: list = [start, end]

    if sport:
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
