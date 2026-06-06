"""
Weather sync using Open-Meteo (free, no API key needed).
Uses the first GPS point of each day (wake-up location) from Overland to determine
the coordinates for weather fetching — no hardcoded home base needed.

Falls back to the previous day's coordinates if no GPS data exists for a date.

Usage:
    python -m domains.weather.weather_sync              # last 7 days
    python -m domains.weather.weather_sync 2026-05-01   # single date
    python -m domains.weather.weather_sync 2026-05-01 2026-05-22  # date range
"""

import json
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path
import urllib.request as _req

ROOT = Path(__file__).parents[2]
DB_PATH       = ROOT / "infrastructure" / "db" / "daybook.db"
LOCATIONS_DB  = ROOT / "infrastructure" / "db" / "locations.db"

# WMO weather interpretation codes → condition slug
# https://open-meteo.com/en/docs#weathervariables
WMO_TO_CONDITION: dict[int, str] = {
    0: "sunny",    # Clear sky
    1: "sunny",    # Mainly clear
    2: "cloudy",   # Partly cloudy
    3: "cloudy",   # Overcast
    45: "cloudy",  # Fog
    48: "cloudy",  # Icy fog
    51: "rainy",   # Light drizzle
    53: "rainy",   # Moderate drizzle
    55: "rainy",   # Dense drizzle
    61: "rainy",   # Slight rain
    63: "rainy",   # Moderate rain
    65: "rainy",   # Heavy rain
    71: "snowy",   # Slight snow
    73: "snowy",   # Moderate snow
    75: "snowy",   # Heavy snow
    77: "snowy",   # Snow grains
    80: "rainy",   # Slight rain showers
    81: "rainy",   # Moderate rain showers
    82: "rainy",   # Violent rain showers
    85: "snowy",   # Snow showers
    86: "snowy",   # Heavy snow showers
    95: "stormy",  # Thunderstorm
    96: "stormy",  # Thunderstorm with hail
    99: "stormy",  # Thunderstorm with heavy hail
}


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _get_loc_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(LOCATIONS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _wakeup_coords(date_str: str) -> tuple[float, float] | None:
    """Return (lat, lon) of the first GPS point recorded on date_str from Overland."""
    loc = _get_loc_conn()
    # First point of the day from raw Overland pings
    row = loc.execute(
        """SELECT lat, lng FROM overland_locations
           WHERE date = ?
           ORDER BY recorded_at ASC
           LIMIT 1""",
        (date_str,),
    ).fetchone()
    loc.close()
    if row:
        return float(row["lat"]), float(row["lng"])

    # Fallback: first point in tracks table (from points_json)
    loc = _get_loc_conn()
    row = loc.execute(
        """SELECT points_json FROM tracks
           WHERE date = ?
           ORDER BY segment_start ASC
           LIMIT 1""",
        (date_str,),
    ).fetchone()
    loc.close()
    if row:
        pts = json.loads(row["points_json"])
        if pts:
            return float(pts[0]["lat"]), float(pts[0]["lng"])
    return None


def _find_coords_for_date(date_str: str, all_dates: list[str]) -> tuple[float, float] | None:
    """Get coords for date, falling back to nearest previous date that has data."""
    coords = _wakeup_coords(date_str)
    if coords:
        return coords
    # Walk backwards through the date list to find the last known location
    idx = all_dates.index(date_str) if date_str in all_dates else -1
    for i in range(idx - 1, -1, -1):
        coords = _wakeup_coords(all_dates[i])
        if coords:
            print(f"  ! No GPS for {date_str}, using coords from {all_dates[i]}")
            return coords
    return None


def fetch_weather(date_str: str, lat: float, lon: float) -> dict | None:
    """Fetch daily weather from Open-Meteo for a single date.
    Uses the archive endpoint for past dates, forecast for today/future."""
    from datetime import date as _date
    is_past = date_str < _date.today().isoformat()
    base = "https://archive-api.open-meteo.com/v1/archive" if is_past else "https://api.open-meteo.com/v1/forecast"
    url = (
        f"{base}"
        f"?latitude={lat}&longitude={lon}"
        f"&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean"
        f",precipitation_sum,wind_speed_10m_max,weather_code"
        f"&timezone=auto"
        f"&start_date={date_str}&end_date={date_str}"
    )
    try:
        with _req.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  ! fetch failed for {date_str}: {e}")
        return None

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    if not dates:
        return None

    code = daily["weather_code"][0]
    return {
        "date": date_str,
        "temp_min": daily["temperature_2m_min"][0],
        "temp_max": daily["temperature_2m_max"][0],
        "temp_mean": daily["temperature_2m_mean"][0],
        "precipitation": daily["precipitation_sum"][0],
        "wind_speed_max": daily["wind_speed_10m_max"][0],
        "weather_code": code,
        "condition": WMO_TO_CONDITION.get(code, "cloudy"),
        "raw_payload": json.dumps({k: daily[k][0] for k in daily if k != "time"}),
    }


def _ensure_weather_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS weather (
            date            TEXT PRIMARY KEY,
            temp_min        REAL,
            temp_max        REAL,
            temp_mean       REAL,
            precipitation   REAL,
            wind_speed_max  REAL,
            weather_code    INTEGER,
            condition       TEXT,
            raw_payload     TEXT,
            fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_weather_date ON weather(date)")
    conn.commit()


def _auto_tag(conn: sqlite3.Connection, date_str: str, condition: str) -> None:
    """Insert a weather condition tag into day_tags for the given date."""
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))
    tag_row = conn.execute(
        "SELECT id FROM tags WHERE slug = ?", (condition,)
    ).fetchone()
    if not tag_row:
        return
    # Remove any previous weather condition tags for this date first
    weather_slugs = list(WMO_TO_CONDITION.values())
    placeholders = ",".join("?" * len(weather_slugs))
    conn.execute(
        f"""DELETE FROM day_tags WHERE date=? AND tag_id IN (
               SELECT id FROM tags WHERE slug IN ({placeholders})
           )""",
        [date_str] + weather_slugs,
    )
    conn.execute(
        "INSERT OR IGNORE INTO day_tags (date, tag_id) VALUES (?, ?)",
        (date_str, tag_row["id"]),
    )


