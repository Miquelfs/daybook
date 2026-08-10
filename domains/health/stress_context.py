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
    """UTC timestamp → local minute-of-day. Accepts full ISO (T/space/Z) and
    bare 'HH:MM' UTC time-of-day (how some flights store off/takeoff/landing)."""
    if not iso:
        return None
    s = iso.strip()
    try:
        if len(s) <= 5 and ":" in s:  # bare HH:MM UTC
            h, m = s.split(":")[:2]
            base = int(h) * 60 + int(m)
        else:
            dt = datetime.strptime(s[:19].replace(" ", "T"), "%Y-%m-%dT%H:%M:%S")
            base = dt.hour * 60 + dt.minute
        return (base + off) % 1440
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


def _phases_for_rows(conn, date: str, rows) -> list[dict]:
    off = _offset_min(conn, date)
    hr = _series_min(conn, "intraday_hr", "heart_rate", date)
    stress = _series_min(conn, "intraday_stress", "level", date)
    if not hr and not stress:
        return []
    med_hr = statistics.median(hr.values()) if hr else None
    med_stress = statistics.median(stress.values()) if stress else None

    def phase(center: Optional[int], pre: int, post: int) -> dict:
        if center is None:
            return {}
        h = _window_avg(hr, center - pre, center + post)
        s = _window_avg(stress, center - pre, center + post)
        return {
            "hr": h, "stress": s,
            "hr_delta": (round(h - med_hr, 1) if h is not None and med_hr is not None else None),
            "stress_delta": (round(s - med_stress, 1) if s is not None and med_stress is not None else None),
        }

    out = []
    for f in rows:
        tk = _iso_to_local_min(f["takeoff_utc"], off)
        ld = _iso_to_local_min(f["landing_utc"], off)
        out.append({
            "leg": f"{f['dep_iata'] or '?'}→{f['arr_iata'] or '?'}",
            "dep": f["dep_iata"], "arr": f["arr_iata"],
            "takeoff": {**phase(tk, 5, 10), "you_flew": f["takeoff_crew"] == PILOT_CODE},
            "landing": {**phase(ld, 15, 2), "you_flew": f["landing_crew"] == PILOT_CODE},
        })
    return out


_FLIGHT_COLS = "dep_iata, arr_iata, takeoff_utc, landing_utc, takeoff_crew, landing_crew"


def flight_phases(conn, date: str) -> list[dict]:
    rows = conn.execute(
        f"SELECT {_FLIGHT_COLS} FROM flights WHERE date=? AND is_sim=0 ORDER BY takeoff_utc", (date,)
    ).fetchall()
    return _phases_for_rows(conn, date, rows)


