"""
The weather along a dated route, at the time you'll be at each km.

  forecast   Open-Meteo (free, no key; 16 days ahead): hourly temperature, rain probability and
             amount, wind and gusts, for ~20 points along the route plus each climb's top, with
             the route's elevation so summit temperatures are the summit's
  when       your start time on the route (08:00 if not set) + the brief's riding time per 500 m at
             your pace, stops spread evenly (+10 %), wind included (it changes when you get where)
  wind       the component along your direction of travel, at rider height (10 m wind × 0.75);
             its effect on speed from the power you'd ride that 500 m at in still air
             (m = you + 9 kg, CdA 0.32, Crr 0.005, ρ 1.2), descents at a third of it
  summary    temperature range, each summit's, when rain gets likely (≥ 50 % or ≥ 0.5 mm/h),
             the longest headwind and tailwind stretches, minutes the wind costs or gives, and a
             one-line version Coll shows when the ride starts (/coll/sync `weather`)

The raw answer is cached per route (coll_weather) and refreshed after 3 h; the nightly job
(`python -m domains.coll.weather`) refreshes every route dated in the next 16 days.
"""

from __future__ import annotations

import json
import math
import sqlite3
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from domains.coll import brief as B
from domains.coll import route as RT

API = "https://api.open-meteo.com/v1/forecast"
HOURLY = "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
HORIZON_DAYS = 15
STALE_H = 3
DEFAULT_START = "08:00"
MAX_POINTS = 30
RIDER_HEIGHT = 0.75                 # 10 m wind → at the bars (open country, log profile)
CDA, CRR, RHO, BIKE_KG = 0.32, 0.005, 1.2, 9.0
HEAD_KMH = 8                        # a stretch counts as headwind / tailwind from this component
RAIN_PCT, RAIN_MM = 50, 0.5


# ── fetching ────────────────────────────────────────────────────────────────

def _fetch(points: list[dict], day: str, timeout: float = 8) -> list[dict]:
    """One request for every point: [{time: [...UTC hours], temperature_2m: [...], ...}] in the order given."""
    d = date.fromisoformat(day)
    q = {"latitude": ",".join(f"{p['lat']:.4f}" for p in points),
         "longitude": ",".join(f"{p['lon']:.4f}" for p in points),
         "elevation": ",".join(f"{p['ele']:.0f}" if p.get("ele") is not None else "nan" for p in points),
         "hourly": HOURLY, "wind_speed_unit": "kmh", "timezone": "GMT",
         "start_date": d.isoformat(), "end_date": (d + timedelta(days=1)).isoformat()}
    req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(q)}", headers={"User-Agent": "Daybook"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read())
    data = data if isinstance(data, list) else [data]
    return [x["hourly"] for x in data]


