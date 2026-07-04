"""
Home-base lookup anchored on life_periods location periods (Plan B.1).

`home_for(date)` returns the home centroid active on a date:
  {label, lat, lng, radius_km, source}
Priority:
  1. life_periods row with category='location' covering the date and coords set
  2. fallback: rolling 30-day GPS centroid (median of visit coords ending on date)
Returns None only when neither source has data.
"""

from __future__ import annotations

import sqlite3
import statistics
from functools import lru_cache
from pathlib import Path

_ROOT = Path(__file__).parents[2]
_DAYBOOK_DB = _ROOT / "infrastructure" / "db" / "daybook.db"
_LOCATIONS_DB = _ROOT / "infrastructure" / "db" / "locations.db"

DEFAULT_TRIP_RADIUS_KM = 150.0  # "away from home" threshold for trip detection


def _conn(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


@lru_cache(maxsize=4096)
def home_for(date: str) -> dict | None:
    """Home base active on `date` (YYYY-MM-DD)."""
    con = _conn(_DAYBOOK_DB)
    try:
        row = con.execute(
            """SELECT label, centroid_lat, centroid_lng, home_radius_km
               FROM life_periods
               WHERE category = 'location'
                 AND centroid_lat IS NOT NULL AND centroid_lng IS NOT NULL
                 AND start_date <= ?
                 AND (end_date IS NULL OR end_date >= ?)
               ORDER BY start_date DESC
               LIMIT 1""",
            (date, date),
        ).fetchone()
    except sqlite3.OperationalError:
        row = None  # centroid columns not migrated yet
    finally:
        con.close()

    if row:
        return {
            "label": row["label"],
            "lat": row["centroid_lat"],
            "lng": row["centroid_lng"],
            "radius_km": row["home_radius_km"] or 40.0,
            "source": "life_period",
        }
    return _gps_centroid_fallback(date)


@lru_cache(maxsize=4096)
def _gps_centroid_fallback(date: str) -> dict | None:
    """Median of visit coordinates over the 30 days ending on `date`."""
    con = _conn(_LOCATIONS_DB)
    try:
        rows = con.execute(
            """SELECT lat, lng FROM visits
               WHERE date <= ? AND date >= date(?, '-30 days')
                 AND lat IS NOT NULL AND lng IS NOT NULL""",
            (date, date),
        ).fetchall()
    finally:
        con.close()

    if len(rows) < 5:
        return None
    return {
        "label": "GPS centroid",
        "lat": statistics.median(r["lat"] for r in rows),
        "lng": statistics.median(r["lng"] for r in rows),
        "radius_km": 40.0,
        "source": "gps_fallback",
    }
