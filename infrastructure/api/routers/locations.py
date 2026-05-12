import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from domains.locations.locations_query import tracks_for_date

router = APIRouter(prefix="/locations", tags=["locations"])

_DB = Path(__file__).parents[3] / "infrastructure" / "db" / "locations.db"

# Nominatim returns local-language country names; map them to English
_COUNTRY_EN: dict[str, str] = {
    "España": "Spain",
    "Éire / Ireland": "Ireland",
    "México": "Mexico",
    "Lëtzebuerg": "Luxembourg",
    "Maroc ⵍⵎⵖⵔⵉⴱ المغرب": "Morocco",
    "België / Belgique / Belgien": "Belgium",
    "Magyarország": "Hungary",
    "Österreich": "Austria",
    "Civitas Vaticana - Città del Vaticano": "Vatican City",
    "България": "Bulgaria",
    "Ελλάς": "Greece",
    "România": "Romania",
    "Česko": "Czech Republic",
    "Slovensko": "Slovakia",
    "Hrvatska": "Croatia",
    "Slovenija": "Slovenia",
    "Schweiz/Suisse/Svizzera/Svizra": "Switzerland",
    "Nederland": "Netherlands",
    "Polska": "Poland",
    "Türkiye": "Turkey",
    "Россия": "Russia",
    "日本": "Japan",
    "中国": "China",
}


def _en(country: str | None) -> str | None:
    if country is None:
        return None
    return _COUNTRY_EN.get(country, country)


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

    year_clause = "AND substr(v.date,1,4) = ?" if year else ""
    params: tuple = (str(year),) if year else ()

    # Raw heat points from visits (best coverage, 2014-present)
    points = con.execute(
        f"""
        SELECT v.lat, v.lng, COALESCE(v.probability, 0.5) as w
        FROM   visits v
        WHERE  v.lat IS NOT NULL AND v.lng IS NOT NULL
               AND v.lat != 0 AND v.lng != 0
               {year_clause}
        """,
        params,
    ).fetchall()

    # Country rollup
    countries = con.execute(
        f"""
        SELECT p.country, COUNT(DISTINCT substr(v.date,1,10)) as days
        FROM   visits v
        LEFT JOIN place_names p ON p.place_id = v.place_id
        WHERE  p.country IS NOT NULL {year_clause}
        GROUP BY p.country
        ORDER BY days DESC
        """,
        params,
    ).fetchall()

    # City rollup (top 40)
    cities = con.execute(
        f"""
        SELECT p.city, p.country, COUNT(DISTINCT substr(v.date,1,10)) as days
        FROM   visits v
        LEFT JOIN place_names p ON p.place_id = v.place_id
        WHERE  p.city IS NOT NULL {year_clause}
        GROUP BY p.city, p.country
        ORDER BY days DESC
        LIMIT 40
        """,
        params,
    ).fetchall()

    # Available years for the filter pill
    years = con.execute(
        "SELECT DISTINCT substr(date,1,4) as y FROM visits ORDER BY y DESC"
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
        key = (r["city"], _en(r["country"]) or r["country"])
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
    token = os.environ.get("OVERLAND_TOKEN")
    if token:
        return token
    env_file = Path(__file__).parents[3] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("OVERLAND_TOKEN="):
                return line.split("=", 1)[1].strip()
    return None


def _run_processor(dates: set[str]) -> None:
    """Called in a background task after each ingest batch."""
    from domains.locations.overland_process import process
    for date in sorted(dates):
        try:
            process(date_filter=date, geocode=True)
        except Exception as e:
            print(f"[overland_process] error for {date}: {e}")


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
