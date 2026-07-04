import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from domains.locations.country_names import to_english
from domains.locations.locations_query import tracks_for_date

router = APIRouter(prefix="/locations", tags=["locations"])

_DB = Path(__file__).parents[3] / "infrastructure" / "db" / "locations.db"

# Normalize city names that Nominatim returns inconsistently
_CITY_NORM: dict[str, str] = {
    "Palma de Mallorca": "Palma",
    "Palma de Mallorca (Palma)": "Palma",
    # Sigtuna kommun is the municipality — keep as Stockholm Arlanda for clarity
    "Sigtuna kommun": "Stockholm Arlanda",
    # Tenerife airport municipalities — both map to the airport area
    "San Miguel de Abona": "Tenerife Sur",
    "Granadilla de Abona": "Tenerife Sur",
}


def _en(country: str | None) -> str | None:
    return to_english(country)


def _norm_city(city: str | None) -> str | None:
    if city is None:
        return None
    return _CITY_NORM.get(city, city)


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(_DB)
    con.row_factory = sqlite3.Row
    return con


# ── Tracks (GPS paths) ────────────────────────────────────────────────────────

@router.get("/heatmap")
def get_heatmap(year: int | None = None):
    """
    Return all visit coordinates as a flat array of [lat, lng, weight] for
    Leaflet.heat.  Weight = visit probability (0-1).  Optionally filter by year.
    Also returns country + city rollups for the stats panel.
    """
    con = _conn()

    year_clause_v = "AND substr(v.date,1,4) = ?" if year else ""
    year_clause_t = "AND substr(t.date,1,4) = ?" if year else ""
    params: tuple = (str(year),) if year else ()

    # Heat points: visits (Google Maps legacy) + Overland tracks midpoints
    points = con.execute(
        f"""
        SELECT lat, lng, w FROM (
            SELECT v.lat, v.lng, COALESCE(v.probability, 0.5) as w
            FROM   visits v
            WHERE  v.lat IS NOT NULL AND v.lng IS NOT NULL
                   AND v.lat != 0 AND v.lng != 0
                   {year_clause_v}
            UNION ALL
            SELECT json_extract(t.points_json, '$[0].lat') as lat,
                   json_extract(t.points_json, '$[0].lng') as lng,
                   0.4 as w
            FROM   tracks t
            WHERE  t.geocode_city IS NOT NULL
                   {year_clause_t}
        )
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        """,
        params + params,
    ).fetchall()

    # Country rollup: visits + tracks
    countries = con.execute(
        f"""
        SELECT country, COUNT(DISTINCT date) as days FROM (
            SELECT p.country, substr(v.date,1,10) as date
            FROM   visits v
            LEFT JOIN place_names p ON p.place_id = v.place_id
            WHERE  p.country IS NOT NULL {year_clause_v}
            UNION
            SELECT t.geocode_country as country, substr(t.date,1,10) as date
            FROM   tracks t
            WHERE  t.geocode_country IS NOT NULL {year_clause_t}
        )
        GROUP BY country
        ORDER BY days DESC
        """,
        params + params,
    ).fetchall()

    # City rollup: visits + tracks (top 40)
    cities = con.execute(
        f"""
        SELECT city, country, COUNT(DISTINCT date) as days FROM (
            SELECT p.city, p.country, substr(v.date,1,10) as date
            FROM   visits v
            LEFT JOIN place_names p ON p.place_id = v.place_id
            WHERE  p.city IS NOT NULL {year_clause_v}
            UNION
            SELECT t.geocode_city as city, t.geocode_country as country, substr(t.date,1,10) as date
            FROM   tracks t
            WHERE  t.geocode_city IS NOT NULL {year_clause_t}
        )
        GROUP BY city, country
        ORDER BY days DESC
        LIMIT 40
        """,
        params + params,
    ).fetchall()

    # Available years: union both sources
    years = con.execute(
        """SELECT DISTINCT y FROM (
               SELECT substr(date,1,4) as y FROM visits
               UNION
               SELECT substr(date,1,4) as y FROM tracks WHERE geocode_city IS NOT NULL
           ) ORDER BY y DESC"""
    ).fetchall()

    con.close()

    # Aggregate after translating country names so "España" and "Spain" merge
    country_totals: dict[str, int] = {}
    for r in countries:
        name = _en(r["country"]) or r["country"]
        country_totals[name] = country_totals.get(name, 0) + r["days"]
    sorted_countries = sorted(country_totals.items(), key=lambda x: -x[1])

    city_totals: dict[tuple, int] = {}
    for r in cities:
        city = _norm_city(r["city"]) or r["city"]
        country = _en(r["country"]) or r["country"]
        key = (city, country)
        city_totals[key] = city_totals.get(key, 0) + r["days"]
    sorted_cities = sorted(city_totals.items(), key=lambda x: -x[1])

    return {
        "points": [[r["lat"], r["lng"], round(float(r["w"]), 2)] for r in points],
        "countries": [{"country": name, "days": days} for name, days in sorted_countries],
        "cities": [{"city": city, "country": country, "days": days} for (city, country), days in sorted_cities[:40]],
        "years": [r["y"] for r in years],
    }


