"""
Read-only query helpers for the locations domain.
The locations.db was imported from Google Maps Timeline via miquelOS/maps_import.py
and geocoded via geocode_places.py (4,058 place names, visits 2014 → present).

All functions return plain dicts suitable for JSON serialisation.
"""

import sqlite3
from pathlib import Path

_DB = Path(__file__).parents[2] / "infrastructure" / "db" / "locations.db"


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(_DB)
    con.row_factory = sqlite3.Row
    return con


def visits_for_date(date: str) -> list[dict]:
    """Return all visits (with geocoded place name) for a given date."""
    con = _conn()
    rows = con.execute(
        """
        SELECT  v.start_time, v.end_time, v.semantic_type,
                v.lat, v.lng,
                p.name       AS place_name,
                p.city       AS city,
                p.country    AS country,
                p.address    AS address
        FROM    visits v
        LEFT JOIN place_names p ON p.place_id = v.place_id
        WHERE   v.date = ?
        ORDER BY v.start_time
        """,
        (date,),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def movements_for_date(date: str) -> list[dict]:
    """Return all movement segments for a given date."""
    con = _conn()
    rows = con.execute(
        """
        SELECT start_time, end_time, activity_type, distance_meters, probability
        FROM   movements
        WHERE  date = ?
        ORDER BY start_time
        """,
        (date,),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def location_summary_for_date(date: str) -> dict:
    """Single-object summary: unique cities visited + total distance moved."""
    con = _conn()

    cities_row = con.execute(
        """
        SELECT GROUP_CONCAT(DISTINCT p.city) AS cities
        FROM   visits v
        LEFT JOIN place_names p ON p.place_id = v.place_id
        WHERE  v.date = ?
        """,
        (date,),
    ).fetchone()

    dist_row = con.execute(
        "SELECT COALESCE(SUM(distance_meters), 0) FROM movements WHERE date = ?",
        (date,),
    ).fetchone()

    con.close()
    cities_raw = cities_row["cities"] if cities_row and cities_row["cities"] else ""
    cities = [c.strip() for c in cities_raw.split(",") if c.strip()] if cities_raw else []
    return {
        "cities": cities,
        "total_distance_meters": round(dist_row[0] or 0, 1),
    }


def on_this_day_locations(month_day: str) -> list[dict]:
    """
    Return cities visited on the same month-day in previous years.
    month_day format: MM-DD
    """
    con = _conn()
    rows = con.execute(
        """
        SELECT  v.date,
                p.city,
                p.country,
                p.name AS place_name,
                v.semantic_type
        FROM    visits v
        LEFT JOIN place_names p ON p.place_id = v.place_id
        WHERE   substr(v.date, 6, 5) = ?
          AND   p.city IS NOT NULL
        ORDER BY v.date DESC
        """,
        (month_day,),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]