def flight_phase_by_id(conn, flight_id) -> Optional[dict]:
    f = conn.execute(
        f"SELECT date, {_FLIGHT_COLS} FROM flights WHERE id=? AND is_sim=0", (flight_id,)
    ).fetchone()
    if not f:
        return None
    res = _phases_for_rows(conn, f["date"], [f])
    return res[0] if res else None


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

    # Exercise spans (activities) — a run's high reading is effort, not life stress.
    ex_spans = []
    for a in conn.execute(
        "SELECT start_time, duration_seconds FROM activities WHERE date=?", (date,)
    ):
        s = _iso_to_local_min(a["start_time"], off)
        if s is None:
            continue
        e = s + int((a["duration_seconds"] or 0) // 60)
        ex_spans.append((s, e))

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
        for s, e in ex_spans:
            if s <= mn <= e:
                return "exercise"
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


def persist_stress_contexts(conn, date: str) -> int:
    """Snapshot the day's stress-by-context into stress_context_daily. Rows written."""
    day = stress_by_place(conn, date)
    conn.execute("DELETE FROM stress_context_daily WHERE date=?", (date,))
    n = 0
    for b in day.get("buckets", []):
        conn.execute(
            "INSERT INTO stress_context_daily (date, context, avg_stress, minutes, updated_at) "
            "VALUES (?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now')) "
            "ON CONFLICT(date, context) DO UPDATE SET "
            "avg_stress=excluded.avg_stress, minutes=excluded.minutes, updated_at=excluded.updated_at",
            (date, b["place"], b["avg_stress"], b["minutes"]),
        )
        n += 1
    conn.commit()
    return n


def stress_contexts_rollup(conn, days: int = 90) -> dict:
    """Life-wide 'what makes you stressed' — minute-weighted avg stress per context."""
    rows = conn.execute(
        "SELECT context, avg_stress, minutes, date FROM stress_context_daily "
        "WHERE date >= date('now', ?)",
        (f"-{days} days",),
    ).fetchall()
    agg: dict[str, dict] = {}
    for r in rows:
        a = agg.setdefault(r["context"], {"weighted": 0.0, "minutes": 0, "days": set()})
        a["weighted"] += (r["avg_stress"] or 0) * (r["minutes"] or 0)
        a["minutes"] += (r["minutes"] or 0)
        a["days"].add(r["date"])
    out = [
        {"context": k, "avg_stress": round(v["weighted"] / v["minutes"]),
         "minutes": v["minutes"], "days": len(v["days"])}
        for k, v in agg.items() if v["minutes"] > 0
    ]
    out.sort(key=lambda b: b["avg_stress"], reverse=True)
    return {"days": days, "contexts": out, "has_data": bool(out)}


def _local_min_of(iso_local: Optional[str]) -> Optional[int]:
    """Minute-of-day from a LOCAL ISO timestamp (Overland visits are already local)."""
    if not iso_local or len(iso_local) < 16:
        return None
    try:
        h, m = int(iso_local[11:13]), int(iso_local[14:16])
        return h * 60 + m
    except Exception:
        return None


def stress_by_city_day(conn, date: str) -> list[dict]:
    """The day's stress split by the specific city you were in (Overland visits
    → place_names geocode). Both intraday stress and visits are local time."""
    stress = _series_min(conn, "intraday_stress", "level", date)
    if not stress:
        return []

    # City spans for the day, from the visits + geocode (locations.db).
    spans: list[tuple[int, int, str, Optional[str]]] = []
    try:
        lc = sqlite3.connect(_LOCATIONS_DB)
        lc.row_factory = sqlite3.Row
        for r in lc.execute(
            """SELECT v.start_time, v.end_time, pn.city, pn.country
               FROM visits v JOIN place_names pn ON pn.place_id = v.place_id
               WHERE v.date = ? AND pn.city IS NOT NULL AND pn.city <> ''""",
            (date,),
        ):
            s = _local_min_of(r["start_time"])
            e = _local_min_of(r["end_time"])
            if s is None:
                continue
            if e is None or e < s:
                e = 1440  # visit ran past midnight — clamp to end of this day
            spans.append((s, e, r["city"], r["country"]))
        lc.close()
    except Exception:
        return []
    if not spans:
        return []

    buckets: dict[str, dict] = {}
    for mn, level in stress.items():
        city = country = None
        for s, e, c, co in spans:
            if s <= mn <= e:
                city, country = c, co
                break
        if not city:
            continue
        b = buckets.setdefault(city, {"levels": [], "country": country})
        b["levels"].append(level)

    result = [
        {"city": k, "country": v["country"], "avg_stress": round(sum(v["levels"]) / len(v["levels"])),
         "minutes": len(v["levels"]) * 3}
        for k, v in buckets.items()
    ]
    result.sort(key=lambda b: b["avg_stress"], reverse=True)
    return result


def persist_stress_places(conn, date: str) -> int:
    """Snapshot the day's stress-by-city into stress_place_daily."""
    rows = stress_by_city_day(conn, date)
    conn.execute("DELETE FROM stress_place_daily WHERE date=?", (date,))
    for b in rows:
        conn.execute(
            "INSERT INTO stress_place_daily (date, city, country, avg_stress, minutes, updated_at) "
            "VALUES (?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now')) "
            "ON CONFLICT(date, city) DO UPDATE SET country=excluded.country, "
            "avg_stress=excluded.avg_stress, minutes=excluded.minutes, updated_at=excluded.updated_at",
            (date, b["city"], b["country"], b["avg_stress"], b["minutes"]),
        )
    conn.commit()
    return len(rows)


def stress_by_city_rollup(conn, days: int = 180, min_minutes: int = 30) -> dict:
    """Life-wide 'which cities stress me' — minute-weighted avg stress per city."""
    rows = conn.execute(
        "SELECT city, country, avg_stress, minutes, date FROM stress_place_daily "
        "WHERE date >= date('now', ?)",
        (f"-{days} days",),
    ).fetchall()
    agg: dict[str, dict] = {}
    for r in rows:
        a = agg.setdefault(r["city"], {"weighted": 0.0, "minutes": 0, "days": set(), "country": r["country"]})
        a["weighted"] += (r["avg_stress"] or 0) * (r["minutes"] or 0)
        a["minutes"] += (r["minutes"] or 0)
        a["days"].add(r["date"])
    out = [
        {"city": k, "country": v["country"], "avg_stress": round(v["weighted"] / v["minutes"]),
         "minutes": v["minutes"], "days": len(v["days"])}
        for k, v in agg.items() if v["minutes"] >= min_minutes
    ]
    out.sort(key=lambda b: b["avg_stress"], reverse=True)
    return {"days": days, "cities": out, "has_data": bool(out)}


if __name__ == "__main__":
    import argparse
    from infrastructure.db.connection import get_connection

    ap = argparse.ArgumentParser(description="Persist stress-by-context for correlations.")
    ap.add_argument("--date", help="single date YYYY-MM-DD")
    ap.add_argument("--days", type=int, default=120, help="backfill window when no --date")
    args = ap.parse_args()

    conn = get_connection()
    conn.row_factory = sqlite3.Row
    if args.date:
        c = persist_stress_contexts(conn, args.date)
        p = persist_stress_places(conn, args.date)
        print(f"stress: wrote {c} context + {p} city row(s) for {args.date}")
    else:
        dates = [r[0] for r in conn.execute(
            "SELECT DISTINCT date FROM intraday_stress WHERE date >= date('now', ?) ORDER BY date",
            (f"-{args.days} days",))]
        tc = sum(persist_stress_contexts(conn, d) for d in dates)
        tp = sum(persist_stress_places(conn, d) for d in dates)
        print(f"stress: wrote {tc} context + {tp} city row(s) over {len(dates)} day(s)")
    conn.close()
