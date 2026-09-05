"""
Read-only query helpers for the locations domain.
The locations.db was imported from Google Maps Timeline via miquelOS/maps_import.py
and geocoded via geocode_places.py (4,058 place names, visits 2014 → present).

All functions return plain dicts suitable for JSON serialisation.
"""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

_DB = Path(__file__).parents[2] / "infrastructure" / "db" / "locations.db"
_DAYBOOK_DB = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"

_CITY_NORM: dict[str, str] = {
    "Palma de Mallorca": "Palma",
    "Palma de Mallorca (Palma)": "Palma",
    "Sigtuna kommun": "Stockholm Arlanda",
    "San Miguel de Abona": "Tenerife Sur",
    "Granadilla de Abona": "Tenerife Sur",
}


def _norm_city(city: str | None) -> str | None:
    if city is None:
        return None
    return _CITY_NORM.get(city, city)


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
    result = _location_summary_with_conn(con, date)
    con.close()
    return result


def _location_summary_with_conn(con: sqlite3.Connection, date: str) -> dict:
    """Same as location_summary_for_date but reuses an existing connection.
    Overland tracks (geocode_city) are the primary source; Google visits are fallback."""
    # Primary: Overland tracks geocoded via Nominatim
    overland_rows = con.execute(
        """
        SELECT DISTINCT geocode_city AS city
        FROM   tracks
        WHERE  date = ?
          AND  geocode_city IS NOT NULL
        ORDER BY segment_start
        """,
        (date,),
    ).fetchall()

    cities = list(dict.fromkeys(_norm_city(r["city"]) for r in overland_rows if r["city"]))

    # Fallback: Google Maps visits (legacy data, pre-Overland)
    if not cities:
        cities_row = con.execute(
            """
            SELECT GROUP_CONCAT(DISTINCT p.city) AS cities
            FROM   visits v
            LEFT JOIN place_names p ON p.place_id = v.place_id
            WHERE  v.date = ?
            """,
            (date,),
        ).fetchone()
        cities_raw = cities_row["cities"] if cities_row and cities_row["cities"] else ""
        cities = [_norm_city(c.strip()) for c in cities_raw.split(",") if c.strip()] if cities_raw else []

    dist_row = con.execute(
        "SELECT COALESCE(SUM(distance_meters), 0) FROM movements WHERE date = ?",
        (date,),
    ).fetchone()

    return {
        "cities": cities,
        "total_distance_meters": round(dist_row[0] or 0, 1),
    }


def location_data_for_date(date: str) -> tuple[dict, list[dict]]:
    """Return (summary, visits) for a date in a single connection."""
    con = _conn()
    summary = _location_summary_with_conn(con, date)
    visit_rows = con.execute(
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
    return summary, [dict(r) for r in visit_rows]


def _parse_iso(s: str) -> datetime:
    """Segment timestamps are UTC ('...Z' or '+00:00'). Returns a *naive*
    datetime representing UTC (tzinfo stripped) so it compares cleanly
    against the naive-UTC activity windows below — mixing aware and naive
    datetimes raises TypeError instead of comparing."""
    return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)


