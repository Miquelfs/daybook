"""
Insights endpoints — stubs now, real implementations in Phase 2.
on-this-day is partially functional via the locations domain.
"""

import json
import sqlite3
from datetime import date as _date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from infrastructure.api.db import get_db

router = APIRouter(prefix="/insights", tags=["insights"])

TIMEZONE = "Europe/Madrid"


@router.get("/on-this-day/{date_str}")
def on_this_day(date_str: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    """
    Returns what happened on this same calendar date in previous years:
    mood/notes, restaurants, books, and where you were (city, if it was a
    day away from home) — one entry per year that has anything logged.
    Health + subjective + restaurants/books from daybook.db; location data
    from locations.db.
    """
    month_day = date_str[5:]   # MM-DD

    # Health + subjective rows for same MM-DD in previous years
    rows = conn.execute(
        """
        SELECT  d.date,
                d.energy, d.mood, d.stress, d.notes, d.mood_note, d.tags,
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

    # Restaurants/books for THIS SPECIFIC month-day across all years (not just
    # the health/subjective rows above — a day can have a restaurant logged
    # with no mood/notes at all).
    restaurant_rows = conn.execute(
        """SELECT date_visited AS date, name, city, cuisine, rating_mf
           FROM restaurants
           WHERE date_visited IS NOT NULL AND substr(date_visited, 6, 5) = ? AND date_visited != ?""",
        (month_day, date_str),
    ).fetchall()
    book_rows = conn.execute(
        """SELECT date_finished AS date, title, author, rating
           FROM books
           WHERE date_finished IS NOT NULL AND substr(date_finished, 6, 5) = ? AND date_finished != ?""",
        (month_day, date_str),
    ).fetchall()

    restaurants_by_date: dict[str, list[dict]] = {}
    for r in restaurant_rows:
        restaurants_by_date.setdefault(r["date"], []).append(dict(r))
    books_by_date: dict[str, list[dict]] = {}
    for r in book_rows:
        books_by_date.setdefault(r["date"], []).append(dict(r))

    # Was this same month-day, in a previous year, part of an auto-detected
    # trip (nights away from home)? Trips span a date range, not a single
    # date, so match by walking each trip's (short) span rather than a SQL
    # substr — this is what "you were in Milano" pulls from, explicitly
    # gated on actual trip membership so home-city days don't show a city.
    trip_city_by_date: dict[str, str] = {}
    has_trips = bool(
        conn.execute("SELECT name FROM sqlite_master WHERE name='trips'").fetchone()
    )
    if has_trips:
        has_hidden = any(r["name"] == "hidden" for r in conn.execute("PRAGMA table_info(trips)"))
        hide = "WHERE (hidden IS NULL OR hidden = 0)" if has_hidden else ""
        for tr in conn.execute(f"SELECT start_date, end_date, return_date, cities_json FROM trips {hide}"):
            cities = json.loads(tr["cities_json"] or "[]")
            if not cities:
                continue
            end = tr["return_date"] or tr["end_date"]
            try:
                cur, last = _date.fromisoformat(tr["start_date"]), _date.fromisoformat(end)
            except ValueError:
                continue
            while cur <= last:
                iso = cur.isoformat()
                if cur.strftime("%m-%d") == month_day and iso != date_str:
                    trip_city_by_date[iso] = cities[0]
                cur += timedelta(days=1)

    # Union every date that has ANY of the above, not just a `days` row.
    all_dates = sorted(
        {r["date"] for r in rows} | set(restaurants_by_date) | set(books_by_date) | set(trip_city_by_date),
        reverse=True,
    )
    by_date = {r["date"]: dict(r) for r in rows}

    years = []
    for d in all_dates:
        base = by_date.get(d, {"date": d, "energy": None, "mood": None, "stress": None,
                                "notes": None, "mood_note": None, "tags": None, "duration_seconds": None,
                                "avg_hrv": None, "steps": None, "resting_hr": None})
        years.append({
            **base,
            "restaurants": restaurants_by_date.get(d, []),
            "books": books_by_date.get(d, []),
            "trip_city": trip_city_by_date.get(d),
        })

    return {
        "date": date_str,
        "month_day": month_day,
        "years": years,
    }


@router.get("/streaks")
def streaks():
    """Placeholder — Phase 2."""
    return {"streaks": [], "note": "Not yet implemented"}


@router.get("/correlations")
def correlations():
    """Placeholder — Phase 2."""
    return {"correlations": [], "note": "Not yet implemented"}