def sync(start: str, end: str) -> None:
    conn = _get_conn()
    _ensure_weather_table(conn)

    # Build list of all dates in range
    start_d = date.fromisoformat(start)
    end_d   = date.fromisoformat(end)
    all_dates = []
    d = start_d
    while d <= end_d:
        all_dates.append(d.isoformat())
        d += timedelta(days=1)

    inserted = 0
    skipped  = 0
    for date_str in all_dates:
        coords = _find_coords_for_date(date_str, all_dates)
        if not coords:
            print(f"  – {date_str}: no location data, skipping")
            skipped += 1
            continue

        lat, lon = coords
        row = fetch_weather(date_str, lat, lon)
        if not row:
            skipped += 1
            continue

        conn.execute(
            """INSERT OR REPLACE INTO weather
               (date, temp_min, temp_max, temp_mean, precipitation,
                wind_speed_max, weather_code, condition, raw_payload)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (row["date"], row["temp_min"], row["temp_max"], row["temp_mean"],
             row["precipitation"], row["wind_speed_max"], row["weather_code"],
             row["condition"], row["raw_payload"]),
        )
        _auto_tag(conn, date_str, row["condition"])
        temp = f"{row['temp_mean']:.1f}°C" if row["temp_mean"] is not None else "?°C"
        print(f"  ✓ {date_str}: {row['condition']} {temp} @ ({lat:.3f},{lon:.3f})")
        inserted += 1

    conn.commit()
    conn.close()
    print(f"\nDone: {inserted} stored, {skipped} skipped")


if __name__ == "__main__":
    args = sys.argv[1:]
    today = date.today().isoformat()
    if len(args) == 0:
        start_date = (date.today() - timedelta(days=6)).isoformat()
        end_date = today
    elif len(args) == 1:
        start_date = end_date = args[0]
    else:
        start_date, end_date = args[0], args[1]
    sync(start_date, end_date)