def _activities_for_date(date: str) -> list[tuple[datetime, datetime, str | None]]:
    """(start, end, activity_type) windows for Garmin/Strava activities on a
    date — authoritative exercise mode (run/ride/hike/walk/swim/...), used to
    label GPS track segments instead of guessing from speed alone.

    activities.start_time is naive *local* wall-clock time (no timezone), so
    it's converted to naive UTC using the day's captured utc_offset_min —
    the same convention domains/health/stress_context.py uses to reconcile
    local activity/wellness times against UTC GPS timestamps.
    """
    con = sqlite3.connect(_DAYBOOK_DB)
    con.row_factory = sqlite3.Row
    try:
        off_row = con.execute(
            "SELECT utc_offset_min FROM wellness_daily WHERE date = ?", (date,)
        ).fetchone()
        off_min = off_row["utc_offset_min"] if off_row and off_row["utc_offset_min"] is not None else 0
        rows = con.execute(
            "SELECT activity_type, start_time, duration_seconds FROM activities "
            "WHERE date = ? AND start_time IS NOT NULL",
            (date,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        con.close()

    out = []
    for r in rows:
        try:
            local_start = datetime.fromisoformat(r["start_time"])
            start = local_start - timedelta(minutes=off_min)
        except (ValueError, TypeError):
            continue
        end = start + timedelta(seconds=r["duration_seconds"] or 0)
        out.append((start, end, r["activity_type"]))
    return out


# Points this close to the day's home get clustered under one "Casa" label
# instead of surfacing as several different neighboring-street names (GPS
# jitter right around the house reverse-geocodes inconsistently). Separate
# from — and much tighter than — the 40km+ radii used for trip detection and
# the stress "home" bucket, which are answering a different question ("did
# you leave town", not "are you literally at the house").
CASA_RADIUS_KM = 0.1


def _casa_coords(date: str) -> tuple[float, float] | None:
    """Precise home coordinate for a date, from a visits row Google Timeline
    itself semantically tagged 'Home' — closest to (on or before) that date,
    since home has moved over the years. Deliberately NOT the life_periods
    home-base centroid used for trip detection: that's a ~40km region
    ("did you leave town"), not a street address ("are you at the house"),
    so it's far too loose to safely cluster under one "Casa" label. No
    fallback to it here — if there's no precise Home tag near this date,
    Casa clustering is simply skipped for it rather than risk over-matching.
    """
    con = _conn()
    try:
        row = con.execute(
            "SELECT lat, lng FROM visits WHERE semantic_type='Home' AND date <= ? "
            "ORDER BY date DESC LIMIT 1",
            (date,),
        ).fetchone()
        if row is None:
            row = con.execute(
                "SELECT lat, lng FROM visits WHERE semantic_type='Home' AND date >= ? "
                "ORDER BY date ASC LIMIT 1",
                (date,),
            ).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        con.close()
    if row is None or row["lat"] is None:
        return None
    return row["lat"], row["lng"]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    from math import radians, sin, cos, sqrt, atan2
    R = 6371.0
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


# Overland's on-device Core Motion classification per ping (a JSON array,
# sometimes several at once e.g. ["driving","stationary"]). Priority order
# when several apply to one window — most specific/confident first.
_MOTION_PRIORITY = ["cycling", "running", "walking", "driving", "stationary"]

# Day-level tags (domains/locations "matching it with the tags" — CLAUDE.md
# tags convention) that disambiguate Overland's generic "driving" bucket,
# which can't tell car/bus/scooter/train apart on its own.
_TRANSPORT_TAG_SLUGS = {"motorcycle": "scooter", "car_drive": "car"}


def _motion_events(con: sqlite3.Connection, date: str) -> list[tuple[datetime, list[str]]]:
    """(time, motion_labels) for each raw Overland ping with motion data on a
    date — used to label GPS track segments by actual on-device sensor
    classification instead of guessing from speed alone."""
    import json as _json

    try:
        rows = con.execute(
            "SELECT recorded_at, motion FROM overland_locations "
            "WHERE date = ? AND motion IS NOT NULL AND motion != '[]'",
            (date,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []

    out = []
    for r in rows:
        try:
            labels = _json.loads(r["motion"])
        except (TypeError, ValueError):
            continue
        if not labels:
            continue
        try:
            t = _parse_iso(r["recorded_at"])
        except (ValueError, AttributeError):
            continue
        out.append((t, labels))
    out.sort(key=lambda x: x[0])
    return out


def _day_transport_hint(date: str) -> str | None:
    """"car" / "scooter" if the day is tagged with exactly one of them
    (Scooter ride / Car drive) — None if neither or both, so an ambiguous
    day falls back to the generic "vehicle" label rather than guessing."""
    con = sqlite3.connect(_DAYBOOK_DB)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """SELECT t.slug FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.date = ? AND t.slug IN ('motorcycle', 'car_drive')""",
            (date,),
        ).fetchall()
    except sqlite3.OperationalError:
        return None
    finally:
        con.close()
    found = {_TRANSPORT_TAG_SLUGS[r["slug"]] for r in rows}
    return found.pop() if len(found) == 1 else None


def tracks_for_date(date: str) -> list[dict]:
    """Return GPS track segments for a date as GeoJSON-ready dicts.

    Each segment is enriched with the best available place label:
    1. visit place_name (street/venue level, from the visits+place_names tables,
       matched by time overlap) — most descriptive
    2. visit semantic_type (Home / Work) if present
    3. Fallback to the track's own geocode_name / geocode_city (district level)

    Each segment also carries:
    - `activity_type` when it overlaps a logged Garmin/Strava activity
      (run/ride/hike/walk/swim/...) — authoritative exercise mode.
    - `motion` — Overland's on-device Core Motion classification
      (walking/running/cycling/driving/stationary) when no activity applies;
      "driving" is refined to "car"/"scooter" using the day's Car
      drive/Scooter ride tag when exactly one of them is set.
    These let the map color the route by an actual detected mode instead of
    guessing from speed alone (speed is still the last-resort fallback).

    Points within CASA_RADIUS_KM of the home active on this date are
    relabeled "Casa" (semantic_type "Home") instead of their raw reverse-
    geocoded street name — GPS jitter right around the house otherwise
    surfaces as several different neighboring-street "places".
    """
    import json as _json

    activities = _activities_for_date(date)
    transport_hint = _day_transport_hint(date)

    def best_activity(seg_start: str, seg_end: str) -> str | None:
        try:
            s, e = _parse_iso(seg_start), _parse_iso(seg_end)
        except (ValueError, AttributeError):
            return None
        for a_start, a_end, a_type in activities:
            if a_start <= e and a_end >= s:
                return a_type
        return None

    con = _conn()
    rows = con.execute(
        """
        SELECT segment_start, segment_end, points_json,
               geocode_name, geocode_city, geocode_country
        FROM   tracks
        WHERE  date = ?
        ORDER BY segment_start
        """,
        (date,),
    ).fetchall()

    # Load all visits for this date once, for time-overlap enrichment
    visit_rows = con.execute(
        """
        SELECT v.start_time, v.end_time, v.semantic_type,
               p.name AS place_name, p.city, p.country
        FROM   visits v
        LEFT JOIN place_names p ON p.place_id = v.place_id
        WHERE  v.date = ?
        ORDER BY v.start_time
        """,
        (date,),
    ).fetchall()
    motion_events = _motion_events(con, date)
    con.close()

    def best_motion(seg_start: str, seg_end: str) -> str | None:
        try:
            s, e = _parse_iso(seg_start), _parse_iso(seg_end)
        except (ValueError, AttributeError):
            return None
        window = timedelta(seconds=90)
        seen: set[str] = set()
        for t, labels in motion_events:
            if s - window <= t <= e + window:
                seen.update(labels)
        for p in _MOTION_PRIORITY:
            if p not in seen:
                continue
            if p == "driving" and transport_hint:
                return transport_hint
            return p
        return None

    casa_coords = _casa_coords(date)

    def near_home(lat: float, lng: float) -> bool:
        if casa_coords is None:
            return False
        return _haversine_km(lat, lng, casa_coords[0], casa_coords[1]) <= CASA_RADIUS_KM

    visits = [dict(r) for r in visit_rows]

    def best_label(seg_start: str, seg_end: str) -> dict:
        # Find any visit whose window overlaps this track segment
        for v in visits:
            if v["start_time"] <= seg_end and v["end_time"] >= seg_start:
                return {
                    "place_name": v["place_name"],
                    "semantic_type": v["semantic_type"],
                    "city": v["city"],
                    "country": v["country"],
                }
        return {}

    result = []
    for r in rows:
        pts = _json.loads(r["points_json"])
        enrich = best_label(r["segment_start"], r["segment_end"])
        place_name = enrich.get("place_name") or r["geocode_name"]
        semantic_type = enrich.get("semantic_type")
        if pts and near_home(pts[0]["lat"], pts[0]["lng"]):
            place_name, semantic_type = "Casa", "Home"
        result.append({
            "segment_start": r["segment_start"],
            "segment_end": r["segment_end"],
            "place_name": place_name,
            "semantic_type": semantic_type,
            "city": enrich.get("city") or r["geocode_city"],
            "country": enrich.get("country") or r["geocode_country"],
            "activity_type": best_activity(r["segment_start"], r["segment_end"]),
            "motion": best_motion(r["segment_start"], r["segment_end"]),
            "coordinates": [[p["lng"], p["lat"]] for p in pts],
        })
    return result


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
