"""
Ride quality for the 312: are the long rides building durability and fuelling,
and is climbing getting faster?

long_rides(conn, goal_id)
  Completed plan sessions ≥ 2h (or role long/long2) with: actual time, km, climb,
  avg HR, aerobic decoupling (HR drift, activity_detail.decoupling_pct — < 5 % =
  durable) and carbs/h from fueling_logs vs the session's target.

climbs(conn)
  The longest sustained climb in each outdoor ride, found from the stored
  elevation stream: gain, length, grade, time, VAM (vertical m/h), avg HR/W.
  Cached in climb_efforts. VAM is the number that decides the km-97 cut-off:
  Puig Major is ~14 km at ~6 % (~850 m), so minutes ≈ 850 / VAM × 60.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

PUIG_MAJOR_GAIN_M = 850
MIN_GAIN_M = 250           # a "climb" worth benchmarking
MIN_CLIMB_MIN = 12
DESCENT_TOLERANCE_M = 25   # a dip this deep ends the climb
SMOOTH = 5                 # moving-average window over the elevation stream


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


# ── long rides ───────────────────────────────────────────────────────────────

def long_rides(conn: sqlite3.Connection, goal_id: int, days: int = 120, target_fn=None) -> list[dict]:
    t = _tables(conn)
    since = (date.today() - timedelta(days=days)).isoformat()
    has_detail = "activity_detail" in t
    has_fuel = "fueling_logs" in t
    cols = {r[1] for r in conn.execute("PRAGMA table_info(plan_sessions)")}
    role_sql = "ps.role" if "role" in cols else "NULL"
    rows = conn.execute(
        f"""SELECT ps.id, ps.session_date, ps.session_type, ps.duration_min, ps.effective_duration_min,
                   ps.intensity_zone, ps.discipline, {role_sql} AS role, ps.completed_activity_id,
                   a.duration_seconds, a.distance_meters, a.elevation_gain_meters, a.avg_heart_rate
                   {", d.decoupling_pct" if has_detail else ", NULL AS decoupling_pct"}
            FROM plan_sessions ps
            LEFT JOIN activities a ON a.id = ps.completed_activity_id
            {"LEFT JOIN activity_detail d ON d.activity_id = ps.completed_activity_id" if has_detail else ""}
            WHERE ps.goal_id=? AND ps.status='completed' AND ps.session_date >= ?
              AND ps.discipline='cycling'
              AND (COALESCE(ps.effective_duration_min, ps.duration_min) >= 120 OR {role_sql} IN ('long','long2'))
            ORDER BY ps.session_date DESC""",
        (goal_id, since),
    ).fetchall()
    out = []
    for r in rows:
        mins = round(r["duration_seconds"] / 60) if r["duration_seconds"] else (r["effective_duration_min"] or 0)
        carbs = None
        if has_fuel:
            f = conn.execute(
                "SELECT SUM(carbs_g) AS g FROM fueling_logs WHERE plan_session_id=? OR (activity_id IS NOT NULL AND activity_id=?)",
                (r["id"], r["completed_activity_id"]),
            ).fetchone()
            carbs = f["g"] if f and f["g"] else None
        target = target_fn(mins, r["intensity_zone"], r["discipline"]) if target_fn else None
        out.append({
            "session_id": r["id"], "date": r["session_date"], "type": r["session_type"],
            "minutes": mins, "km": round(r["distance_meters"] / 1000, 1) if r["distance_meters"] else None,
            "climb_m": round(r["elevation_gain_meters"]) if r["elevation_gain_meters"] else None,
            "avg_hr": round(r["avg_heart_rate"]) if r["avg_heart_rate"] else None,
            "decoupling_pct": round(r["decoupling_pct"], 1) if r["decoupling_pct"] is not None else None,
            "carbs_g_h": round(carbs / (mins / 60)) if carbs and mins else None,
            "target_carbs_g_h": target,
            "linked": bool(r["completed_activity_id"]),
        })
    return out


# ── climbs ───────────────────────────────────────────────────────────────────

def _smooth(xs: list[float], w: int = SMOOTH) -> list[float]:
    if len(xs) < w:
        return xs
    half = w // 2
    return [sum(xs[max(0, i - half):i + half + 1]) / len(xs[max(0, i - half):i + half + 1]) for i in range(len(xs))]


def best_climb(elev: list, dist: list, secs: list, hr: list | None = None, watts: list | None = None) -> dict | None:
    """Longest sustained climb (by net gain) in one ride's streams, or None."""
    pts = [(e, d, t, (hr[i] if hr and i < len(hr) else None), (watts[i] if watts and i < len(watts) else None))
           for i, (e, d, t) in enumerate(zip(elev, dist, secs))
           if e is not None and d is not None and t is not None]
    if len(pts) < 20:
        return None
    e = _smooth([p[0] for p in pts])
    best = None

    def consider(s: int, top: int):
        nonlocal best
        # Trim a flat run-in: the climb starts where the road last sat at the foot's height.
        s = max((j for j in range(s, top + 1) if e[j] <= e[s] + 3), default=s)
        gain = e[top] - e[s]
        dur = pts[top][2] - pts[s][2]
        if gain < MIN_GAIN_M or dur < MIN_CLIMB_MIN * 60 or (best and gain <= best["gain_m"]):
            return
        seg = pts[s:top + 1]
        hrs = [p[3] for p in seg if p[3]]
        ws = [p[4] for p in seg if p[4]]
        km = (pts[top][1] - pts[s][1]) / 1000
        best = {"gain_m": round(gain), "distance_km": round(km, 1), "duration_min": round(dur / 60, 1),
                "grade_pct": round(gain / (km * 1000) * 100, 1) if km > 0 else None,
                "vam": round(gain / (dur / 3600)),
                "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
                "avg_w": round(sum(ws) / len(ws)) if ws else None}

    # s = foot of the current climb, top = highest point since. A new low moves
    # the foot; a drop of more than DESCENT_TOLERANCE_M below the top ends it.
    s = top = 0
    for i in range(1, len(pts)):
        if e[i] < e[s]:
            s = top = i
        elif e[i] > e[top]:
            top = i
        elif e[top] - e[i] > DESCENT_TOLERANCE_M:
            consider(s, top)
            s = top = i
    consider(s, top)
    return best