@router.get("/tracks/{date_str}")
def get_tracks(date_str: str):
    """GeoJSON FeatureCollection of GPS track segments for a date.

    Segments with 1 point are returned as Point features (stop markers);
    segments with 2+ points are returned as LineString features (paths).
    This handles sparse Overland updates where most pings are single-point.
    """
    segments = tracks_for_date(date_str)
    features = []
    for seg in segments:
        coords = seg["coordinates"]
        if not coords:
            continue
        props = {
            "segment_start": seg["segment_start"],
            "segment_end": seg["segment_end"],
            "place_name": seg["place_name"],
            "semantic_type": seg["semantic_type"],
            "city": seg["city"],
            "country": seg["country"],
        }
        if len(coords) >= 2:
            geometry = {"type": "LineString", "coordinates": coords}
        else:
            geometry = {"type": "Point", "coordinates": coords[0]}
        features.append({"type": "Feature", "geometry": geometry, "properties": props})
    return {"type": "FeatureCollection", "features": features}


# ── Location day summaries ────────────────────────────────────────────────────

@router.get("/summary/{date_str}")
def get_location_summary(date_str: str):
    """
    Pre-computed daily location summary from location_days table.
    Returns distance_meters, unique_places, top_place for a single date.
    """
    con = _conn()
    row = con.execute(
        """
        SELECT date, distance_meters, unique_places, top_place, top_place_city, computed_at
        FROM location_days
        WHERE date = ?
        """,
        (date_str,),
    ).fetchone()
    con.close()
    if row is None:
        return {"date": date_str, "distance_meters": 0, "unique_places": 0,
                "top_place": None, "top_place_city": None}
    return dict(row)