def sample_points(ln: RT.Line, br: dict) -> list[dict]:
    """~Every route_km/20 (≥ 10 km) and each climb top, with the route's elevation there."""
    km = br["km"]
    step = max(10.0, km / 20)
    kms = [round(i * step, 1) for i in range(int(km // step) + 1)] + [km]
    kms += [c["top_km"] for c in br.get("climbs", [])]
    kms = sorted(set(min(km, k) for k in kms))[:MAX_POINTS]
    prof = br["profile"]
    scale = ln.length_m / (km * 1000) if km else 1
    out = []
    for k in kms:
        lat, lon = ln.at(k * 1000 * scale)
        ele = min(prof, key=lambda p: abs(p[0] - k))[1] if prof else None
        out.append({"km": k, "lat": lat, "lon": lon, "ele": ele})
    return out


def _cached(conn, cid: int) -> sqlite3.Row | None:
    try:
        return conn.execute("SELECT * FROM coll_weather WHERE course_id=?", (cid,)).fetchone()
    except sqlite3.OperationalError:
        return None


def raw(conn, course: dict, br: dict, refresh: bool = False, fetch=_fetch) -> tuple[dict | None, str]:
    """(cached forecast {points, hourly, fetched_at}, status). status: ok | stale | too_far | past | no_date | unavailable"""
    day = br.get("date")
    if not day:
        return None, "no_date"
    d = date.fromisoformat(day)
    today = date.today()
    if d < today - timedelta(days=1):
        return None, "past"
    if d > today + timedelta(days=HORIZON_DAYS):
        return None, "too_far"
    ln = RT.line(course["gpx_sha1"], course["gpx"])
    if ln is None:
        return None, "unavailable"
    old = _cached(conn, course["id"])
    if old is not None and old["day"] == day:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(old["fetched_at"].replace("Z", "+00:00"))
        if age < timedelta(hours=STALE_H) and not refresh:
            return json.loads(old["raw_json"]), "ok"
    pts = sample_points(ln, br)
    try:
        hourly = fetch(pts, day)
    except Exception:                                           # noqa: BLE001 — offline, API down: keep what we had
        if old is not None and old["day"] == day:
            return json.loads(old["raw_json"]), "stale"
        return None, "unavailable"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = {"points": pts, "hourly": hourly, "fetched_at": now}
    conn.execute("""INSERT INTO coll_weather (course_id, day, fetched_at, raw_json) VALUES (?,?,?,?)
                    ON CONFLICT(course_id) DO UPDATE SET day=excluded.day, fetched_at=excluded.fetched_at,
                                                         raw_json=excluded.raw_json""",
                 (course["id"], day, now, json.dumps(data)))
    conn.commit()
    return data, "ok"


# ── wind and speed ──────────────────────────────────────────────────────────

def speed_with_wind(v0: float, grade_pct: float, head: float, mass: float) -> float:
    """m/s along the road with a head (+) / tail (−) wind component of `head` m/s, riding the power
    v0 takes in still air. Descending (no pedalling needed at v0): a third of the wind's change."""
    if abs(head) < 0.2:
        return v0
    g = grade_pct / 100
    sin, cos = g / math.sqrt(1 + g * g), 1 / math.sqrt(1 + g * g)
    res = mass * 9.81 * (CRR * cos + sin)
    aero = lambda v, w: 0.5 * RHO * CDA * (v + w) * abs(v + w)          # noqa: E731
    power = (res + aero(v0, 0)) * v0
    if power <= 20:
        return max(0.6 * v0, min(1.35 * v0, v0 - head / 3))
    lo, hi = 0.3, 30.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if (res + aero(mid, head)) * mid > power:
            hi = mid
        else:
            lo = mid
    return max(0.6 * v0, min(1.35 * v0, lo))


def _at(hourly: dict, key: str, when: datetime) -> float | None:
    """Linear between the hours either side (UTC)."""
    times = hourly.get("time") or []
    vals = hourly.get(key) or []
    if not times:
        return None
    t0 = datetime.fromisoformat(times[0]).replace(tzinfo=timezone.utc)
    x = (when - t0).total_seconds() / 3600
    i = int(math.floor(x))
    if i < 0 or i >= len(vals) - 1:
        i = max(0, min(len(vals) - 1, i))
        return vals[i] if vals else None
    a, b = vals[i], vals[i + 1]
    if a is None or b is None:
        return a if a is not None else b
    return a + (b - a) * (x - i)


def _dir_at(hourly: dict, when: datetime) -> float | None:
    times = hourly.get("time") or []
    vals = hourly.get("wind_direction_10m") or []
    if not times or not vals:
        return None
    t0 = datetime.fromisoformat(times[0]).replace(tzinfo=timezone.utc)
    i = max(0, min(len(vals) - 1, round((when - t0).total_seconds() / 3600)))
    return vals[i]


def _stretches(segs: list[dict], sign: int) -> list[dict]:
    out, cur = [], None
    for s in segs:
        on = s["head_kmh"] * sign >= HEAD_KMH
        if on:
            if cur and s["km0"] - cur["to_km"] <= 2:
                cur["to_km"], cur["sum"], cur["n"] = s["km1"], cur["sum"] + s["head_kmh"], cur["n"] + 1
            else:
                cur = {"from_km": s["km0"], "to_km": s["km1"], "sum": s["head_kmh"], "n": 1}
                out.append(cur)
    out = [{"from_km": round(c["from_km"]), "to_km": round(c["to_km"]), "kmh": round(abs(c["sum"] / c["n"]))}
           for c in out if c["to_km"] - c["from_km"] >= 5]
    return sorted(out, key=lambda c: c["to_km"] - c["from_km"], reverse=True)[:3]


def along(conn, course: dict, br: dict, data: dict, start: str, tz: str) -> dict:
    """Weather at each 500 m when you're there, and what it means for the day."""
    ln = RT.line(course["gpx_sha1"], course["gpx"])
    pts, hourly = data["points"], data["hourly"]
    segs = RT.segments(br["profile"], br["pace"]["kmh"], B.MODEL_FLAT_KMH)
    total = sum(sg["s"] for sg in segs)
    if total and br.get("est_minutes"):                         # the brief's own riding time (100 m model), spread out
        k = br.get("est_minutes_still", br["est_minutes"]) * 60 / total
        segs = [{**sg, "s": sg["s"] * k} for sg in segs]
    scale = ln.length_m / (br["km"] * 1000) if br["km"] else 1
    w = conn.execute("SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1").fetchone() if _has(conn, "weight_log") else None
    mass = (w[0] if w else 75.0) + BIKE_KG
    h, m = map(int, start.split(":"))
    zone = ZoneInfo(tz)
    t0 = datetime.fromisoformat(br["date"]).replace(hour=h, minute=m, tzinfo=zone).astimezone(timezone.utc)
    near = lambda km: min(range(len(pts)), key=lambda i: abs(pts[i]["km"] - km))   # noqa: E731

    still_s = sum(sg["s"] for sg in segs)
    times = None
    for _ in range(2):                                          # ETAs depend on the wind and the wind on the ETAs
        t, out = t0, []
        for k, sg in enumerate(segs):
            mid = (sg["km0"] + sg["km1"]) / 2
            hw = hourly[near(mid)]
            when = times[k] if times else t
            ws, wd = _at(hw, "wind_speed_10m", when) or 0.0, _dir_at(hw, when)
            bear = ln.bearing(sg["km0"] * 1000 * scale, sg["km1"] * 1000 * scale)
            head = ws * RIDER_HEIGHT * math.cos(math.radians((wd or 0) - bear)) if wd is not None else 0.0
            v0 = (sg["km1"] - sg["km0"]) * 1000 / sg["s"]
            v = speed_with_wind(v0, sg["grade_pct"], head / 3.6, mass)
            s = (sg["km1"] - sg["km0"]) * 1000 / v
            out.append({**sg, "when": t, "head_kmh": head, "wind_s": s})
            t = t + timedelta(seconds=s * B.STOPS)
        times = [o["when"] for o in out]
    wind_s = sum(o["wind_s"] for o in out)

    local = lambda d: d.astimezone(zone).strftime("%H:%M")      # noqa: E731
    chart = []
    for k in range(0, len(out), 4):                             # every 2 km for the chart
        o = out[k]
        hw = hourly[near(o["km0"])]
        chart.append({"km": o["km0"], "eta": local(o["when"]),
                      "temp": _r(_at(hw, "temperature_2m", o["when"])),
                      "rain_pct": _r(_at(hw, "precipitation_probability", o["when"])),
                      "rain_mm": _r(_at(hw, "precipitation", o["when"]), 1),
                      "wind_kmh": _r(_at(hw, "wind_speed_10m", o["when"])),
                      "gust_kmh": _r(_at(hw, "wind_gusts_10m", o["when"])),
                      "wind_from": _r(_dir_at(hw, o["when"])),
                      "head_kmh": round(o["head_kmh"])})
    eta_at = lambda km: next((o["when"] for o in out if o["km1"] >= km), out[-1]["when"] if out else t0)  # noqa: E731

    summits = []
    for c in br.get("climbs", []):
        i = near(c["top_km"])
        when = eta_at(c["top_km"])
        summits.append({"name": c.get("name"), "km": c["top_km"], "eta": local(when),
                        "temp": _r(_at(hourly[i], "temperature_2m", when)),
                        "ele": pts[i].get("ele")})
    temps = [p["temp"] for p in chart if p["temp"] is not None]
    rain = next((p for p in chart if (p["rain_pct"] or 0) >= RAIN_PCT or (p["rain_mm"] or 0) >= RAIN_MM), None)
    wet_km = sum(2 for p in chart if (p["rain_pct"] or 0) >= RAIN_PCT or (p["rain_mm"] or 0) >= RAIN_MM)
    head = _stretches(out, 1)
    tail = _stretches(out, -1)
    finish = t0 + timedelta(seconds=wind_s * B.STOPS)
    res = {
        "start": start, "finish_at": local(finish),
        "riding_min": round(wind_s / 60), "still_min": round(still_s / 60),
        "wind_min": round((wind_s - still_s) / 60),
        "temp_min": min(temps) if temps else None, "temp_max": max(temps) if temps else None,
        "summits": summits,
        "rain": {"from_km": rain["km"], "at": rain["eta"], "pct": rain["rain_pct"], "wet_km": wet_km} if rain else None,
        "headwind": head, "tailwind": tail,
        "max_gust_kmh": max((p["gust_kmh"] or 0 for p in chart), default=None),
        "points": chart,
    }
    res["line"] = summary_line(res)
    return res


def summary_line(w: dict) -> str:
    """What Coll shows when the ride starts, ~60 characters (Latin-1: the device's fonts)."""
    parts = []
    if w.get("temp_min") is not None:
        parts.append(f"{w['temp_min']}-{w['temp_max']}°C" if w["temp_min"] != w["temp_max"] else f"{w['temp_min']}°C")
    if w.get("rain"):
        parts.append(f"rain from km {round(w['rain']['from_km'])} ({w['rain']['at']})")
    else:
        parts.append("dry")
    if w.get("headwind"):
        h = w["headwind"][0]
        parts.append(f"headwind km {h['from_km']}-{h['to_km']}")
    elif w.get("tailwind"):
        h = w["tailwind"][0]
        parts.append(f"tailwind km {h['from_km']}-{h['to_km']}")
    line = " · ".join(parts)
    while len(line) > 64 and len(parts) > 1:
        parts.pop()
        line = " · ".join(parts)
    return line


def _r(v, nd: int = 0):
    if v is None:
        return None
    return round(v, nd) if nd else round(v)


def _has(conn, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def for_course(conn, course: dict, br: dict | None, tz: str, refresh: bool = False, fetch=_fetch) -> dict:
    """The route's weather, ready for the page: {status, …along() when there's a forecast}."""
    if br is None:
        return {"status": "unavailable"}
    data, status = raw(conn, course, br, refresh=refresh, fetch=fetch)
    start = course.get("start_time") or DEFAULT_START
    if data is None:
        out = {"status": status, "start": start}
        if status == "too_far" and br.get("date"):
            out["available_from"] = (date.fromisoformat(br["date"]) - timedelta(days=HORIZON_DAYS)).isoformat()
        return out
    try:
        w = along(conn, course, br, data, start, tz)
    except Exception:                                           # noqa: BLE001 — an odd answer: no weather, not a 500
        return {"status": "unavailable", "start": start}
    conn.execute("UPDATE coll_weather SET line=? WHERE course_id=?", (w["line"], course["id"]))
    conn.commit()
    return {"status": status, "fetched_at": data["fetched_at"], **w}


def apply(br: dict, wx: dict) -> None:
    """The brief with the wind in it: riding time and the latest start that still finishes in daylight."""
    if wx.get("riding_min") is None:
        return
    br["est_minutes_still"] = br["est_minutes"]
    br["est_minutes"] = wx["riding_min"]
    dl = br.get("daylight")
    if dl:
        br["daylight"] = B.daylight(dl, wx["riding_min"], wind=True)


def refresh_all(conn, tz: str, log=print) -> int:
    """Nightly: every route dated from today to the forecast horizon."""
    n = 0
    hi = (date.today() + timedelta(days=HORIZON_DAYS)).isoformat()
    lo = date.today().isoformat()
    for r in conn.execute(
            """SELECT c.id FROM coll_courses c LEFT JOIN race_goals g ON g.id = c.goal_id
               LEFT JOIN plan_sessions p ON p.id = c.session_id
               WHERE c.status='ready' AND COALESCE(p.session_date, g.race_date) BETWEEN ? AND ?""", (lo, hi)).fetchall():
        course = B.load(conn, r["id"])
        br = B.build(conn, course, None, full=True) if course else None
        w = for_course(conn, course, br, tz, refresh=True) if course else None
        if w and w["status"] in ("ok", "stale"):
            n += 1
            log(f"weather · {course['name']}: {w.get('line')}")
    return n


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    from infrastructure.db.usertime import current_tz
    c = get_connection()
    try:
        print(f"{refresh_all(c, current_tz())} route(s) with a forecast")
    finally:
        c.close()
