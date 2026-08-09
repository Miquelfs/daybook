"""
Contextual stress/HR analysis for a day, using the CIRQA intraday signals:

- flight_phases(date): for each flight you flew, the HR & stress in the
  takeoff and approach/landing windows vs the day's baseline (median) — so you
  can see the spike, per airport, and whether YOU flew that leg.
- stress_by_place(date): the day's stress split by where you were
  (in-flight / airport / home / elsewhere), joining intraday stress to the
  Overland GPS track by time.

Times: intraday_stress / intraday_hr are stored local HH:MM; flight and GPS
timestamps are UTC, localized with the day's captured utc_offset_min.
"""

import math
import sqlite3
import statistics
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

_REPO = Path(__file__).parents[2]
_LOCATIONS_DB = _REPO / "infrastructure" / "db" / "locations.db"

try:
    from domains.aviation.aviation_config import PILOT_CODE
except Exception:
    PILOT_CODE = "FARMIQ"


def _offset_min(conn, date: str) -> int:
    row = conn.execute("SELECT utc_offset_min FROM wellness_daily WHERE date=?", (date,)).fetchone()
    return row["utc_offset_min"] if row and row["utc_offset_min"] is not None else 0


def _iso_to_local_min(iso: Optional[str], off: int) -> Optional[int]:
    if not iso:
        return None
    try:
        dt = datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S") + timedelta(minutes=off)
        return dt.hour * 60 + dt.minute
    except Exception:
        return None


def _series_min(conn, table: str, col: str, date: str) -> dict[int, float]:
    out: dict[int, float] = {}
    try:
        for r in conn.execute(f"SELECT time, {col} AS v FROM {table} WHERE date=?", (date,)):
            h, m = r["time"].split(":")
            out[int(h) * 60 + int(m)] = float(r["v"])
    except sqlite3.OperationalError:
        pass
    return out


def _window_avg(series: dict[int, float], lo: int, hi: int) -> Optional[float]:
    vals = [v for mn, v in series.items() if lo <= mn <= hi]
    return round(sum(vals) / len(vals), 1) if vals else None


def flight_phases(conn, date: str) -> list[dict]:
    off = _offset_min(conn, date)
    hr = _series_min(conn, "intraday_hr", "heart_rate", date)
    stress = _series_min(conn, "intraday_stress", "level", date)
    if not hr and not stress:
        return []
    med_hr = statistics.median(hr.values()) if hr else None
    med_stress = statistics.median(stress.values()) if stress else None

    def phase(center: Optional[int], pre: int, post: int) -> Optional[dict]:
        if center is None:
            return None
        h = _window_avg(hr, center - pre, center + post)
        s = _window_avg(stress, center - pre, center + post)
        return {
            "hr": h, "stress": s,
            "hr_delta": (round(h - med_hr, 1) if h is not None and med_hr is not None else None),
            "stress_delta": (round(s - med_stress, 1) if s is not None and med_stress is not None else None),
        }

    out = []
    for f in conn.execute(
        "SELECT dep_iata, arr_iata, takeoff_utc, landing_utc, takeoff_crew, landing_crew "
        "FROM flights WHERE date=? AND is_sim=0 ORDER BY takeoff_utc", (date,)
    ):
        tk = _iso_to_local_min(f["takeoff_utc"], off)
        ld = _iso_to_local_min(f["landing_utc"], off)
        out.append({
            "leg": f"{f['dep_iata'] or '?'}→{f['arr_iata'] or '?'}",
            "dep": f["dep_iata"], "arr": f["arr_iata"],
            "takeoff": {**(phase(tk, 5, 10) or {}), "you_flew": f["takeoff_crew"] == PILOT_CODE},
            "landing": {**(phase(ld, 15, 2) or {}), "you_flew": f["landing_crew"] == PILOT_CODE},
        })
    return out


def _haversine_km(a_lat, a_lng, b_lat, b_lng) -> float:
    φ1, φ2 = math.radians(a_lat), math.radians(b_lat)
    dφ = math.radians(b_lat - a_lat)
    dλ = math.radians(b_lng - a_lng)
    x = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1, math.sqrt(x)))


def stress_by_place(conn, date: str) -> dict:
    off = _offset_min(conn, date)
    stress = _series_min(conn, "intraday_stress", "level", date)
    if not stress:
        return {"date": date, "buckets": [], "has_data": False}

    # Flight spans (local minutes) for the day.
    spans = []
    for f in conn.execute(
        "SELECT takeoff_utc, landing_utc, off_block_utc, on_block_utc FROM flights WHERE date=? AND is_sim=0", (date,)
    ):
        s = _iso_to_local_min(f["off_block_utc"], off) or _iso_to_local_min(f["takeoff_utc"], off)
        e = _iso_to_local_min(f["on_block_utc"], off) or _iso_to_local_min(f["landing_utc"], off)
        if s is not None and e is not None:
            spans.append((s, e))

    # Airports with coordinates (daybook.db) — for the "airport" bucket.
    airports = [(r["latitude"], r["longitude"]) for r in conn.execute(
        "SELECT latitude, longitude FROM airports WHERE latitude IS NOT NULL AND longitude IS NOT NULL")]

    # GPS points for the day (locations.db), localized to minute.
    gps: list[tuple[int, float, float]] = []
    try:
        lc = sqlite3.connect(_LOCATIONS_DB)
        lc.row_factory = sqlite3.Row
        for r in lc.execute("SELECT recorded_at, lat, lng FROM overland_locations WHERE date=?", (date,)):
            mn = _iso_to_local_min(r["recorded_at"], off)
            if mn is not None and r["lat"] is not None:
                gps.append((mn, r["lat"], r["lng"]))
        lc.close()
    except Exception:
        pass
    gps.sort()

    # Home centroid active on the date.
    home = None
    try:
        from domains.locations.home_base import home_for
        home = home_for(date)
    except Exception:
        pass

    def nearest_gps(mn: int):
        if not gps:
            return None
        best = min(gps, key=lambda g: abs(g[0] - mn))
        return best if abs(best[0] - mn) <= 30 else None  # within 30 min

    def classify(mn: int) -> str:
        for s, e in spans:
            if s <= mn <= e:
                return "in-flight"
        g = nearest_gps(mn)
        if not g:
            return "unknown"
        _, lat, lng = g
        if any(_haversine_km(lat, lng, alat, alng) <= 3 for alat, alng in airports):
            return "airport"
        if home and home.get("centroid_lat") is not None:
            if _haversine_km(lat, lng, home["centroid_lat"], home["centroid_lng"]) <= (home.get("home_radius_km") or 3):
                return "home"
        return "elsewhere"

    buckets: dict[str, list[float]] = {}
    for mn, level in stress.items():
        buckets.setdefault(classify(mn), []).append(level)

    result = [
        {"place": k, "avg_stress": round(sum(v) / len(v)), "minutes": len(v) * 3}
        for k, v in buckets.items() if k != "unknown"
    ]
    result.sort(key=lambda b: b["avg_stress"], reverse=True)
    return {"date": date, "buckets": result, "has_data": True}
