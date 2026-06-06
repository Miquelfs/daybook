"""
Stats API — Strava Premium replacement endpoints.
Volume, best efforts, year calendar, relative effort, heatmap, fitness curve.
"""

import math
import sqlite3
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from infrastructure.db.connection import get_connection
from domains.health.insights.best_efforts import (
    _ensure_table, get_prs, TARGETS,
    compute_for_activity, RUNNING_TYPES,
)

router = APIRouter(prefix="/stats", tags=["stats"])
DB = Annotated[sqlite3.Connection, Depends(get_connection)]

_DEDUP = """
    AND NOT (source='strava' AND EXISTS (
      SELECT 1 FROM activities g
      WHERE g.date = activities.date
        AND g.source = 'garmin'
        AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
    ))
"""


# ── Volume ────────────────────────────────────────────────────────────────────

@router.get("/volume")
def volume(
    conn: DB,
    metric: str = Query("distance", enum=["distance", "time", "elevation"]),
    grouping: str = Query("weekly", enum=["weekly", "monthly"]),
    periods: int = Query(52),
    activity_type: Optional[str] = Query(None),
):
    """
    Activity volume bucketed by week or month.
    Returns all three metrics per period so frontend toggle needs no refetch.
    """
    end_d = date.today()
    if grouping == "weekly":
        start_d = end_d - timedelta(weeks=periods)
        bucket = "strftime('%Y-W%W', date)"
        label_fmt = "strftime('%d %b', MIN(date))"
    else:
        start_d = end_d - timedelta(days=periods * 30)
        bucket = "strftime('%Y-%m', date)"
        label_fmt = "strftime('%b %Y', MIN(date))"

    type_clause = ""
    params: list = [start_d.isoformat(), end_d.isoformat()]
    if activity_type:
        type_clause = "AND activity_type = ?"
        params.append(activity_type)

    rows = conn.execute(
        f"""
        SELECT
            {bucket}                                        AS period,
            MIN(date)                                       AS period_start,
            {label_fmt}                                     AS period_label,
            ROUND(SUM(COALESCE(distance_meters, 0)) / 1000.0, 1)   AS distance_km,
            ROUND(SUM(COALESCE(moving_time_seconds, duration_seconds, 0)), 0) AS moving_time_seconds,
            ROUND(SUM(COALESCE(elevation_gain_meters, 0)), 0)       AS elevation_gain_meters,
            COUNT(*)                                        AS activity_count
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
          {type_clause}
        GROUP BY period
        ORDER BY period
        """,
        params,
    ).fetchall()

    return [dict(r) for r in rows]


# ── Best Efforts ──────────────────────────────────────────────────────────────

@router.get("/best-efforts")
def best_efforts(
    conn: DB,
    activity_type: str = Query("running"),
    year: Optional[int] = Query(None),
):
    """All-time or per-year PRs across standard distances."""
    _ensure_table(conn)
    prs = get_prs(conn, year=year)

    # Enrich with activity name
    enriched = []
    for pr in prs:
        act = conn.execute(
            "SELECT name, activity_type FROM activities WHERE id = ?",
            (pr["activity_id"],)
        ).fetchone()
        enriched.append({
            **pr,
            "activity_name": act["name"] if act else None,
            "activity_type": act["activity_type"] if act else None,
        })

    return enriched