def _streams(conn, activity_id: str) -> dict[str, list]:
    rows = conn.execute("SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?",
                        (activity_id,)).fetchall()
    out = {}
    for r in rows:
        try:
            out[r["stream_type"]] = json.loads(r["data_json"])
        except (ValueError, TypeError):
            pass
    return out


def _pick(streams: dict, *names):
    for n in names:
        if streams.get(n):
            return streams[n]
    return None


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS climb_efforts (
        activity_id TEXT PRIMARY KEY, date TEXT, gain_m REAL, distance_km REAL, duration_min REAL,
        grade_pct REAL, vam REAL, avg_hr REAL, avg_w REAL,
        computed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")


def climbs(conn: sqlite3.Connection, days: int = 365) -> list[dict]:
    t = _tables(conn)
    if "activities" not in t or "activity_streams" not in t:
        return []
    ensure_table(conn)
    since = (date.today() - timedelta(days=days)).isoformat()
    todo = conn.execute(
        """SELECT a.id, a.date FROM activities a
           WHERE a.date >= ? AND (lower(a.activity_type) LIKE '%cycl%' OR lower(a.activity_type) LIKE '%bik%'
                                  OR lower(a.activity_type) LIKE '%ride%')
             AND lower(a.activity_type) NOT LIKE '%indoor%' AND lower(a.activity_type) NOT LIKE '%virtual%'
             AND COALESCE(a.elevation_gain_meters, 0) >= ?
             AND a.id NOT IN (SELECT activity_id FROM climb_efforts)""",
        (since, MIN_GAIN_M),
    ).fetchall()
    for a in todo:
        st = _streams(conn, a["id"])
        elev = _pick(st, "directelevation", "elevation", "altitude")
        dist = _pick(st, "sumdistance", "distance")
        secs = _pick(st, "sumduration", "sumelapsedduration", "summovingduration", "time")
        c = best_climb(elev, dist, secs, _pick(st, "directheartrate", "heartrate"),
                       _pick(st, "directpower", "power")) if elev and dist and secs else None
        c = c or {}
        conn.execute(
            """INSERT OR REPLACE INTO climb_efforts
               (activity_id, date, gain_m, distance_km, duration_min, grade_pct, vam, avg_hr, avg_w)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (a["id"], a["date"], c.get("gain_m", 0), c.get("distance_km"), c.get("duration_min"),
             c.get("grade_pct"), c.get("vam"), c.get("avg_hr"), c.get("avg_w")),
        )
    conn.commit()
    rows = conn.execute(
        "SELECT * FROM climb_efforts WHERE date >= ? AND gain_m >= ? ORDER BY date DESC", (since, MIN_GAIN_M)
    ).fetchall()
    return [{**dict(r), "puig_major_min": round(PUIG_MAJOR_GAIN_M / r["vam"] * 60) if r["vam"] else None}
            for r in rows]
