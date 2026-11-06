"""
A ride of a route against its plan: what the brief said, what you rode.

  which rides   the rides Coll filed against the route (coll_rides.course_id, the watch's copy too),
                the activity that completed the route's planned session, and any ride from the
                watch or Coll that ran ≥ 70 % on the route's line (scan / scan_course)
  where         each moment of the ride placed on the route (nearest point within 60 m, always
                moving forward along it), so every km has a time: sections, climbs, coverage
  sections      between feeds, cut-offs and climb tops (≥ ~1/12 of the route each, at most
                ~3× that): predicted moving time at that day's pace vs your moving and total time
  climbs        the brief's named climbs: your time up each one, VAM, heart rate, and your best
                across every ride of the route
  fuel          from Coll's ride log (each "taken" press, ridelog.h kFuel): reminder by reminder,
                on time / late / never; else the fuel log typed for the activity
  learning      model_s (touring-model seconds over what you covered), base_kmh (your 6-month
                pace that day) and moving_s are kept per ride: brief.learned() turns the last
                rides into the correction the next brief uses

Computed in the background (after a Coll upload, after the Garmin sync, after a route builds),
stored in coll_reviews; a GET computes a missing one on the spot.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

from domains.coll import brief as B
from domains.coll import route as RT
from domains.health.geo import decode, dist_m

VERSION = 1
NEAR_M = 60                 # a ride point this close to the route is on it
CELL = 0.001                # ~100 m grid
STEP_S = 5                  # place one ride point every 5 s
REJOIN_S = 120              # off the route this long: the next match may be anywhere further on
MAX_STEP_S = 10             # longer gaps between points are stops (not moving)
MOVING_MPS = 1.0
ON_ROUTE = 0.7              # a ride with ≥ 70 % of its line on a route is a ride of it
ON_TIME_MIN = 5
RIDE_TYPES = B.RIDE_TYPES


# ── which rides ─────────────────────────────────────────────────────────────

def _grid(pts: list[tuple[float, float]]) -> dict:
    g: dict[tuple, list] = {}
    for i, p in enumerate(pts):
        g.setdefault((int(p[0] // CELL), int(p[1] // CELL)), []).append(i)
    return g


def _near(grid: dict, pts: list, p: tuple, r: float = NEAR_M) -> list[int]:
    ci, cj = int(p[0] // CELL), int(p[1] // CELL)
    return [i for di in (-1, 0, 1) for dj in (-1, 0, 1) for i in grid.get((ci + di, cj + dj), ())
            if dist_m(p, pts[i]) <= r]


def on_route_frac(route_pts: list, grid: dict, ride_pts: list) -> float:
    if not ride_pts:
        return 0.0
    step = max(1, len(ride_pts) // 300)
    sample = ride_pts[::step]
    return sum(1 for p in sample if _near(grid, route_pts, p, 80)) / len(sample)


def _activity_ids_for(conn, course: dict) -> set[str]:
    ids = {r[0] for r in conn.execute("SELECT activity_id FROM coll_rides WHERE course_id=? AND activity_id IS NOT NULL",
                                      (course["id"],))}
    if course.get("session_id"):
        try:
            r = conn.execute("SELECT completed_activity_id FROM plan_sessions WHERE id=?", (course["session_id"],)).fetchone()
            if r and r[0]:
                ids.add(r[0])
        except sqlite3.OperationalError:
            pass
    return ids


def _ride_rows(conn, since: str | None, ids: set[str] | None = None) -> list[sqlite3.Row]:
    q = ",".join("?" * len(RIDE_TYPES))
    sql = (f"SELECT id, date, polyline FROM activities WHERE source IN ('garmin','coll') "
           f"AND lower(activity_type) IN ({q}) AND polyline IS NOT NULL")
    args: list = [*RIDE_TYPES]
    if since:
        sql += " AND date >= ?"
        args.append(since)
    if ids is not None:
        if not ids:
            return []
        sql += f" AND id IN ({','.join('?' * len(ids))})"
        args += sorted(ids)
    return conn.execute(sql, args).fetchall()


def scan_course(conn, cid: int, days: int = 365, log=print) -> int:
    """A route just built (or rebuilt): find your earlier rides of it. Returns reviews written."""
    course = B.load(conn, cid)
    if course is None:
        return 0
    ln = RT.line(course["gpx_sha1"], course["gpx"])
    if ln is None:
        return 0
    grid = _grid(ln.pts)
    lat = [p[0] for p in ln.pts]
    lon = [p[1] for p in ln.pts]
    box = (min(lat) - 0.01, max(lat) + 0.01, min(lon) - 0.01, max(lon) + 0.01)
    known = _activity_ids_for(conn, course)
    taken = {r[0]: r[1] for r in conn.execute("SELECT activity_id, course_id FROM coll_reviews")}
    n = 0
    for r in _ride_rows(conn, (date.today() - timedelta(days=days)).isoformat()):
        if r["id"] in taken and taken[r["id"]] not in (None, cid) and r["id"] not in known:
            continue                                            # already a ride of another route
        if r["id"] not in known:
            pts = decode(r["polyline"])
            if not pts or not any(box[0] <= p[0] <= box[1] and box[2] <= p[1] <= box[3] for p in pts[::20]):
                continue
            if on_route_frac(ln.pts, grid, pts) < ON_ROUTE:
                continue
        try:
            if store(conn, r["id"], cid):
                n += 1
        except Exception as e:                                  # noqa: BLE001 — one odd ride doesn't stop the rest
            log(f"review {r['id']} on course {cid}: {e}")
    return n


def scan(conn, days: int = 30, log=print) -> int:
    """New rides (after a Garmin sync / a Coll upload): which route, if any, each one rode."""
    seen = {r[0] for r in conn.execute("SELECT activity_id FROM coll_reviews")}
    rows = [r for r in _ride_rows(conn, (date.today() - timedelta(days=days)).isoformat()) if r["id"] not in seen]
    if not rows:
        return 0
    courses = []
    for c in conn.execute("SELECT id FROM coll_courses WHERE status='ready' ORDER BY on_device DESC, id DESC"):
        full = B.load(conn, c["id"])
        ln = RT.line(full["gpx_sha1"], full["gpx"]) if full else None
        if ln:
            courses.append((full, ln, _grid(ln.pts), _activity_ids_for(conn, full)))
    n = 0
    for r in rows:
        best, best_frac = None, 0.0
        for full, ln, grid, known in courses:
            if r["id"] in known:
                best, best_frac = full, 1.0
                break
        if best is None:
            pts = decode(r["polyline"]) or []
            for full, ln, grid, _ in courses:
                f = on_route_frac(ln.pts, grid, pts)
                if f >= ON_ROUTE and f > best_frac:
                    best, best_frac = full, f
        try:
            if best is not None:
                n += 1 if store(conn, r["id"], best["id"]) else 0
            else:
                conn.execute("INSERT OR REPLACE INTO coll_reviews (activity_id, course_id, date) VALUES (?, NULL, ?)",
                             (r["id"], r["date"]))
        except Exception as e:                                  # noqa: BLE001
            log(f"review {r['id']}: {e}")
    conn.commit()
    return n


# ── placing the ride on the route ───────────────────────────────────────────

def _streams(conn, aid: str) -> dict:
    want = ("sumduration", "directlatitude", "directlongitude", "directspeed", "sumdistance",
            "directheartrate", "directpower")
    q = ",".join("?" * len(want))
    out = {}
    for r in conn.execute(f"SELECT stream_type, data_json FROM activity_streams WHERE activity_id=? AND stream_type IN ({q})",
                          (aid, *want)):
        try:
            out[r[0]] = json.loads(r[1])
        except (TypeError, ValueError):
            pass
    return out


def _series(st: dict) -> list[tuple]:
    """[(elapsed s, moving s, lat, lon, hr)] from the streams, moving computed the same way for any source."""
    t, la, lo = st.get("sumduration"), st.get("directlatitude"), st.get("directlongitude")
    if not t or not la or not lo:
        return []
    n = min(len(t), len(la), len(lo))
    sp, d, hr = st.get("directspeed"), st.get("sumdistance"), st.get("directheartrate")
    out, mv, last = [], 0.0, None
    for i in range(n):
        if t[i] is None or la[i] is None or lo[i] is None:
            continue
        if last is not None:
            dt = t[i] - t[last]
            if 0 < dt <= MAX_STEP_S:
                v = sp[i] if sp and i < len(sp) and sp[i] is not None else (
                    (d[i] - d[last]) / dt if d and i < len(d) and d[i] is not None and d[last] is not None
                    else dist_m((la[last], lo[last]), (la[i], lo[i])) / dt)
                if v >= MOVING_MPS:
                    mv += dt
        out.append((float(t[i]), mv, la[i], lo[i], hr[i] if hr and i < len(hr) else None))
        last = i
    return out


def place(ln: RT.Line, series: list[tuple]) -> list[tuple]:
    """[(elapsed, moving, route_m, hr)] for the ride points on the route, in order along it."""
    grid = _grid(ln.pts)
    out, last_m, last_t, next_t = [], None, None, -1e9
    for t, mv, la, lo, hr in series:
        if t < next_t:
            continue
        next_t = t + STEP_S
        cands = _near(grid, ln.pts, (la, lo))
        if not cands:
            continue
        ms = sorted(ln.cum[i] for i in cands)
        if last_m is None or t - last_t > REJOIN_S:
            ahead = [m for m in ms if last_m is None or m >= last_m - 150]
            m = ahead[0] if ahead else None
        else:
            limit = last_m + (t - last_t) * 25 + 300            # no faster than 90 km/h along the route
            ahead = [m for m in ms if last_m - 150 <= m <= limit]
            m = ahead[0] if ahead else None
        if m is None:
            continue
        m = max(m, last_m) if last_m is not None else m
        out.append((t, mv, m, hr))
        last_m, last_t = m, t
    return out


def _cross(placed: list[tuple], m: float) -> tuple | None:
    """The first ride point at or past m metres along the route."""
    lo, hi = 0, len(placed)
    while lo < hi:
        mid = (lo + hi) // 2
        if placed[mid][2] < m:
            lo = mid + 1
        else:
            hi = mid
    if lo < len(placed):
        return placed[lo] if placed[lo][2] - m < 1500 else None
    return placed[-1] if placed and m - placed[-1][2] <= 200 else None      # the finish, a few metres short


def _between(placed, a_m, b_m) -> dict | None:
    a, b = _cross(placed, a_m), _cross(placed, b_m)
    if a is None or b is None or b[0] <= a[0]:
        return None
    hrs = [p[3] for p in placed if a[0] <= p[0] <= b[0] and p[3]]
    return {"elapsed_s": b[0] - a[0], "moving_s": b[1] - a[1], "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None}


# ── sections ────────────────────────────────────────────────────────────────

def _sections(km: float, br: dict) -> list[dict]:
    """Boundaries at feeds, cut-offs and climb tops, each section ~1/12 of the route or more."""
    lo = max(5.0, km / 12)
    marks = [(w["km"], w["name"], "feed") for w in br.get("along", []) if w["kind"] == "feed"]
    marks += [(c["km"], c.get("name") or "Cut-off", "cutoff") for c in br.get("cutoffs", []) if c.get("km") is not None]
    marks += [(c["top_km"], f"Top of {c['name']}" if c.get("name") else f"Top of the climb at km {c['km']}", "summit")
              for c in br.get("climbs", [])]
    marks = sorted((m for m in marks if 0 < m[0] < km - lo / 2), key=lambda m: m[0])
    out, b = [], 0.0
    i = 0
    while b < km - lo / 2:
        nxt = next((m for m in marks[i:] if m[0] - b >= lo), None)
        if nxt and nxt[0] - b <= 3 * lo:
            end, name, kind = nxt
            i = marks.index(nxt) + 1
        else:
            end, name, kind = min(km, round((b + 2 * lo) / 5) * 5 or b + 2 * lo), None, None
        if km - end < lo / 2:
            end, name, kind = km, "Finish", "finish"
        out.append({"from_km": round(b, 1), "to_km": round(end, 1), "name": name, "kind": kind})
        b = end
    return out


# ── fuel ────────────────────────────────────────────────────────────────────

def fuel(plan: str | None, taken: list[dict], timer_s: float | None) -> dict | None:
    """Reminder by reminder, as Coll gives them: an item is due `every` minutes after it was last
    taken; ignored, it stays due until taken (the drop in the status bar)."""
    items = (B.carry(plan, 10 ** 6) or {}).get("items") or []
    if not items or not timer_s:
        return None
    end = timer_s / 60
    per, timeline = [], []
    for idx, it in enumerate(items):
        takes = sorted(e["timer"] / 60 for e in taken if e.get("item") == idx)
        last, due, on_time, late, early = 0.0, it["every_min"], 0, [], 0
        for tk in takes:
            if tk < due - ON_TIME_MIN:
                early += 1
                timeline.append({"item": it["name"], "due_min": None, "taken_min": round(tk), "late_min": None})
            else:
                lt = max(0.0, tk - due)
                if lt > ON_TIME_MIN:
                    late.append(round(lt))
                else:
                    on_time += 1
                timeline.append({"item": it["name"], "due_min": round(due), "taken_min": round(tk), "late_min": round(lt)})
            last, due = tk, tk + it["every_min"]
        overdue = round(end - due) if due < end else 0
        if overdue > 0:
            timeline.append({"item": it["name"], "due_min": round(due), "taken_min": None, "late_min": None})
        expected = int(end // it["every_min"])
        per.append({"name": it["name"], "every_min": it["every_min"], "taken": len(takes), "expected": expected,
                    "on_time": on_time,
                    "late": len(late), "avg_late_min": round(sum(late) / len(late)) if late else None,
                    "early": early, "overdue_at_end_min": overdue})
    carbs_each = {}
    for part in (plan or "").split(","):
        bits = part.strip().split(":")
        carbs_each[bits[0]] = int(bits[2]) if len(bits) > 2 and bits[2].isdigit() else 0
    eaten = sum(p["taken"] * carbs_each.get(p["name"], 0) for p in per)
    planned = sum(p["expected"] * carbs_each.get(p["name"], 0) for p in per)
    for p in per:
        p["carbs_g"] = carbs_each.get(p["name"]) or None
    hours = end / 60
    return {"source": "coll", "plan": plan, "items": per,
            "timeline": sorted(timeline, key=lambda x: x["taken_min"] if x["taken_min"] is not None else x["due_min"]),
            "carbs_g": eaten, "planned_carbs_g": planned,
            "carbs_g_h": round(eaten / hours) if hours else None,
            "planned_g_h": round(planned / hours) if hours else None,
            "presses": len(taken)}


def _fuel_for(conn, aid: str, timer_s: float | None) -> dict | None:
    r = conn.execute("SELECT summary_json FROM coll_rides WHERE activity_id=? ORDER BY start_utc DESC LIMIT 1",
                     (aid,)).fetchone()
    s = json.loads(r[0] or "{}") if r else {}
    if s.get("fuel_plan") and s.get("fuel_taken") is not None:
        out = fuel(s["fuel_plan"], s["fuel_taken"], s.get("timer_s") or timer_s)
        if out:
            return out
    try:
        f = conn.execute("SELECT SUM(carbs_g), COUNT(*) FROM fueling_logs WHERE activity_id=?", (aid,)).fetchone()
    except sqlite3.OperationalError:
        f = None
    if f and f[1] and f[0]:
        hours = (timer_s or 0) / 3600
        return {"source": "log", "carbs_g": round(f[0]), "carbs_g_h": round(f[0] / hours) if hours else None}
    return None


# ── the review ──────────────────────────────────────────────────────────────

def compute(conn, aid: str, cid: int) -> dict | None:
    a = conn.execute("SELECT id, date, name, source, moving_time_seconds, duration_seconds, avg_heart_rate "
                     "FROM activities WHERE id=?", (aid,)).fetchone()
    course = B.load(conn, cid)
    if a is None or course is None:
        return None
    day = date.fromisoformat(a["date"])
    br = B.build(conn, course, None, today=day, full=True)       # the brief as it read that day
    ln = RT.line(course["gpx_sha1"], course["gpx"])
    if br is None or ln is None:
        return None
    series = _series(_streams(conn, aid))
    if not series:
        return None                                              # no streams yet (the watch's come later): try again
    placed = place(ln, series)
    if len(placed) < 10:
        return {"activity_id": aid, "course_id": cid, "covered_km": 0, "error": "the ride doesn't follow the route"}
    pace = br["pace"]
    segs = RT.segments(br["profile"], pace["kmh"], B.MODEL_FLAT_KMH)
    scale_m = ln.length_m / (br["km"] * 1000) if br["km"] else 1.0        # profile km → line metres

    # coverage: the 500 m pieces you rode through, start to end
    covered, model_s, pred_s, moving_s = 0.0, 0.0, 0.0, 0.0
    for sg in segs:
        x = _between(placed, sg["km0"] * 1000 * scale_m, sg["km1"] * 1000 * scale_m)
        if x is None:
            continue
        covered += sg["km1"] - sg["km0"]
        pred_s += sg["s"]
        model_s += sg["s"] * pace["kmh"] / B.MODEL_FLAT_KMH
        moving_s += x["moving_s"]

    def span(k0, k1):
        return _between(placed, k0 * 1000 * scale_m, k1 * 1000 * scale_m)

    def predicted(k0, k1):
        return sum(sg["s"] * max(0.0, min(k1, sg["km1"]) - max(k0, sg["km0"])) / (sg["km1"] - sg["km0"])
                   for sg in segs) / 60

    sections = []
    for sc in _sections(br["km"], br):
        x = span(sc["from_km"], sc["to_km"])
        p = predicted(sc["from_km"], sc["to_km"])
        sections.append({**sc, "predicted_min": round(p), "ridden": x is not None,
                         **({"moving_min": round(x["moving_s"] / 60), "elapsed_min": round(x["elapsed_s"] / 60),
                             "delta_min": round(x["moving_s"] / 60 - p), "avg_hr": x["avg_hr"],
                             "kmh": round((sc["to_km"] - sc["from_km"]) / (x["moving_s"] / 3600), 1)
                             if x["moving_s"] > 0 else None} if x else {})})

    climbs = []
    for c in br.get("climbs", []):
        x = span(c["km"], c["top_km"])
        climbs.append({"name": c.get("name"), "km": c["km"], "top_km": c["top_km"], "gain_m": c["gain_m"],
                       "length_km": c["length_km"], "avg_pct": c["avg_pct"], "est_min": c["est_min"],
                       **({"moving_min": round(x["moving_s"] / 60, 1), "elapsed_min": round(x["elapsed_s"] / 60, 1),
                           "vam": round(c["gain_m"] / (x["moving_s"] / 3600)) if x["moving_s"] > 0 else None,
                           "avg_hr": x["avg_hr"]} if x else {"moving_min": None})})

    first, last = placed[0], placed[-1]
    elapsed_s = last[0] - first[0]
    moving_total = last[1] - first[1]
    timer_s = a["moving_time_seconds"] or moving_total
    out = {
        "version": VERSION, "activity_id": aid, "course_id": cid, "course_name": course["name"],
        "date": a["date"], "name": a["name"], "source": a["source"],
        "route_km": br["km"], "covered_km": round(covered, 1),
        "from_km": round(first[2] / scale_m / 1000, 1), "to_km": round(last[2] / scale_m / 1000, 1),
        "pace": {"kmh": pace["kmh"], "base_kmh": pace.get("base_kmh"), "learned": pace.get("learned")},
        "predicted_min": round(pred_s / 60), "moving_min": round(moving_s / 60),
        "elapsed_min": round(elapsed_s / 60), "stopped_min": round((elapsed_s - moving_total) / 60),
        "delta_min": round((moving_s - pred_s) / 60),
        "flat_kmh": round(B.MODEL_FLAT_KMH * model_s / moving_s, 1) if moving_s else None,   # rode it like this flat pace
        "avg_hr": a["avg_heart_rate"],
        "sections": sections, "climbs": climbs,
        "fuel": _fuel_for(conn, aid, timer_s),
        "_learn": {"model_s": model_s, "base_kmh": pace.get("base_kmh") or pace["kmh"], "moving_s": moving_s},
    }
    return out


def store(conn, aid: str, cid: int) -> dict | None:
    rv = compute(conn, aid, cid)
    if rv is None:
        return None
    learn = rv.pop("_learn", None) or {}
    conn.execute(
        """INSERT OR REPLACE INTO coll_reviews (activity_id, course_id, date, covered_km, model_s, base_kmh, moving_s,
                                               version, review_json, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))""",
        (aid, cid, rv.get("date"), rv.get("covered_km"), learn.get("model_s"), learn.get("base_kmh"),
         learn.get("moving_s"), VERSION, json.dumps(rv)))
    conn.commit()
    return rv


def get(conn, aid: str) -> dict | None:
    """The stored review (computing it if it's missing or older), with each climb's best across the route's rides."""
    r = conn.execute("SELECT course_id, version, review_json FROM coll_reviews WHERE activity_id=?", (aid,)).fetchone()
    if r is None:
        cid = conn.execute("SELECT course_id FROM coll_rides WHERE activity_id=? AND course_id IS NOT NULL LIMIT 1",
                           (aid,)).fetchone()
        rv = store(conn, aid, cid[0]) if cid else None
    elif r["course_id"] is None:
        return None
    elif r["version"] != VERSION or not r["review_json"]:
        rv = store(conn, aid, r["course_id"])
    else:
        rv = json.loads(r["review_json"])
    if not rv or rv.get("error"):
        return rv
    bests = best_climbs(conn, rv["course_id"])
    for i, c in enumerate(rv["climbs"]):
        b = bests.get(i)
        if b:
            c["best"] = b
            c["is_best"] = c.get("moving_min") is not None and b["activity_id"] == aid
    rv["rides_of_route"] = len(rides(conn, rv["course_id"]))
    return rv


def best_climbs(conn, cid: int) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for r in conn.execute("SELECT activity_id, date, review_json FROM coll_reviews WHERE course_id=? AND review_json IS NOT NULL",
                          (cid,)):
        try:
            rv = json.loads(r["review_json"])
        except ValueError:
            continue
        for i, c in enumerate(rv.get("climbs") or []):
            m = c.get("moving_min")
            if m and (i not in out or m < out[i]["moving_min"]):
                out[i] = {"moving_min": m, "date": r["date"], "activity_id": r["activity_id"]}
    return out


def rides(conn, cid: int) -> list[dict]:
    """The route's rides, newest first: how each went against the plan."""
    out = []
    try:
        rows = conn.execute(
            """SELECT r.activity_id, r.date, r.covered_km, r.review_json, a.source, a.name
               FROM coll_reviews r LEFT JOIN activities a ON a.id = r.activity_id
               WHERE r.course_id=? ORDER BY r.date DESC""", (cid,)).fetchall()
    except sqlite3.OperationalError:
        return []
    for r in rows:
        rv = json.loads(r["review_json"] or "{}")
        out.append({"activity_id": r["activity_id"], "date": r["date"], "source": r["source"], "name": r["name"],
                    "covered_km": r["covered_km"], "route_km": rv.get("route_km"),
                    "predicted_min": rv.get("predicted_min"), "moving_min": rv.get("moving_min"),
                    "elapsed_min": rv.get("elapsed_min"), "delta_min": rv.get("delta_min"),
                    "fuel_g_h": (rv.get("fuel") or {}).get("carbs_g_h")})
    return out


def after_ride(conn, aid: str, log=print) -> None:
    """A Coll ride arrived (or was re-imported): review it against its route."""
    r = conn.execute("SELECT course_id FROM coll_rides WHERE activity_id=? AND course_id IS NOT NULL LIMIT 1",
                     (aid,)).fetchone()
    try:
        if r:
            store(conn, aid, r[0])
        else:
            scan(conn, days=3, log=log)
    except Exception as e:                                       # noqa: BLE001
        log(f"review {aid}: {e}")


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    c = get_connection()
    try:
        print(f"{scan(c, days=30)} ride(s) reviewed against their route")
    finally:
        c.close()