@router.get("/summary/range")
def get_location_summary_range(start: str, end: str):
    """
    Location summaries for a date range — used by correlations engine and Explore.
    Returns list of {date, distance_meters, unique_places, top_place, top_place_city}.
    """
    con = _conn()
    rows = con.execute(
        """
        SELECT date, distance_meters, unique_places, top_place, top_place_city
        FROM location_days
        WHERE date BETWEEN ? AND ?
        ORDER BY date
        """,
        (start, end),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


@router.get("/movement/stats")
def get_movement_stats(year: int | None = None):
    """
    Aggregated movement stats from location_days.
    Returns: yearly totals, monthly totals, weekly totals (last 52 weeks),
    top distance days, and overall summary.
    """
    con = _conn()
    year_clause = "WHERE substr(date,1,4) = ?" if year else ""
    params: tuple = (str(year),) if year else ()

    # Check table exists
    tbl = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='location_days'"
    ).fetchone()
    if not tbl:
        con.close()
        return {"yearly": [], "monthly": [], "weekly": [], "top_days": [], "summary": {}}

    # Yearly totals
    yearly = con.execute(
        f"""
        SELECT substr(date,1,4) AS year,
               SUM(distance_meters) / 1000.0 AS total_km,
               AVG(distance_meters) / 1000.0 AS avg_km,
               MAX(distance_meters) / 1000.0 AS max_km,
               COUNT(*) AS days_with_data
        FROM location_days
        {year_clause}
        GROUP BY year ORDER BY year DESC
        """,
        params,
    ).fetchall()

    # Monthly totals (all time or filtered year)
    monthly = con.execute(
        f"""
        SELECT substr(date,1,7) AS month,
               SUM(distance_meters) / 1000.0 AS total_km,
               AVG(distance_meters) / 1000.0 AS avg_km,
               COUNT(*) AS days_with_data
        FROM location_days
        {year_clause}
        GROUP BY month ORDER BY month
        """,
        params,
    ).fetchall()

    # Weekly totals — last 104 weeks (2 years), for the bar chart
    weekly = con.execute(
        """
        SELECT
            strftime('%Y-W%W', date) AS week,
            MIN(date) AS week_start,
            SUM(distance_meters) / 1000.0 AS total_km,
            COUNT(*) AS days_with_data
        FROM location_days
        WHERE date >= date('now', '-104 weeks')
        GROUP BY week ORDER BY week
        """
    ).fetchall()

    # Top 10 highest-distance days
    top_days = con.execute(
        f"""
        SELECT date, distance_meters / 1000.0 AS km, unique_places, top_place, top_place_city
        FROM location_days
        {year_clause}
        ORDER BY distance_meters DESC
        LIMIT 10
        """,
        params,
    ).fetchall()

    # Overall summary
    summary_row = con.execute(
        f"""
        SELECT
            SUM(distance_meters) / 1000.0 AS total_km,
            AVG(distance_meters) / 1000.0 AS avg_km_per_day,
            MAX(distance_meters) / 1000.0 AS max_km,
            COUNT(*) AS days_tracked
        FROM location_days
        {year_clause}
        """,
        params,
    ).fetchone()

    con.close()

    return {
        "yearly":  [dict(r) for r in yearly],
        "monthly": [dict(r) for r in monthly],
        "weekly":  [dict(r) for r in weekly],
        "top_days": [dict(r) for r in top_days],
        "summary": dict(summary_row) if summary_row and summary_row["days_tracked"] else {},
    }


@router.get("/top-places")
def get_top_places(limit: int = 30, year: int | None = None):
    """
    Most visited named places across all history (or a single year).
    Returns place name, city, visit count, and total dwell time.
    """
    con = _conn()
    year_clause = "AND substr(t.date,1,4) = ?" if year else ""
    params: tuple = (str(year),) if year else ()

    rows = con.execute(
        f"""
        SELECT
            t.geocode_name AS place,
            t.geocode_city AS city,
            t.geocode_country AS country,
            COUNT(DISTINCT t.date) AS days,
            COUNT(*) AS visits,
            SUM(
                CASE
                  WHEN t.segment_start IS NOT NULL AND t.segment_end IS NOT NULL
                  THEN (julianday(t.segment_end) - julianday(t.segment_start)) * 86400
                  ELSE 0
                END
            ) AS total_seconds
        FROM tracks t
        WHERE t.geocode_name IS NOT NULL AND t.geocode_name != ''
              {year_clause}
        GROUP BY t.geocode_name
        ORDER BY days DESC, visits DESC
        LIMIT ?
        """,
        params + (limit,),
    ).fetchall()
    con.close()

    result = []
    for r in rows:
        result.append({
            "place": r["place"],
            "city": r["city"],
            "country": _en(r["country"]),
            "days": r["days"],
            "visits": r["visits"],
            "total_hours": round((r["total_seconds"] or 0) / 3600, 1),
        })
    return result


