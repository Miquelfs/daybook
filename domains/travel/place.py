"""
Where a moment happened, without asking: the photo's own GPS, else the Overland point nearest
that minute, labelled with the track segment you were in (venue / city / country, already
reverse-geocoded nightly). Overland may upload hours late when you're roaming, so a moment that
can't be placed yet is retried whenever its trip is read.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

WINDOW_MIN = 45          # an Overland point this close in time is "where you were"
LABEL_WINDOW_H = 3       # nearest labelled segment for the city/country, same window


def _utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)


def _z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def position_at(loc: sqlite3.Connection | None, taken_at: str, window_min: int = WINDOW_MIN) -> tuple[float, float] | None:
    """The Overland fix nearest in time to `taken_at` (UTC ISO), within the window."""
    if loc is None or not taken_at:
        return None
    t = _utc(taken_at)
    w = timedelta(minutes=window_min)
    try:
        rows = loc.execute(
            "SELECT lat, lng, recorded_at FROM overland_locations WHERE recorded_at BETWEEN ? AND ?",
            (_z(t - w), _z(t + w))).fetchall()
    except sqlite3.OperationalError:
        return None
    best = None
    for r in rows:
        try:
            gap = abs((_utc(r[2]) - t).total_seconds())
        except ValueError:
            continue
        if best is None or gap < best[0]:
            best = (gap, r[0], r[1])
    return (best[1], best[2]) if best else None


def label_at(loc: sqlite3.Connection | None, taken_at: str | None, lat: float | None = None,
             lng: float | None = None) -> dict:
    """{place, city, country} of the track segment you were in at `taken_at` (or the nearest one
    within a few hours). With a position and no time, the nearest geocoded segment that day."""
    empty = {"place": None, "city": None, "country": None}
    if loc is None or not taken_at:
        return empty
    t = _utc(taken_at)
    w = timedelta(hours=LABEL_WINDOW_H)
    try:
        rows = loc.execute(
            """SELECT segment_start, segment_end, geocode_name, geocode_city, geocode_country
               FROM tracks WHERE segment_end >= ? AND segment_start <= ?
                 AND (geocode_city IS NOT NULL OR geocode_name IS NOT NULL)""",
            (_z(t - w), _z(t + w))).fetchall()
    except sqlite3.OperationalError:
        return empty
    best = None
    for r in rows:
        try:
            s, e = _utc(r[0]), _utc(r[1])
        except (ValueError, AttributeError):
            continue
        gap = 0.0 if s <= t <= e else min(abs((s - t).total_seconds()), abs((e - t).total_seconds()))
        if best is None or gap < best[0]:
            best = (gap, r)
    if not best:
        return empty
    r = best[1]
    # A segment an hour away is still the right city, but not the right venue.
    return {"place": r[2] if best[0] <= 15 * 60 else None, "city": r[3], "country": r[4]}


def geocode(lat: float, lng: float) -> dict:
    """Nominatim, once, for a photo whose GPS lies outside any track. Never raises."""
    try:
        from domains.locations.overland_process import _extract_place, _reverse_geocode
        name, city, country = _extract_place(_reverse_geocode(lat, lng, zoom=18))
        return {"place": name, "city": city, "country": country}
    except Exception:
        return {"place": None, "city": None, "country": None}


@lru_cache(maxsize=1)
def _finder():
    from timezonefinder import TimezoneFinder
    return TimezoneFinder()


def tz_at(lat: float | None, lng: float | None, fallback: str | None = None) -> str | None:
    if lat is not None and lng is not None:
        try:
            name = _finder().timezone_at(lat=lat, lng=lng)
            if name:
                return name
        except Exception:
            pass
    return fallback


def local(taken_at: str, tz: str | None) -> datetime:
    t = _utc(taken_at)
    try:
        return t.astimezone(ZoneInfo(tz)) if tz else t.astimezone()
    except Exception:
        return t.astimezone()


def resolve(conn: sqlite3.Connection, loc: sqlite3.Connection | None, moment_id: int,
            allow_network: bool = False) -> bool:
    """Fill in a moment's position and place when they're missing. True if it changed."""
    m = conn.execute("SELECT * FROM moments WHERE id = ?", (moment_id,)).fetchone()
    if m is None:
        return False
    lat, lng, src = m["lat"], m["lng"], m["place_source"]
    changed: dict = {}
    if lat is None and m["taken_at"]:
        pos = position_at(loc, m["taken_at"])
        if pos:
            lat, lng = pos
            changed.update(lat=lat, lng=lng, place_source=src or "track")
    if lat is not None and not m["city"]:
        lab = label_at(loc, m["taken_at"], lat, lng)
        if not lab["city"] and allow_network:
            lab = geocode(lat, lng)
        for k in ("place", "city", "country"):
            if lab.get(k) and not m[k]:
                changed[k] = lab[k]
    if not changed:
        return False
    sets = ", ".join(f"{k} = ?" for k in changed)
    conn.execute(f"UPDATE moments SET {sets} WHERE id = ?", (*changed.values(), moment_id))
    conn.commit()
    return True
