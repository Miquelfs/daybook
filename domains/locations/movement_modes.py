"""
How you moved, per day and by mode — so movement stats aren't swamped by flights (one flying
day used to outweigh a month on foot).

  on foot · run · bike · vehicle (car, bus, train, metro, ferry…) · flight

Two eras:
  - Google timeline (until it stopped, 2026-05): its own `movements` table already says how.
  - Overland (since): tracks carry no mode. The day's GPS points are chained in time order;
    a hop of > 300 km, or > 30 km above 160 km/h, is a flight, a fast short jump is GPS noise (dropped),
    the rest is ground. Running / cycling / walking come from the Garmin activities that day
    (authoritative); whatever ground distance is left is vehicle.

Cached per day in locations.db → movement_days; Overland days are recomputed while recent.
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, datetime, timedelta

MODES = ("foot", "run", "bike", "vehicle", "flight")
GOOGLE = {
    "walking": "foot", "on foot": "foot", "hiking": "foot",
    "running": "run",
    "cycling": "bike",
    "in passenger vehicle": "vehicle", "motorcycling": "vehicle", "in vehicle": "vehicle", "in bus": "vehicle",
    "in train": "vehicle", "in subway": "vehicle", "in tram": "vehicle", "in ferry": "vehicle", "sailing": "vehicle",
    "flying": "flight",
}
# (the docstring's thresholds: > 300 km in one leg or > 30 km above 160 km/h counts as flying)
FLIGHT_KM, FLIGHT_KMH, NOISE_KMH = 30.0, 160.0, 300.0
LONG_HOP_KM = 300.0             # one leg / one gap this long is a flight (phone off in the air)
# Google mislabels: a "walk" at car speed, a "drive" at airliner speed — re-read by speed (km/h caps)
MAX_KMH = {"foot": 9.0, "run": 25.0, "bike": 50.0, "vehicle": FLIGHT_KMH}
STRIDE_M = 0.75                 # steps → km on foot, for the days only Overland + Garmin know
RECENT_DAYS = 3


def _km(a, b) -> float:
    r = 6371.0
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dla, dlo = la2 - la1, math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def ensure_table(con: sqlite3.Connection) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS movement_days (
        date TEXT PRIMARY KEY, foot_km REAL, run_km REAL, bike_km REAL, vehicle_km REAL, flight_km REAL,
        source TEXT, computed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def overland_day(rows) -> dict[str, float]:
    """rows: (segment_start, points_json) for one day → ground / flight km."""
    pts: list[tuple[datetime, tuple[float, float]]] = []
    for start, pj in rows:
        try:
            t0 = _ts(start)
            for p in json.loads(pj):
                if "lat" in p and "lng" in p:
                    pts.append((t0 + timedelta(seconds=float(p.get("t") or 0)), (p["lat"], p["lng"])))
        except (ValueError, TypeError):
            continue
    pts.sort(key=lambda x: x[0])
    ground = flight = 0.0
    for (ta, a), (tb, b) in zip(pts, pts[1:]):
        d = _km(a, b)
        dt_h = max((tb - ta).total_seconds(), 1) / 3600
        speed = d / dt_h
        if d > LONG_HOP_KM or (d > FLIGHT_KM and speed > FLIGHT_KMH):
            flight += d
        elif speed > NOISE_KMH:
            continue                                   # a GPS jump, not travel
        else:
            ground += d
    return {"ground": ground, "flight": flight}


def _garmin_day(day_con: sqlite3.Connection | None, d: str) -> dict[str, float]:
    out = {"foot": 0.0, "run": 0.0, "bike": 0.0}
    if day_con is None:
        return out
    steps = None
    try:
        r = day_con.execute("SELECT steps FROM daily_stats WHERE date = ?", (d,)).fetchone()
        steps = r[0] if r else None
    except sqlite3.OperationalError:
        steps = None
    try:
        rows = day_con.execute("SELECT activity_type, distance_meters FROM activities WHERE date = ? "
                               "AND distance_meters > 0", (d,)).fetchall()
    except sqlite3.OperationalError:
        return out
    for t, m in rows:
        t = (t or "").lower()
        if any(k in t for k in ("indoor", "virtual", "trainer", "treadmill")):
            continue
        if any(k in t for k in ("cycl", "bik", "ride")):
            out["bike"] += m / 1000
        elif any(k in t for k in ("run", "jog")):
            out["run"] += m / 1000
        elif any(k in t for k in ("walk", "hik", "trek")):
            out["foot"] += m / 1000
    if steps:                                           # everyday walking: steps that weren't the run
        out["foot"] = max(out["foot"], steps * STRIDE_M / 1000 - out["run"])
    return out


def refresh(con: sqlite3.Connection, day_con: sqlite3.Connection | None = None) -> int:
    """Fill movement_days for days not yet done (and recompute the last few Overland days)."""
    ensure_table(con)
    done = {r[0] for r in con.execute("SELECT date FROM movement_days")}
    n = 0
    # Google era — each movement by its label, corrected by its speed
    try:
        g = con.execute("SELECT date, activity_type, distance_meters, start_time, end_time FROM movements "
                        "WHERE distance_meters > 0").fetchall()
    except sqlite3.OperationalError:
        g = []
    gdays: dict[str, dict[str, float]] = {}
    for d, t, m, s, e in g:
        mode = GOOGLE.get((t or "").lower(), "vehicle" if (t or "").lower() == "unknown" else None)
        if not mode:
            continue
        km = (m or 0) / 1000
        try:
            hours = max((_ts(e) - _ts(s)).total_seconds(), 60) / 3600
        except (ValueError, TypeError, AttributeError):
            hours = None
        if hours:
            v = km / hours
            if km > LONG_HOP_KM or (km > FLIGHT_KM and v > FLIGHT_KMH):
                mode = "flight"
            elif mode != "flight" and v > MAX_KMH[mode]:
                mode = "vehicle" if v <= FLIGHT_KMH else None
            if mode is None:
                continue
        gdays.setdefault(d, dict.fromkeys(MODES, 0.0))[mode] += km
    for d, v in gdays.items():
        if d in done:
            continue
        con.execute("INSERT OR REPLACE INTO movement_days (date, foot_km, run_km, bike_km, vehicle_km, flight_km, source) "
                    "VALUES (?,?,?,?,?,?, 'google')", (d, *(round(v[m], 2) for m in MODES)))
        n += 1
    # Overland era — the days Google doesn't cover
    recent = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    try:
        tdays = [r[0] for r in con.execute("SELECT DISTINCT date FROM tracks ORDER BY date")]
    except sqlite3.OperationalError:
        tdays = []
    for d in tdays:
        if d in gdays or (d in done and d < recent):
            continue
        rows = con.execute("SELECT segment_start, points_json FROM tracks WHERE date = ? ORDER BY segment_start",
                           (d,)).fetchall()
        o = overland_day(rows)
        a = _garmin_day(day_con, d)
        sport = a["foot"] + a["run"] + a["bike"]
        con.execute("INSERT OR REPLACE INTO movement_days (date, foot_km, run_km, bike_km, vehicle_km, flight_km, source) "
                    "VALUES (?,?,?,?,?,?, 'overland')",
                    (d, round(a["foot"], 2), round(a["run"], 2), round(a["bike"], 2),
                     round(max(0.0, o["ground"] - sport), 2), round(o["flight"], 2)))
        n += 1
    con.commit()
    return n


def stats(con: sqlite3.Connection, year: int | None = None) -> dict:
    """Totals, per-month and per-year by mode, records, and the busiest ground days."""
    where, params = ("WHERE substr(date,1,4) = ?", (str(year),)) if year else ("", ())
    cols = ", ".join(f"SUM({m}_km)" for m in MODES)
    tot = con.execute(f"SELECT COUNT(*), {cols} FROM movement_days {where}", params).fetchone()
    if not tot or not tot[0]:
        return {"days": 0, "totals": {}, "monthly": [], "yearly": [], "records": {}, "top_ground_days": []}
    totals = {m: round(tot[i + 1] or 0, 1) for i, m in enumerate(MODES)}

    def series(key: str, n: int) -> list[dict]:
        rows = con.execute(f"SELECT substr(date,1,{n}) AS k, COUNT(*), {cols} FROM movement_days {where} "
                           f"GROUP BY k ORDER BY k", params).fetchall()
        return [{key: r[0], "days": r[1], **{m: round(r[i + 2] or 0, 1) for i, m in enumerate(MODES)}} for r in rows]

    records = {}
    for m in MODES:
        r = con.execute(f"SELECT date, {m}_km FROM movement_days {where} ORDER BY {m}_km DESC LIMIT 1", params).fetchone()
        if r and r[1]:
            records[m] = {"date": r[0], "km": round(r[1], 1)}
    top = con.execute(
        f"""SELECT date, foot_km, run_km, bike_km, vehicle_km FROM movement_days {where}
            ORDER BY (foot_km + run_km + bike_km + vehicle_km) DESC LIMIT 8""", params).fetchall()
    active_days = con.execute(f"SELECT COUNT(*) FROM movement_days {where + (' AND' if where else 'WHERE')} "
                              "(foot_km + run_km + bike_km) >= 5", params).fetchone()[0]
    return {
        "days": tot[0], "totals": totals,
        "ground_km": round(sum(totals[m] for m in ("foot", "run", "bike", "vehicle")), 1),
        "self_powered_km": round(totals["foot"] + totals["run"] + totals["bike"], 1),
        "active_days": active_days,
        "monthly": series("month", 7), "yearly": series("year", 4), "records": records,
        "top_ground_days": [{"date": r[0], "foot": round(r[1], 1), "run": round(r[2], 1), "bike": round(r[3], 1),
                             "vehicle": round(r[4], 1)} for r in top],
    }