@router.post("/best-efforts/compute")
def compute_best_efforts(conn: DB, force: bool = Query(False)):
    """Trigger best efforts computation for all unprocessed running activities."""
    _ensure_table(conn)

    if force:
        rows = conn.execute(
            "SELECT id, date FROM activities WHERE activity_type IN ({})".format(
                ",".join("?" * len(RUNNING_TYPES))
            ),
            list(RUNNING_TYPES)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT a.id, a.date FROM activities a
               LEFT JOIN best_efforts be ON be.activity_id = a.id
               WHERE a.activity_type IN ({})
                 AND be.id IS NULL
                 AND EXISTS (SELECT 1 FROM activity_streams s WHERE s.activity_id = a.id AND s.stream_type = 'distance')
            """.format(",".join("?" * len(RUNNING_TYPES))),
            list(RUNNING_TYPES)
        ).fetchall()

    total = 0
    for r in rows:
        total += compute_for_activity(conn, r["id"], r["date"])

    return {"computed": len(rows), "efforts_stored": total}


# ── Year calendar ─────────────────────────────────────────────────────────────

@router.get("/year/{year}")
def year_stats(conn: DB, year: int):
    """Full year summary: totals, 52-week sparkline, 12-month grid."""
    _ensure_table(conn)

    start = f"{year}-01-01"
    end = f"{year}-12-31"

    # Totals
    totals_row = conn.execute(
        f"""
        SELECT
            ROUND(SUM(COALESCE(moving_time_seconds, duration_seconds, 0)) / 3600.0, 1) AS hours,
            ROUND(SUM(COALESCE(distance_meters, 0)) / 1000.0, 1)                        AS km,
            COUNT(*)                                                                     AS activities
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        """,
        (start, end),
    ).fetchone()

    pr_count = conn.execute(
        """
        SELECT COUNT(DISTINCT target_label) FROM best_efforts
        WHERE date BETWEEN ? AND ?
          AND duration_seconds = (
              SELECT MIN(b2.duration_seconds) FROM best_efforts b2
              WHERE b2.target_label = best_efforts.target_label
          )
        """,
        (start, end),
    ).fetchone()[0]

    totals = {
        "hours": totals_row["hours"] or 0,
        "km": totals_row["km"] or 0,
        "activities": totals_row["activities"] or 0,
        "personal_records": pr_count or 0,
    }

    # Weekly sparkline (52 buckets)
    weeks = conn.execute(
        f"""
        SELECT
            strftime('%Y-W%W', date) AS week,
            MIN(date)                AS week_start,
            ROUND(SUM(COALESCE(distance_meters, 0)) / 1000.0, 1) AS km
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY week
        ORDER BY week
        """,
        (start, end),
    ).fetchall()

    # Monthly grid
    months = []
    for m in range(1, 13):
        month_start = f"{year}-{m:02d}-01"
        # last day of month
        if m == 12:
            month_end = f"{year}-12-31"
        else:
            month_end = (date(year, m + 1, 1) - timedelta(days=1)).isoformat()

        month_row = conn.execute(
            f"""
            SELECT
                ROUND(SUM(COALESCE(moving_time_seconds, duration_seconds, 0)) / 3600.0, 1) AS hours,
                COUNT(*) AS activities
            FROM activities
            WHERE date BETWEEN ? AND ?
              {_DEDUP}
            """,
            (month_start, month_end),
        ).fetchone()

        daily = conn.execute(
            f"""
            SELECT date,
                   ROUND(SUM(COALESCE(distance_meters, 0)) / 1000.0, 1) AS km
            FROM activities
            WHERE date BETWEEN ? AND ?
              {_DEDUP}
            GROUP BY date
            ORDER BY date
            """,
            (month_start, month_end),
        ).fetchall()

        months.append({
            "month": m,
            "month_name": date(year, m, 1).strftime("%b"),
            "hours": month_row["hours"] or 0,
            "activities": month_row["activities"] or 0,
            "daily_values": [{"date": r["date"], "km": r["km"]} for r in daily],
        })

    return {
        "year": year,
        "totals": totals,
        "weeks": [dict(w) for w in weeks],
        "months": months,
    }


# ── Relative effort ───────────────────────────────────────────────────────────

@router.get("/relative-effort")
def relative_effort(conn: DB, weeks: int = Query(6)):
    """
    Per-week training stress totals + trend verdict.
    Uses TSS if available, falls back to duration-based proxy (hrTSS approximation).
    """
    end_d = date.today()
    start_d = end_d - timedelta(weeks=weeks)

    rows = conn.execute(
        f"""
        SELECT
            strftime('%Y-W%W', date) AS week,
            MIN(date)                AS week_start,
            ROUND(SUM(
                COALESCE(
                    training_stress_score,
                    -- duration-based proxy: (minutes * avg_hr / LTHR)^2 / 3600 * 100
                    CASE WHEN avg_heart_rate > 0
                    THEN ROUND((COALESCE(moving_time_seconds, duration_seconds, 0) / 60.0) *
                               POWER(avg_heart_rate / 155.0, 2) / 60.0, 1)
                    ELSE ROUND(COALESCE(moving_time_seconds, duration_seconds, 0) / 3600.0 * 40, 1)
                    END
                )
            ), 1) AS load,
            COUNT(*) AS activity_count
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY week
        ORDER BY week
        """,
        (start_d.isoformat(), end_d.isoformat()),
    ).fetchall()

    result = [dict(r) for r in rows]

    # Compute verdict
    verdict = "no data"
    if len(result) >= 2:
        recent = result[-1]["load"] or 0
        prior = [r["load"] or 0 for r in result[:-1]]
        avg_prior = sum(prior) / len(prior) if prior else 0
        if avg_prior == 0:
            verdict = "starting out"
        elif recent == 0:
            verdict = "detraining"
        elif recent > avg_prior * 1.15:
            verdict = "trending higher"
        elif recent < avg_prior * 0.85:
            verdict = "trending lower"
        else:
            verdict = "steady"

    return {"weeks": result, "verdict": verdict}


# ── Calendar heatmap ──────────────────────────────────────────────────────────

@router.get("/calendar-heatmap")
def calendar_heatmap(
    conn: DB,
    year: int = Query(default=0),
    metric: str = Query("distance", enum=["distance", "time", "activities"]),
):
    if not year:
        year = date.today().year
    start = f"{year}-01-01"
    end = f"{year}-12-31"

    if metric == "distance":
        value_expr = "ROUND(SUM(COALESCE(distance_meters, 0)) / 1000.0, 1)"
        unit = "km"
    elif metric == "time":
        value_expr = "ROUND(SUM(COALESCE(moving_time_seconds, duration_seconds, 0)) / 3600.0, 2)"
        unit = "h"
    else:
        value_expr = "COUNT(*)"
        unit = "activities"

    rows = conn.execute(
        f"""
        SELECT date, {value_expr} AS value
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY date
        ORDER BY date
        """,
        (start, end),
    ).fetchall()

    return {
        "year": year,
        "metric": metric,
        "unit": unit,
        "days": [dict(r) for r in rows],
    }


# ── Fitness curve (CTL / ATL / TSB) ──────────────────────────────────────────

@router.get("/fitness-curve")
def fitness_curve(conn: DB, days: int = Query(180)):
    """
    Chronic Training Load (CTL, 42-day EWA), Acute Training Load (ATL, 7-day EWA),
    and Training Stress Balance (TSB = CTL − ATL) for the last N days.
    Seeds from full history so values are accurate even on first call.
    """
    today = date.today()
    seed_start = date(2020, 1, 1)  # seed from history
    output_start = today - timedelta(days=days)

    # Fetch all daily TSS from full history
    rows = conn.execute(
        f"""
        SELECT date,
               SUM(COALESCE(
                   training_stress_score,
                   CASE WHEN avg_heart_rate > 0
                   THEN ROUND((COALESCE(moving_time_seconds, duration_seconds, 0) / 60.0) *
                              POWER(avg_heart_rate / 155.0, 2) / 60.0, 1)
                   ELSE ROUND(COALESCE(moving_time_seconds, duration_seconds, 0) / 3600.0 * 40, 1)
                   END
               )) AS tss
        FROM activities
        WHERE date BETWEEN ? AND ?
          {_DEDUP}
        GROUP BY date
        ORDER BY date
        """,
        (seed_start.isoformat(), today.isoformat()),
    ).fetchall()

    tss_by_date: dict[str, float] = {r["date"]: (r["tss"] or 0) for r in rows}

    k_ctl = 2 / (42 + 1)
    k_atl = 2 / (7 + 1)
    ctl = 0.0
    atl = 0.0

    result = []
    current = seed_start
    while current <= today:
        ds = current.isoformat()
        tss = tss_by_date.get(ds, 0)
        ctl = ctl + k_ctl * (tss - ctl)
        atl = atl + k_atl * (tss - atl)
        tsb = ctl - atl
        if current >= output_start:
            result.append({
                "date": ds,
                "ctl": round(ctl, 1),
                "atl": round(atl, 1),
                "tsb": round(tsb, 1),
                "tss": round(tss, 1),
            })
        current += timedelta(days=1)

    return {"days": result}


# ── Performance trend ─────────────────────────────────────────────────────────

@router.get("/performance-trend")
def performance_trend(
    conn: DB,
    distance_label: str = Query("5K"),
    prs_only: bool = Query(False),
):
    """
    All best efforts for a given distance, chronological.
    prs_only=true returns only the running minimum (i.e. every time a new PR was set).
    """
    _ensure_table(conn)
    rows = conn.execute(
        """
        SELECT be.date, be.duration_seconds, be.activity_id,
               a.name AS activity_name
        FROM best_efforts be
        LEFT JOIN activities a ON a.id = be.activity_id
        WHERE be.target_label = ?
        ORDER BY be.date
        """,
        (distance_label,),
    ).fetchall()

    efforts = [dict(r) for r in rows]

    if prs_only:
        best = None
        filtered = []
        for e in efforts:
            if best is None or e["duration_seconds"] < best:
                best = e["duration_seconds"]
                filtered.append({**e, "is_pr": True})
        efforts = filtered
    else:
        if efforts:
            pr_val = min(e["duration_seconds"] for e in efforts)
            running_best = None
            for e in efforts:
                if running_best is None or e["duration_seconds"] <= running_best:
                    running_best = e["duration_seconds"]
                    e["is_pr"] = True
                else:
                    e["is_pr"] = False

    return {
        "distance_label": distance_label,
        "efforts": efforts,
        "targets": [t[1] for t in TARGETS],
    }
