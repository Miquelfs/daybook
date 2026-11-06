"""
A route as a rider reads it: distance, climbing, how long it'll take you, the climbs, what's
along the way, what to carry, the daylight on the day, and how it went the times you rode it.

  terrain      gpx_course.parse on the route's GPX (tunnel-corrected climbing, climbs, a
               500 m profile for the gradient chart)
  riding time  gpx_course's speed-by-gradient model, scaled to your pace: the average moving
               speed of your outdoor rides over the last 6 months against the model's flat speed
  along        the pack's waypoints (feeds, summits, warnings) at their km on the route; a climb
               whose top is near a summit waypoint takes its name
  carry        the route's fuel plan (fuel.for_course) over the riding time: how many of each
  daylight     sunrise / sunset at the start on the route's day, and the latest start that
               still finishes in daylight (riding time + 10 % for stops)

Terrain and waypoint km are cached per GPX / pack in this process (they don't change).
"""

from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timedelta

from domains.coll import packread

PACE_DAYS = 180
MODEL_FLAT_KMH = 21.5             # gpx_course.SPEED at 1 % — what its time estimate assumes on the flat
STOPS = 1.10
RIDE_TYPES = ("cycling", "road_biking", "gravel_cycling", "mountain_biking")
_terrain: dict[str, dict] = {}
_along: dict[str, list] = {}


def terrain(gpx_sha1: str, gpx: str) -> dict | None:
    if gpx_sha1 not in _terrain:
        from domains.training import gpx_course
        try:
            _terrain[gpx_sha1] = gpx_course.parse(gpx)
        except (ValueError, Exception):                       # noqa: BLE001 — an odd GPX shows no terrain
            _terrain[gpx_sha1] = None
    return _terrain[gpx_sha1]


def along(pack_sha1: str | None, pack: bytes | None) -> list[dict]:
    """Waypoints with their km along the route, in order."""
    if not pack_sha1 or pack is None:
        return []
    if pack_sha1 not in _along:
        p = packread.read(pack, roads=False)
        pts = [(a / 1e7, b / 1e7) for a, b, _ in p["points"]]
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + _m(a, b))
        out = []
        for kind, lat, lon, name in p["waypoints"]:
            w = (lat / 1e7, lon / 1e7)
            i = min(range(len(pts)), key=lambda k: (pts[k][0] - w[0]) ** 2 + ((pts[k][1] - w[1]) * 0.77) ** 2)
            out.append({"km": round(cum[i] / 1000, 1), "kind": packread.WAYPOINT_KINDS[kind] if kind < 4 else "poi",
                        "name": name, "off_m": round(_m(pts[i], w))})
        _along[pack_sha1] = sorted(out, key=lambda x: x["km"])
    return _along[pack_sha1]


def _m(a, b) -> float:
    dy = (b[0] - a[0]) * 111_320
    dx = (b[1] - a[1]) * 111_320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def pace(conn: sqlite3.Connection, today: date | None = None) -> dict:
    """Your outdoor riding speed: moving-time average of the last 6 months' rides over 20 km."""
    today = today or date.today()
    q = ",".join("?" * len(RIDE_TYPES))
    try:
        r = conn.execute(f"""SELECT SUM(distance_meters), SUM(moving_time_seconds), COUNT(*) FROM activities
                             WHERE source IN ('garmin','coll') AND lower(activity_type) IN ({q})
                               AND date >= ? AND distance_meters >= 20000 AND moving_time_seconds >= 1800""",
                         (*RIDE_TYPES, (today - timedelta(days=PACE_DAYS)).isoformat())).fetchone()
    except sqlite3.OperationalError:
        r = None
    if r and r[1] and r[2] >= 3:
        return {"kmh": round(r[0] / r[1] * 3.6, 1), "rides": r[2], "source": "your rides"}
    return {"kmh": MODEL_FLAT_KMH, "rides": 0, "source": "touring model"}