@router.get("/city-timeline")
def get_city_timeline(year: int | None = None):
    """
    Chronological travel log: each city stay as {city, country, first_date, last_date, days}.
    Merges visits + tracks. Ordered by first_date descending.
    """
    con = _conn()
    year_clause = "AND substr(date, 1, 4) = ?" if year else ""
    params: tuple = (str(year),) if year else ()

    try:
        rows = con.execute(
            f"""
            SELECT city, country, date FROM (
                SELECT p.city, p.country, substr(v.date,1,10) AS date
                FROM   visits v JOIN places p ON p.id = v.place_id
                WHERE  p.city IS NOT NULL AND p.city != ''
                       {year_clause}
                UNION ALL
                SELECT t.geocode_city AS city, t.geocode_country AS country, substr(t.date,1,10) AS date
                FROM   tracks t
                WHERE  t.geocode_city IS NOT NULL AND t.geocode_city != ''
                       {year_clause}
            )
            GROUP BY city, country, date
            ORDER BY date
            """,
            params + params,
        ).fetchall()
    except Exception:
        con.close()
        return []

    # Collapse consecutive days in same city into stays
    stays: list[dict] = []
    for r in rows:
        city, country, date = r["city"], _en(r["country"]), r["date"]
        if stays and stays[-1]["city"] == city and stays[-1]["country"] == country:
            stays[-1]["last_date"] = date
            stays[-1]["days"] += 1
        else:
            stays.append({"city": city, "country": country, "first_date": date, "last_date": date, "days": 1})

    con.close()
    return list(reversed(stays))


@router.get("/place-dates")
def get_place_dates(place: str, year: int | None = None):
    """
    All dates a named place was visited, with mood/energy from that day.
    """
    con = _conn()
    year_clause = "AND substr(t.date,1,4) = ?" if year else ""
    params: tuple = (str(year),) if year else ()

    try:
        rows = con.execute(
            f"""
            SELECT DISTINCT substr(t.date,1,10) AS date,
                   t.geocode_city AS city,
                   t.geocode_country AS country
            FROM   tracks t
            WHERE  t.geocode_name = ?
                   {year_clause}
            ORDER BY date DESC
            LIMIT 100
            """,
            (place,) + params,
        ).fetchall()
    except Exception:
        con.close()
        return []

    if not rows:
        con.close()
        return []

    dates = [r["date"] for r in rows]
    placeholders = ",".join("?" * len(dates))
    try:
        day_rows = con.execute(
            f"SELECT date, mood, energy, mood_note FROM days WHERE date IN ({placeholders})",
            dates,
        ).fetchall()
    except Exception:
        day_rows = []

    day_map = {r["date"]: dict(r) for r in day_rows}
    con.close()

    result = []
    for r in rows:
        d = r["date"]
        day = day_map.get(d, {})
        result.append({
            "date": d,
            "city": r["city"],
            "country": _en(r["country"]),
            "mood": day.get("mood"),
            "energy": day.get("energy"),
            "mood_note": day.get("mood_note"),
        })
    return result


# ── Overland ingestion ────────────────────────────────────────────────────────

OVERLAND_SCHEMA = """
CREATE TABLE IF NOT EXISTS overland_locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    lat         REAL    NOT NULL,
    lng         REAL    NOT NULL,
    altitude    REAL,
    speed       REAL,
    course      REAL,
    h_accuracy  REAL,
    v_accuracy  REAL,
    battery     REAL,
    wifi        TEXT,
    motion      TEXT,
    processed   INTEGER NOT NULL DEFAULT 0,
    raw_json    TEXT    NOT NULL,
    UNIQUE(recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_overland_date      ON overland_locations(date);
CREATE INDEX IF NOT EXISTS idx_overland_ts        ON overland_locations(recorded_at);
CREATE INDEX IF NOT EXISTS idx_overland_processed ON overland_locations(processed);
"""


def _ensure_overland_schema(con: sqlite3.Connection) -> None:
    # Migrate existing table first, before running CREATE TABLE IF NOT EXISTS
    cols = {r[1] for r in con.execute("PRAGMA table_info(overland_locations)")}
    if cols and "processed" not in cols:
        con.execute(
            "ALTER TABLE overland_locations ADD COLUMN processed INTEGER NOT NULL DEFAULT 0"
        )
        con.commit()
    con.executescript(OVERLAND_SCHEMA)
    con.commit()


