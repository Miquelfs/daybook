"""
Health dashboard API — trends for HRV, sleep, resting HR, body battery, stress.
All endpoints accept ?start=YYYY-MM-DD&end=YYYY-MM-DD for filtering.
"""

import sqlite3
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from infrastructure.db.connection import get_connection
from infrastructure.api.utils.stats import pearson

router = APIRouter(prefix="/health", tags=["health"])

DB = Annotated[sqlite3.Connection, Depends(get_connection)]


def _default_range() -> tuple[str, str]:
    end = date.today()
    start = end - timedelta(days=29)
    return start.isoformat(), end.isoformat()


@router.get("/trends")
def health_trends(
    conn: DB,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    """Daily health metrics for charting. Returns one row per day."""
    if not start or not end:
        start, end = _default_range()

    rows = conn.execute(
        """
        SELECT
            d.date,
            h.last_night_avg   AS hrv,
            h.weekly_avg       AS hrv_weekly,
            h.status           AS hrv_status,
            s.duration_seconds AS sleep_seconds,
            s.deep_seconds,
            s.rem_seconds,
            s.light_seconds,
            s.awake_seconds,
            s.score            AS sleep_score,
            ds.resting_hr,
            ds.stress_avg,
            ds.body_battery_low,
            ds.body_battery_high,
            ds.steps,
            ds.active_calories,
            dy.energy,
            dy.mood,
            dy.sleep_quality
        FROM (
            SELECT DISTINCT date FROM (
                SELECT date FROM hrv WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM sleep WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM daily_stats WHERE date BETWEEN ? AND ?
            )
        ) d
        LEFT JOIN hrv         h  ON h.date  = d.date
        LEFT JOIN sleep       s  ON s.date  = d.date
        LEFT JOIN daily_stats ds ON ds.date = d.date
        LEFT JOIN days        dy ON dy.date = d.date
        ORDER BY d.date
        """,
        (start, end, start, end, start, end),
    ).fetchall()

    return [dict(r) for r in rows]


@router.get("/summary")
def health_summary(conn: DB, days: int = Query(30)):
    """Aggregated summary stats for KPI cards."""
    end = date.today()
    start = end - timedelta(days=days - 1)

    row = conn.execute(
        """
        SELECT
            ROUND(AVG(h.last_night_avg), 1)      AS avg_hrv,
            ROUND(AVG(ds.resting_hr), 1)         AS avg_resting_hr,
            ROUND(AVG(s.duration_seconds), 0)    AS avg_sleep_seconds,
            ROUND(AVG(s.score), 1)               AS avg_sleep_score,
            ROUND(AVG(ds.stress_avg), 1)         AS avg_stress,
            ROUND(AVG(ds.body_battery_high), 1)  AS avg_battery_high,
            ROUND(AVG(ds.steps), 0)              AS avg_steps,
            MAX(h.last_night_avg)                AS max_hrv,
            MIN(h.last_night_avg)                AS min_hrv,
            COUNT(DISTINCT h.date)               AS hrv_days
        FROM days dy
        LEFT JOIN hrv         h  ON h.date  = dy.date
        LEFT JOIN sleep       s  ON s.date  = dy.date
        LEFT JOIN daily_stats ds ON ds.date = dy.date
        WHERE dy.date BETWEEN ? AND ?
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchone()

    # HRV trend direction (compare last 7 days vs previous 7)
    week_end = end
    week_start = end - timedelta(days=6)
    prev_end = week_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=6)

    recent_hrv = conn.execute(
        "SELECT AVG(last_night_avg) FROM hrv WHERE date BETWEEN ? AND ?",
        (week_start.isoformat(), week_end.isoformat()),
    ).fetchone()[0]

    prev_hrv = conn.execute(
        "SELECT AVG(last_night_avg) FROM hrv WHERE date BETWEEN ? AND ?",
        (prev_start.isoformat(), prev_end.isoformat()),
    ).fetchone()[0]

    hrv_trend = None
    if recent_hrv and prev_hrv:
        hrv_trend = round(recent_hrv - prev_hrv, 1)

    return {**dict(row), "hrv_trend_7d": hrv_trend, "period_days": days}


@router.get("/correlation")
def health_correlation(conn: DB, days: int = Query(90)):
    """
    HRV vs pace and sleep quality vs pace correlation for recent running activities.
    Returns scatter points + Pearson r for each pair.
    """
    end = date.today()
    start = end - timedelta(days=days)

    rows = conn.execute(
        """
        SELECT
            a.date,
            a.avg_speed_mps,
            a.distance_meters,
            a.moving_time_seconds,
            h.last_night_avg   AS hrv,
            s.score            AS sleep_score,
            s.duration_seconds AS sleep_seconds
        FROM activities a
        LEFT JOIN hrv  h ON h.date = a.date
        LEFT JOIN sleep s ON s.date = a.date
        WHERE a.date BETWEEN ? AND ?
          AND a.activity_type IN ('running', 'trail_running', 'treadmill_running', 'track_running')
          AND a.avg_speed_mps > 0
          AND a.distance_meters >= 3000
        ORDER BY a.date
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()

    # pace in sec/km (lower = faster)
    points = []
    for r in rows:
        pace = 1000 / r["avg_speed_mps"] if r["avg_speed_mps"] else None
        if pace is None:
            continue
        points.append({
            "date": r["date"],
            "pace_sec_km": round(pace),
            "hrv": r["hrv"],
            "sleep_score": r["sleep_score"],
            "sleep_seconds": r["sleep_seconds"],
            "distance_km": round((r["distance_meters"] or 0) / 1000, 1),
        })

    hrv_pairs = [(p["hrv"], p["pace_sec_km"]) for p in points if p["hrv"] is not None]
    sleep_pairs = [(p["sleep_score"], p["pace_sec_km"]) for p in points if p["sleep_score"] is not None]

    return {
        "points": points,
        "correlation": {
            "hrv_vs_pace": pearson([x for x, _ in hrv_pairs], [y for _, y in hrv_pairs]),
            "sleep_vs_pace": pearson([x for x, _ in sleep_pairs], [y for _, y in sleep_pairs]),
        },
        "sample_size": len(points),
    }