def carry(fuel_plan: str | None, minutes: int | None) -> dict | None:
    """'Gel:25:25,Drink:20' over 4 h → 9 gels (225 g carbs), drink every 20 min."""
    if not fuel_plan or not minutes:
        return None
    items, carbs = [], 0
    for part in fuel_plan.split(","):
        bits = part.strip().split(":")
        if len(bits) < 2 or not bits[1].isdigit() or int(bits[1]) <= 0:
            continue
        every = int(bits[1])
        n = minutes // every
        g = int(bits[2]) if len(bits) > 2 and bits[2].isdigit() else None
        items.append({"name": bits[0], "every_min": every, "count": n, "carbs_g": g * n if g else None})
        carbs += g * n if g else 0
    return {"items": items, "carbs_g": carbs, "carbs_g_h": round(carbs / minutes * 60) if minutes else None}


def _cutoffs(spec: str | None, stops: list[dict]) -> list[dict]:
    out = []
    for part in (spec or "").split(";"):
        if "@" not in part:
            continue
        where, rest = part.split("@", 1)
        rest = rest.strip()
        at, _, name = rest.partition(" ")
        where = where.strip()
        try:
            km = float(where)
        except ValueError:
            hit = next((w for w in stops if where.lower() in w["name"].lower()), None)
            km = hit["km"] if hit else None
            name = name or where
        out.append({"km": km, "at": at, "name": name.strip() or None})
    return sorted(out, key=lambda c: (c["km"] is None, c["km"] or 0))


def _hm(minutes: float) -> str:
    return f"{int(minutes // 60):02d}:{int(minutes % 60):02d}"


def build(conn: sqlite3.Connection, course: dict, fuel_plan: str | None, today: date | None = None,
          full: bool = True) -> dict | None:
    """course: a coll_courses row with gpx, gpx_sha1, pack, pack_sha1, cutoffs, session/goal dates."""
    t = terrain(course["gpx_sha1"], course["gpx"])
    if t is None:
        return None
    p = pace(conn, today)
    est = round(t["minutes"] * MODEL_FLAT_KMH / p["kmh"]) if p["kmh"] else t["minutes"]
    day = course.get("session_date") or course.get("race_date")
    out = {
        "date": day, "km": t["km"], "climb_m": t["climb_m"], "descent_m": t["descent_m"], "high_m": t["high_m"],
        "est_minutes": est, "pace": p, "carry": carry(fuel_plan, est),
        "profile": t["profile"] if full else t["profile"][::max(1, len(t["profile"]) // 120)],
    }
    if not full:
        return out
    stops = along(course.get("pack_sha1"), course.get("pack"))
    summits = [w for w in stops if w["kind"] == "summit"]
    climbs = []
    for c in t["climbs"]:
        top = c["km"] + c["length_km"]
        on = [w for w in summits if c["km"] <= w["km"] <= top + 1.5]     # a summit on the climb names it
        near = min(on, key=lambda w: abs(w["km"] - top), default=None)
        climbs.append({**c, "top_km": round(top, 1),
                       "name": near["name"].title() if near else None,
                       "est_min": max(1, round(c["minutes"] * MODEL_FLAT_KMH / p["kmh"]))})
    light = None
    if day:
        from domains.training import gpx_course
        dl = gpx_course.daylight(t, day)
        if dl:
            sh, sm = map(int, dl["sunset"].split(":"))
            latest = sh * 60 + sm - est * STOPS
            rh, rm = map(int, dl["sunrise"].split(":"))
            light = {**dl, "latest_start": _hm(latest) if latest > 0 else None,
                     "needs_lights": latest < rh * 60 + rm}          # can't fit between sunrise and sunset
    attempts = []
    try:
        attempts = [dict(r) for r in conn.execute(
            """SELECT a.id AS activity_id, a.date, a.moving_time_seconds, a.distance_meters, a.avg_heart_rate,
                      a.source, r.status
               FROM coll_rides r JOIN activities a ON a.id = r.activity_id
               WHERE r.course_id=? ORDER BY a.date DESC""", (course["id"],))]
    except sqlite3.OperationalError:
        pass
    out.update({
        "climbs": climbs,
        "markers": [{"kind": "climb", "km": c["top_km"], "from_km": c["km"], "name": c["name"] or f"Climb {i + 1}",
                     "ele": None, "first": False, "gain_m": c["gain_m"], "avg_pct": c["avg_pct"],
                     "length_km": c["length_km"]} for i, c in enumerate(climbs)],
        "along": stops,
        "cutoffs": _cutoffs(course.get("cutoffs"), stops),
        "daylight": light,
        "tunnels": t["tunnels"],
        "attempts": attempts,
        "has_elevation": t["has_elevation"],
    })
    return out
