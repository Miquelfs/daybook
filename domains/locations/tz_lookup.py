"""
Coordinate → local calendar date.

Overland timestamps are UTC. Bucketing a GPS point into a "day" by taking the
UTC calendar date (instead of the local date at the point's coordinates)
misattributes points near local midnight during international travel — e.g. a
5am arrival in Osaka (UTC+9) is still ~8pm the previous day in UTC, so it gets
stamped onto the wrong day. This module derives the correct local date instead.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from timezonefinder import TimezoneFinder

_tf = TimezoneFinder()


def local_date_for_point(iso_ts: str, lat: float, lng: float) -> str:
    """Given a UTC (or offset-aware) ISO timestamp and coordinates, return the
    YYYY-MM-DD calendar date in the local timezone at those coordinates."""
    dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    tz_name = _tf.timezone_at(lat=lat, lng=lng) or _tf.closest_timezone_at(lat=lat, lng=lng)
    if not tz_name:
        return dt.astimezone().strftime("%Y-%m-%d") if dt.tzinfo else dt.strftime("%Y-%m-%d")
    return dt.astimezone(ZoneInfo(tz_name)).strftime("%Y-%m-%d")