def _overland_token() -> str | None:
    import os
    return os.environ.get("OVERLAND_TOKEN") or None


def _run_processor(dates: set[str]) -> None:
    """Called in a background task after each ingest batch."""
    from domains.locations.overland_process import process
    for date in sorted(dates):
        try:
            process(date_filter=date, geocode=True)
        except Exception as e:
            print(f"[overland_process] error for {date}: {e}")


@router.post("/manual-visit")
async def add_manual_visit(request: Request):
    """
    Save a manually pinned location for today or yesterday only.
    Body: {date, lat, lng, place_name?, city?, arrived_at?, departed_at?}
    """
    from datetime import date as _date, timedelta
    body = await request.json()
    date_str = body.get("date", "")
    lat = body.get("lat")
    lng = body.get("lng")

    today = _date.today().isoformat()
    yesterday = (_date.today() - timedelta(days=1)).isoformat()
    if date_str not in (today, yesterday):
        raise HTTPException(status_code=400, detail="Manual visits only allowed for today or yesterday")
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="lat and lng required")

    place_name = body.get("place_name")
    city = body.get("city")
    country = body.get("country")

    # Reverse-geocode if no name provided
    if not place_name:
        try:
            import urllib.parse, urllib.request, json as _json
            params = urllib.parse.urlencode({
                "lat": lat, "lon": lng,
                "format": "jsonv2", "zoom": 18, "addressdetails": 1,
            })
            req = urllib.request.Request(
                f"https://nominatim.openstreetmap.org/reverse?{params}",
                headers={"User-Agent": "daybook-personal/1.0", "Accept-Language": "en"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                geo = _json.loads(resp.read().decode())
            addr = geo.get("address", {})
            place_name = (
                geo.get("name") or addr.get("amenity") or addr.get("building")
                or addr.get("road") or geo.get("display_name", "").split(",")[0]
            )
            city = city or (
                addr.get("city") or addr.get("town") or addr.get("village")
                or addr.get("municipality") or addr.get("county")
            )
            country = country or addr.get("country")
        except Exception:
            place_name = f"{lat:.4f}, {lng:.4f}"

    arrived_at = body.get("arrived_at") or f"{date_str}T12:00:00Z"
    departed_at = body.get("departed_at") or f"{date_str}T12:30:00Z"
    pts_json = f'[{{"lat":{lat},"lng":{lng}}}]'

    con = _conn()
    con.execute(
        """INSERT OR IGNORE INTO tracks
             (date, segment_start, segment_end, points_json,
              geocode_name, geocode_city, geocode_country)
           VALUES (?,?,?,?,?,?,?)""",
        (date_str, arrived_at, departed_at, pts_json, place_name, city, country),
    )
    con.commit()

    # Keep location_days in sync
    from domains.locations.overland_process import _upsert_location_day
    _upsert_location_day(con, date_str)

    con.close()

    return {
        "status": "ok",
        "date": date_str,
        "place_name": place_name,
        "city": city,
        "lat": lat,
        "lng": lng,
    }


@router.post("/ingest/overland")
async def ingest_overland(request: Request, background: BackgroundTasks):
    """
    Receives location batches from the Overland iOS app.
    Saves raw points, then processes them into tracks in the background.
    Returns {"result":"ok"} immediately so Overland doesn't retry.
    """
    expected = _overland_token()
    if expected:
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if token != expected:
            raise HTTPException(status_code=401, detail="Invalid token")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    locations = body.get("locations", [])
    if not locations:
        return {"result": "ok", "saved": 0}

    con = _conn()
    _ensure_overland_schema(con)

    saved = skipped = 0
    affected_dates: set[str] = set()

    for loc in locations:
        try:
            props = loc.get("properties", {})
            coords = loc.get("geometry", {}).get("coordinates", [])
            if len(coords) < 2:
                skipped += 1
                continue

            lng, lat = coords[0], coords[1]
            # Reject null-island (GPS not acquired) and implausible coords
            if lat == 0.0 and lng == 0.0:
                skipped += 1
                continue
            alt = coords[2] if len(coords) > 2 else None

            ts = props.get("timestamp", "")
            if not ts:
                skipped += 1
                continue

            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            recorded_at = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            date = dt.strftime("%Y-%m-%d")

            con.execute(
                """INSERT OR IGNORE INTO overland_locations
                     (recorded_at, date, lat, lng, altitude,
                      speed, course, h_accuracy, v_accuracy,
                      battery, wifi, motion, raw_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    recorded_at, date, lat, lng, alt,
                    props.get("speed"), props.get("course"),
                    props.get("horizontal_accuracy"), props.get("vertical_accuracy"),
                    props.get("battery_level"),
                    props.get("wifi"),
                    json.dumps(props.get("motion", [])),
                    json.dumps(loc),
                ),
            )
            saved += 1
            affected_dates.add(date)
        except Exception:
            skipped += 1

    con.commit()
    con.close()

    # Process new points into tracks after responding to Overland
    if affected_dates:
        background.add_task(_run_processor, affected_dates)

    return {"result": "ok", "saved": saved, "skipped": skipped}


# ── Narrative layer: world coverage, fun facts, trips (Plan Phase B) ──────────

_DAYBOOK_DB = Path(__file__).parents[3] / "infrastructure" / "db" / "daybook.db"
_COUNTRIES_JSON = Path(__file__).parents[3] / "domains" / "locations" / "countries.json"


def _daybook_conn() -> sqlite3.Connection:
    con = sqlite3.connect(_DAYBOOK_DB)
    con.row_factory = sqlite3.Row
    return con


def _country_meta() -> dict[str, dict]:
    with open(_COUNTRIES_JSON) as f:
        data = json.load(f)
    data.pop("_comment", None)
    return data


def _days_by_country(con: sqlite3.Connection) -> dict[str, set[str]]:
    """English country name → set of dates seen there (tracks ∪ visits)."""
    out: dict[str, set[str]] = {}
    for r in con.execute(
        "SELECT date, geocode_country AS c FROM tracks WHERE geocode_country IS NOT NULL"
    ):
        out.setdefault(_en(r["c"]), set()).add(r["date"])
    for r in con.execute(
        """SELECT v.date, p.country AS c
           FROM visits v JOIN place_names p ON p.place_id = v.place_id
           WHERE p.country IS NOT NULL"""
    ):
        out.setdefault(_en(r["c"]), set()).add(r["date"])
    return out


@router.get("/world-coverage")
def world_coverage():
    """Countries visited vs the world: %, continent grouping, per-country detail."""
    con = _conn()
    days_by_country = _days_by_country(con)

    # Cities per country (from both geocode sources)
    cities: dict[str, set[str]] = {}
    for r in con.execute(
        """SELECT geocode_country AS c, geocode_city AS city FROM tracks
           WHERE geocode_country IS NOT NULL AND geocode_city IS NOT NULL
           UNION
           SELECT country AS c, city FROM place_names
           WHERE country IS NOT NULL AND city IS NOT NULL"""
    ):
        cities.setdefault(_en(r["c"]), set()).add(_norm_city(r["city"]))
    con.close()

    meta = _country_meta()
    details = []
    continents: dict[str, list[str]] = {}
    for country, dates in sorted(days_by_country.items(), key=lambda kv: -len(kv[1])):
        m = meta.get(country, {})
        details.append({
            "country": country,
            "iso2": m.get("iso2"),
            "continent": m.get("continent", "Unknown"),
            "first_visit": min(dates),
            "last_visit": max(dates),
            "total_days": len(dates),
            "cities_visited": len(cities.get(country, set())),
        })
        continents.setdefault(m.get("continent", "Unknown"), []).append(country)

    total = len(meta)
    visited = len(days_by_country)
    all_by_continent: dict[str, int] = {}
    for m in meta.values():
        all_by_continent[m["continent"]] = all_by_continent.get(m["continent"], 0) + 1

    return {
        "countries_visited": visited,
        "countries_total": total,
        "pct_world": round(visited / total * 100, 1) if total else 0,
        "continents": {
            cont: {
                "visited": sorted(continents.get(cont, [])),
                "visited_count": len(continents.get(cont, [])),
                "total": cnt,
            }
            for cont, cnt in sorted(all_by_continent.items())
        },
        "country_details": details,
        "all_countries": {c: m for c, m in sorted(meta.items())},
    }


@router.get("/fun-facts")
def fun_facts():
    """Stat cards: cosmic-scale distances, compass extremes, personal records."""
    from domains.locations.home_base import home_for

    con = _conn()
    cards: list[dict] = []

    def card(label, value, unit, subtitle, icon):
        cards.append({"label": label, "value": value, "unit": unit,
                      "subtitle": subtitle, "icon": icon})

    # ── Cosmic scale ──────────────────────────────────────────────────────
    total_km = 0.0
    if con.execute("SELECT name FROM sqlite_master WHERE name='location_days'").fetchone():
        row = con.execute("SELECT SUM(distance_meters)/1000.0 AS km FROM location_days").fetchone()
        total_km = row["km"] or 0.0
    if total_km > 0:
        card("Around the Earth", round(total_km / 40_075, 2), "laps",
             f"{total_km:,.0f} km tracked lifetime", "🌍")
        card("To the Moon", round(total_km / 384_400 * 100, 1), "% of the way",
             "one-way, 384,400 km", "🌙")
        card("Around the Sun", round(total_km / 149_597_870 * 1000, 3), "‰ of an AU",
             "1 AU = 149.6M km", "☀️")

    # ── Compass extremes (visits ∪ overland) ─────────────────────────────
    def _extreme(col: str, direction: str):
        v = con.execute(
            f"""SELECT v.date, v.lat, v.lng, COALESCE(p.name, p.city, p.country) AS label
                FROM visits v LEFT JOIN place_names p ON p.place_id = v.place_id
                WHERE v.lat IS NOT NULL AND v.lat != 0
                ORDER BY v.{col} {direction} LIMIT 1"""
        ).fetchone()
        o = con.execute(
            f"""SELECT date, lat, lng, NULL AS label FROM overland_locations
                WHERE lat IS NOT NULL ORDER BY {col} {direction} LIMIT 1"""
        ).fetchone()
        cands = [r for r in (v, o) if r is not None]
        if not cands:
            return None
        rev = direction == "DESC"
        return max(cands, key=lambda r: r[col]) if rev else min(cands, key=lambda r: r[col])

    for label, col, direction, icon in [
        ("Northernmost", "lat", "DESC", "⬆️"), ("Southernmost", "lat", "ASC", "⬇️"),
        ("Easternmost", "lng", "DESC", "➡️"), ("Westernmost", "lng", "ASC", "⬅️"),
    ]:
        r = _extreme(col, direction)
        if r:
            place = r["label"] or f"{r['lat']:.3f}, {r['lng']:.3f}"
            card(label, place, "", f"{r['date']} · {r['lat']:.3f}, {r['lng']:.3f}", icon)

    alt = con.execute(
        """SELECT date, MAX(altitude) AS alt FROM overland_locations
           WHERE altitude IS NOT NULL AND altitude < 15000"""
    ).fetchone()
    if alt and alt["alt"]:
        card("Highest point", round(alt["alt"]), "m", f"GPS altitude · {alt['date']}", "⛰️")

    # ── Farthest from home (per-day centroid vs the home active that day) ─
    day_rows = con.execute(
        """SELECT date, AVG(lat) AS lat, AVG(lng) AS lng FROM visits
           WHERE lat IS NOT NULL GROUP BY date"""
    ).fetchall()
    import math as _math

    def _hav(lat1, lng1, lat2, lng2):
        p1, p2 = _math.radians(lat1), _math.radians(lat2)
        dp, dl = _math.radians(lat2 - lat1), _math.radians(lng2 - lng1)
        a = _math.sin(dp / 2) ** 2 + _math.cos(p1) * _math.cos(p2) * _math.sin(dl / 2) ** 2
        return 2 * 6371 * _math.asin(_math.sqrt(a))

    farthest = None
    for r in day_rows:
        h = home_for(r["date"])
        if h is None:
            continue
        d = _hav(h["lat"], h["lng"], r["lat"], r["lng"])
        if farthest is None or d > farthest[0]:
            farthest = (d, r["date"], h["label"])
    if farthest:
        card("Farthest from home", round(farthest[0]), "km",
             f"{farthest[1]} · home was {farthest[2]}", "🛰️")

    # ── Personal scale ────────────────────────────────────────────────────
    dcon = _daybook_conn()
    run = dcon.execute(
        """SELECT SUM(distance_meters)/1000.0 AS km FROM activities
           WHERE LOWER(COALESCE(activity_type,'')) LIKE '%run%'"""
    ).fetchone()
    dcon.close()
    if run and run["km"]:
        card("Marathons run", round(run["km"] / 42.195, 1), "equivalents",
             f"{run['km']:,.0f} km on foot", "🏃")

    if con.execute("SELECT name FROM sqlite_master WHERE name='location_days'").fetchone():
        top_day = con.execute(
            "SELECT date, distance_meters/1000.0 AS km FROM location_days ORDER BY distance_meters DESC LIMIT 1"
        ).fetchone()
        if top_day:
            card("Longest day", round(top_day["km"]), "km", top_day["date"], "🚀")
        top_month = con.execute(
            """SELECT substr(date,1,7) AS m, SUM(distance_meters)/1000.0 AS km
               FROM location_days GROUP BY m ORDER BY km DESC LIMIT 1"""
        ).fetchone()
        if top_month:
            card("Biggest month", round(top_month["km"]), "km", top_month["m"], "📅")

    # ── Country diversity (Shannon entropy over days per country) ────────
    days_by_country = _days_by_country(con)
    counts = [len(v) for v in days_by_country.values()]
    n = sum(counts)
    if n > 0 and len(counts) > 1:
        h_val = -sum((c / n) * _math.log(c / n) for c in counts)
        card("Country diversity", round(h_val, 2), "Shannon H",
             f"{len(counts)} countries · higher = more diverse", "🧭")

    # Most consecutive days in a foreign country (vs modal = home country)
    if days_by_country:
        home_country = max(days_by_country.items(), key=lambda kv: len(kv[1]))[0]
        foreign_dates = sorted(set().union(
            *[v for k, v in days_by_country.items() if k != home_country]
        ) - days_by_country.get(home_country, set()))
        best = streak = 0
        prev = None
        from datetime import date as _date, timedelta as _td
        for ds in foreign_dates:
            d = _date.fromisoformat(ds)
            streak = streak + 1 if prev is not None and d - prev == _td(days=1) else 1
            best = max(best, streak)
            prev = d
        if best >= 2:
            card("Longest stretch abroad", best, "days",
                 f"consecutive days outside {home_country}", "🧳")

    con.close()
    return {"cards": cards}


@router.get("/trips")
def list_trips(limit: int = 50, offset: int = 0):
    """Auto-detected trips, newest first."""
    con = _daybook_conn()
    if not con.execute("SELECT name FROM sqlite_master WHERE name='trips'").fetchone():
        con.close()
        return {"trips": [], "total": 0}
    total = con.execute("SELECT COUNT(*) AS n FROM trips").fetchone()["n"]
    rows = con.execute(
        """SELECT * FROM trips ORDER BY start_date DESC LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()
    con.close()
    trips = []
    for r in rows:
        t = dict(r)
        t["countries"] = json.loads(t.pop("countries_json") or "[]")
        t["cities"] = json.loads(t.pop("cities_json") or "[]")
        t["name"] = t["user_name"] or t["auto_name"]
        t["countries"] = [_en(c) for c in t["countries"]]
        t["primary_country"] = _en(t["primary_country"])
        n_days = 1 + (
            datetime.fromisoformat(t["end_date"]) - datetime.fromisoformat(t["start_date"])
        ).days
        t["n_days"] = n_days
        trips.append(t)
    return {"trips": trips, "total": total}
