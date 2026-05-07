"""
Insights endpoints — stubs now, real implementations in Phase 2.
on-this-day is partially functional via the locations domain.
"""

import sqlite3
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from infrastructure.api.db import get_db
from domains.locations.locations_query import on_this_day_locations

router = APIRouter(prefix="/insights", tags=["insights"])

TIMEZONE = "Europe/Madrid"


@router.get("/on-this-day/{date_str}")
def on_this_day(date_str: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    """
    Returns what happened on this same calendar date in previous years.
    Health + subjective data from daybook.db; location data from locations.db.
    """
    month_day = date_str[5:]   # MM-DD

    # Health + subjective rows for same MM-DD in previous years
    rows = conn.execute(
        """
        SELECT  d.date,
                d.energy, d.mood, d.stress, d.notes, d.tags,
                s.duration_seconds, s.avg_hrv,
                ds.steps, ds.resting_hr
        FROM    days d
        LEFT JOIN sleep        s  ON s.date  = d.date
        LEFT JOIN daily_stats  ds ON ds.date = d.date
        WHERE   substr(d.date, 6, 5) = ?
          AND   d.date != ?
        ORDER BY d.date DESC
        """,
        (month_day, date_str),
    ).fetchall()

    history = [dict(r) for r in rows]

    # Enrich with locations
    loc_by_date = {r["date"]: on_this_day_locations(month_day) for r in rows}

    return {
        "date": date_str,
        "month_day": month_day,
        "years": history,
        "locations_by_year": loc_by_date,
    }


@router.get("/streaks")
def streaks():
    """Placeholder — Phase 2."""
    return {"streaks": [], "note": "Not yet implemented"}


@router.get("/correlations")
def correlations():
    """Placeholder — Phase 2."""
    return {"correlations": [], "note": "Not yet implemented"}
