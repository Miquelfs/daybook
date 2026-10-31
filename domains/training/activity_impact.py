"""
Training impact of one activity — the "so what" next to the raw metrics.

  load        TSS of this session (power → Garmin/Strava TSS → hrTSS), its share of
              the week's load, and fitness/fatigue/form (CTL/ATL/TSB, combined) the
              day before vs after it.
  efficiency  aerobic efficiency factor (output per heartbeat, from activity_detail)
              vs your recent similar sessions (same sport, indoor/outdoor, comparable
              duration) — the cleanest "am I getting fitter" signal.
  strain      Whoop-style 0–21 cardiovascular strain: zone-weighted minutes (Edwards
              TRIMP) on a saturating scale — every extra point is harder to earn.
  race        for rides while a Mallorca 312 goal is active: distance and climbing
              vs the race and vs your longest ride so far, durability (HR drift) on
              long rides and carbs/h vs the fuelling target.

Cheap queries only; not cached (the week and the load model keep moving).
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, timedelta
from statistics import median

from domains.health.activity_analysis import is_indoor, sport_of
from domains.health.geo import Grid, activity_track, decode, sample

RACE_KM = {"mallorca_312": 312.0}
RACE_CLIMB_M = {"mallorca_312": 4750.0}
LONG_RIDE_MIN = 150


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _tss(conn, act, t, analysis) -> tuple[float | None, str | None]:
    # estimated power (no meter on the road bike) never sets the load — heart-rate TSS until a real meter
    if analysis and (analysis.get("power") or {}).get("tss") and not analysis["power"].get("estimated"):
        return float(analysis["power"]["tss"]), "power"
    if act["training_stress_score"]:
        return float(act["training_stress_score"]), "device"
    if "activity_detail" in t:
        r = conn.execute("SELECT hr_tss FROM activity_detail WHERE activity_id=?", (act["id"],)).fetchone()
        if r and r[0]:
            return float(r[0]), "heart rate"
    return None, None


STRAIN_K = 165.0    # TRIMP that reaches ~63 % of the scale (≈ 2 h easy aerobic ride → ~14)


def strain_from_trimp(trimp: float) -> float:
    return round(21 * (1 - math.exp(-max(0.0, trimp) / STRAIN_K)), 1)


def zone_trimp(conn, activity_id: str, t: set[str], analysis: dict | None = None) -> float | None:
    """Zone-weighted minutes (Z1×1 … Z5×5). Prefers the 1 Hz analysis zones (passed in or cached)."""
    if analysis is None and "activity_analysis" in t:
        r = conn.execute("SELECT result_json FROM activity_analysis WHERE activity_id=?", (activity_id,)).fetchone()
        try:
            analysis = json.loads(r[0]) if r and r[0] else None
        except ValueError:
            analysis = None
    secs: dict[int, float] = {}
    for z in ((analysis or {}).get("hr") or {}).get("zones") or []:
        name = str(z.get("zone", ""))
        if name[1:].isdigit():
            secs[int(name[1:])] = float(z.get("secs") or 0)
    if not secs and "activity_detail" in t:
        try:
            r = conn.execute("SELECT zones_json FROM activity_detail WHERE activity_id=?", (activity_id,)).fetchone()
            if r and r[0]:
                secs = {int(k[1]): float(v or 0) for k, v in json.loads(r[0]).items() if k[1:2].isdigit()}
        except (sqlite3.OperationalError, ValueError, TypeError):
            secs = {}
    if not sum(secs.values()):
        return None
    return sum(s / 60 * z for z, s in secs.items())


def strain_label(v: float) -> str:
    return "light" if v < 10 else "moderate" if v < 14 else "high" if v < 18 else "all out"


def _strain(conn, act, t, analysis) -> dict | None:
    trimp = zone_trimp(conn, act["id"], t, analysis)
    if trimp is None:
        return None
    v = strain_from_trimp(trimp)
    return {"value": v, "trimp": round(trimp), "label": strain_label(v)}


def _load(conn, d: str, tss: float | None, t) -> dict | None:
    if "training_load_daily" not in t:
        return None
    prev_d = (date.fromisoformat(d) - timedelta(days=1)).isoformat()
    q = "SELECT ctl, atl, tsb, daily_tss FROM training_load_daily WHERE sport='combined' AND date=?"
    before, after = conn.execute(q, (prev_d,)).fetchone(), conn.execute(q, (d,)).fetchone()
    mon = date.fromisoformat(d) - timedelta(days=date.fromisoformat(d).weekday())
    week = conn.execute("SELECT SUM(daily_tss) FROM training_load_daily WHERE sport='combined' AND date BETWEEN ? AND ?",
                        (mon.isoformat(), (mon + timedelta(days=6)).isoformat())).fetchone()[0]
    if not after or after["ctl"] is None:
        return {"week_tss": round(week) if week else None,
                "week_share_pct": round(tss / week * 100) if tss and week else None}
    ctl0 = before["ctl"] if before and before["ctl"] is not None else after["ctl"]
    atl0 = before["atl"] if before and before["atl"] is not None else after["atl"]
    form_next = after["ctl"] - after["atl"]
    return {
        "fitness": round(after["ctl"], 1), "fitness_delta": round(after["ctl"] - ctl0, 1),
        "fatigue": round(after["atl"], 1), "fatigue_delta": round(after["atl"] - atl0, 1),
        "form_before": round(before["tsb"], 1) if before and before["tsb"] is not None else None,
        "form_next": round(form_next, 1),
        "form_label": ("fresh" if form_next > 5 else "neutral" if form_next > -10
                       else "productive fatigue" if form_next > -30 else "deep fatigue — plan easy days"),
        "week_tss": round(week) if week else None,
        "week_share_pct": round(tss / week * 100) if tss and week else None,
    }


def _intervals_of(conn, ids) -> set:
    """Activities whose cached analysis found an interval set."""
    if not ids:
        return set()
    try:
        rows = conn.execute("SELECT activity_id, result_json FROM activity_analysis WHERE activity_id IN ({})"
                            .format(",".join("?" * len(ids))), tuple(ids)).fetchall()
    except sqlite3.OperationalError:
        return set()
    return {r[0] for r in rows if r[1] and '"intervals": {' in r[1]}


def _efficiency(conn, act, sport, t, analysis=None) -> dict | None:
    if "activity_detail" not in t:
        return None
    # output per heartbeat only compares like with like: reps and recoveries aren't a steady effort
    if (analysis or {}).get("intervals"):
        return None
    me = conn.execute("SELECT efficiency_factor FROM activity_detail WHERE activity_id=?", (act["id"],)).fetchone()
    if not me or not me[0]:
        return None
    dur = act["moving_time_seconds"] or act["duration_seconds"] or 0
    since = (date.fromisoformat(act["date"]) - timedelta(days=180)).isoformat()
    rows = conn.execute(
        """SELECT a.id, a.date, a.activity_type, COALESCE(a.moving_time_seconds, a.duration_seconds) AS dur,
                  d.efficiency_factor AS ef
           FROM activities a JOIN activity_detail d ON d.activity_id = a.id
           WHERE a.date >= ? AND (a.date < ? OR (a.date = ? AND a.id != ?)) AND d.efficiency_factor IS NOT NULL
           ORDER BY a.date DESC""", (since, act["date"], act["date"], act["id"])).fetchall()
    indoor = is_indoor(act["activity_type"])
    similar = [r for r in rows if sport_of(r["activity_type"]) == sport and is_indoor(r["activity_type"]) == indoor
               and dur and r["dur"] and 0.5 <= r["dur"] / dur <= 2.0][:16]
    reps = _intervals_of(conn, [r["id"] for r in similar])
    similar = [r for r in similar if r["id"] not in reps][:8]
    if len(similar) < 3:
        return {"ef": round(me[0], 3), "n": len(similar), "trend": None}
    base = median(r["ef"] for r in similar)
    pct = (me[0] / base - 1) * 100
    return {
        "ef": round(me[0], 3), "baseline": round(base, 3), "pct": round(pct, 1), "n": len(similar),
        "history": [{"date": r["date"], "ef": round(r["ef"], 3)} for r in reversed(similar)]
                   + [{"date": act["date"], "ef": round(me[0], 3), "this": True}],
        "verdict": ("More output per heartbeat than your recent similar sessions — aerobic fitness is building"
                    if pct >= 3 else
                    "Less output per heartbeat than usual — fatigue, heat or a bad night can all do this"
                    if pct <= -3 else "In line with your recent similar sessions"),
    }


def _race(conn, act, sport, t, analysis, fuel_target_fn) -> dict | None:
    if sport != "ride" or "race_goals" not in t:
        return None
    g = conn.execute("SELECT * FROM race_goals WHERE status='active' AND race_type IN ({}) ORDER BY race_date LIMIT 1"
                     .format(",".join("?" * len(RACE_KM))), tuple(RACE_KM)).fetchone()
    if not g or act["date"] > g["race_date"]:
        return None
    km = (act["distance_meters"] or 0) / 1000
    climb = act["elevation_gain_meters"] or 0
    mins = round((act["moving_time_seconds"] or act["duration_seconds"] or 0) / 60)
    prev_long = conn.execute(
        """SELECT MAX(distance_meters) FROM activities
           WHERE date < ? AND date >= ? AND (lower(activity_type) LIKE '%cycl%' OR lower(activity_type) LIKE '%bik%'
                 OR lower(activity_type) LIKE '%ride%') AND lower(activity_type) NOT LIKE '%indoor%'
                 AND lower(activity_type) NOT LIKE '%virtual%'""",
        (act["date"], (date.fromisoformat(act["date"]) - timedelta(days=365)).isoformat())).fetchone()[0]
    prev_long_km = (prev_long or 0) / 1000
    out = {
        "goal": g["name"], "race_km": RACE_KM[g["race_type"]], "race_climb_m": RACE_CLIMB_M[g["race_type"]],
        "km": round(km, 1), "climb_m": round(climb),
        "km_pct": round(km / RACE_KM[g["race_type"]] * 100), "climb_pct": round(climb / RACE_CLIMB_M[g["race_type"]] * 100),
        "longest_before_km": round(prev_long_km, 1) if prev_long_km else None,
        "is_longest": bool(km > prev_long_km + 0.5 and km > 30),
        "weeks_to_race": max(0, (date.fromisoformat(g["race_date"]) - date.fromisoformat(act["date"])).days // 7),
        "durability": None, "fuel": None,
    }
    if mins >= LONG_RIDE_MIN:
        dec = ((analysis or {}).get("hr") or {}).get("decoupling_pct")
        if dec is not None:
            out["durability"] = {"decoupling_pct": round(dec, 1), "ok": dec < 5,
                                 "note": "held steady — the engine a 312 needs" if dec < 5
                                 else "HR crept up in the second half — more long Z2 and fuel earlier"}
        try:
            from domains.training.ride_quality import ride_carbs
            ps = conn.execute("SELECT id, intensity_zone FROM plan_sessions WHERE completed_activity_id=? LIMIT 1",
                              (act["id"],)).fetchone() if "plan_sessions" in t else None
            carbs = ride_carbs(conn, ps["id"] if ps else None, act["id"], act["date"])
            target = fuel_target_fn(mins, ps["intensity_zone"] if ps else "Z2", "cycling") if fuel_target_fn else None
            got = round(carbs["carbs_g"] / (mins / 60)) if carbs.get("carbs_g") else None
            out["fuel"] = {"carbs_g": carbs.get("carbs_g") or 0, "carbs_g_h": got, "target_g_h": target,
                           "items": carbs.get("items", [])[:6],
                           "ok": bool(got and target and got >= target * 0.85)}
        except Exception:
            pass
    return out


ROUTE_OVERLAP = 0.75     # share of each ride that must lie on the other
ROUTE_STEP_M = 100


def _json_col(conn, table: str, activity_id: str, t) -> dict:
    if table not in t:
        return {}
    try:
        r = conn.execute(f"SELECT result_json FROM {table} WHERE activity_id=?", (activity_id,)).fetchone()
        return json.loads(r[0]) if r and r[0] else {}
    except (sqlite3.OperationalError, ValueError):
        return {}


def _route_context(conn, aid: str, d: str, t) -> dict:
    """What the conditions were: wind, temperature, form going into the day."""
    w = _json_col(conn, "activity_wind", aid, t)
    temp = (_json_col(conn, "activity_analysis", aid, t).get("temp_c") or {}).get("avg")
    form = None
    if "training_load_daily" in t:
        r = conn.execute("SELECT tsb FROM training_load_daily WHERE sport='combined' AND date=?", (d,)).fetchone()
        form = round(r[0]) if r and r[0] is not None else None
    return {"headwind_kmh": w.get("avg_headwind_kmh"), "wind_kmh": w.get("wind_kmh"),
            "head_pct": (w.get("pct") or {}).get("head"), "temp_c": temp, "form": form}


def _overlap(mine_grid: Grid, mine: list, theirs: list) -> tuple[float, bool]:
    """min(share of theirs near mine, share of mine near theirs) and whether ridden the same way round."""
    hits = [mine_grid.near(p) for p in theirs]
    a = sum(1 for h in hits if h is not None) / len(theirs)
    tg = Grid(60, mine[0][0])
    for p in theirs:
        tg.add(p)
    b = sum(1 for p in mine if tg.near(p)) / len(mine)
    idx = [h for h in hits if h is not None]
    inc = sum(1 for x, y in zip(idx, idx[1:]) if y > x)
    dec = sum(1 for x, y in zip(idx, idx[1:]) if y < x)
    return min(a, b), inc >= dec


def _verdict(me: dict, prev: dict, run: bool) -> dict:
    sp = (me["mps"] / prev["mps"] - 1) * 100
    out: dict = {"speed_pct": round(sp, 1), "vs_date": prev["date"]}
    parts = []
    if run:
        parts.append("same pace" if abs(sp) < 1 else f"{abs(sp):.0f}% {'faster' if sp > 0 else 'slower'}")
    else:
        dk = (me["mps"] - prev["mps"]) * 3.6
        parts.append("same speed" if abs(dk) < 0.3 else f"{abs(dk):.1f} km/h {'faster' if dk > 0 else 'slower'}")
    if me.get("hr") and prev.get("hr"):
        dh = me["hr"] - prev["hr"]
        out["hr_delta"] = round(dh)
        parts.append("at the same heart rate" if abs(dh) < 3 else f"at {abs(dh):.0f} bpm {'higher' if dh > 0 else 'lower'} HR")
        eff = ((me["mps"] / me["hr"]) / (prev["mps"] / prev["hr"]) - 1) * 100
        out["efficiency_pct"] = round(eff, 1)
    else:
        eff = None
    hw, phw = me.get("headwind_kmh"), prev.get("headwind_kmh")
    wind_note = None
    if hw is not None and phw is not None and abs(hw - phw) >= 2:
        out["headwind_delta"] = round(hw - phw, 1)
        wind_note = (f"{abs(hw - phw):.0f} km/h more headwind on average" if hw > phw
                     else f"{abs(hw - phw):.0f} km/h more help from the wind")
        parts.append(wind_note)
    tc, ptc = me.get("temp_c"), prev.get("temp_c")
    if tc is not None and ptc is not None and abs(tc - ptc) >= 6:
        parts.append(f"{abs(tc - ptc):.0f}°C {'hotter' if tc > ptc else 'cooler'}")
    if eff is None:
        read = None
    elif eff >= 3:
        read = "more speed per heartbeat — fitter on this route"
    elif eff <= -3:
        read = ("less speed per heartbeat — the wind explains part of it" if wind_note and hw > phw
                else "less speed per heartbeat than last time — tired, hot or under-fuelled?")
    else:
        read = ("same speed per heartbeat — an easier day, same fitness" if out.get("hr_delta", 0) <= -5
                else "same speed per heartbeat — same fitness")
    out["text"] = ", ".join(parts)
    out["read"] = read
    return out


def _matched(conn, act, sport) -> dict | None:
    """Same route = the GPS tracks overlap (≥ 75 % each way), not just a nearby start and a similar distance."""
    if is_indoor(act["activity_type"]) or not act["distance_meters"]:
        return None
    cols = {r[1] for r in conn.execute("PRAGMA table_info(activities)")}
    if "polyline" not in cols or not act["polyline"]:
        return None
    t = _tables(conn)
    mine = sample(activity_track(conn, act["id"], act["polyline"]), ROUTE_STEP_M)
    if len(mine) < 10:
        return None
    grid = Grid(60, mine[0][0])                    # ~60–120 m tolerance; value = position along my ride
    for i, p in enumerate(mine):
        grid.add(p, i)
    lat0, lat1 = min(p[0] for p in mine), max(p[0] for p in mine)
    lng0, lng1 = min(p[1] for p in mine), max(p[1] for p in mine)
    d = act["distance_meters"]
    rows = conn.execute(
        """SELECT id, date, name, activity_type, distance_meters, COALESCE(moving_time_seconds, duration_seconds) AS t,
                  avg_heart_rate, polyline FROM activities
           WHERE polyline IS NOT NULL AND polyline != '' AND distance_meters BETWEEN ? AND ? AND date >= ? AND id != ?
           ORDER BY date""",
        (d * 0.8, d * 1.25, (date.fromisoformat(act["date"]) - timedelta(days=730)).isoformat(), act["id"])).fetchall()
    found = []
    for r in rows:
        if sport_of(r["activity_type"]) != sport or is_indoor(r["activity_type"]) or not r["t"]:
            continue
        theirs = sample(decode(r["polyline"]), ROUTE_STEP_M)
        if len(theirs) < 10 or not any(lat0 - .01 <= p[0] <= lat1 + .01 and lng0 - .01 <= p[1] <= lng1 + .01
                                       for p in theirs[:: max(1, len(theirs) // 20)]):
            continue
        ov, same_dir = _overlap(grid, mine, theirs)
        if ov >= ROUTE_OVERLAP:
            found.append((r, ov, same_dir))
    if not found:
        return None

    def item(r, ov, same_dir, this=False):
        x = {"id": r["id"], "date": r["date"], "name": r["name"], "secs": r["t"], "km": round(r["distance_meters"] / 1000, 2),
             "mps": r["distance_meters"] / r["t"], "hr": r["avg_heart_rate"], "this": this,
             "overlap_pct": round(ov * 100), "same_direction": same_dir}
        x.update(_route_context(conn, r["id"], r["date"], t))
        return x

    me_row = {"id": act["id"], "date": act["date"], "name": act["name"] if "name" in act.keys() else None,
              "t": act["moving_time_seconds"] or act["duration_seconds"], "distance_meters": d,
              "avg_heart_rate": act["avg_heart_rate"] if "avg_heart_rate" in act.keys() else None}
    if not me_row["t"]:
        return None
    items = sorted([item(r, ov, sd) for r, ov, sd in found] + [item(me_row, 1.0, True, this=True)],
                   key=lambda i: (i["date"], i["this"]))
    mine_i = next(i for i in items if i["this"])
    same = [i for i in items if i["same_direction"]]
    group = same if len(same) >= 2 else items
    ranked = sorted(group, key=lambda i: -i["mps"])
    prev = [i for i in group if not i["this"] and i["date"] <= mine_i["date"]]
    with_hr = [i for i in group if i.get("hr")]
    best_eff = max(with_hr, key=lambda i: i["mps"] / i["hr"]) if with_hr else None
    return {"n": len(group), "n_reverse": len(items) - len(same), "rank": ranked.index(mine_i) + 1,
            "best": ranked[0], "best_efficiency": best_eff,
            "vs_last_pct": round((mine_i["mps"] / prev[-1]["mps"] - 1) * 100, 1) if prev else None,
            "verdict": _verdict(mine_i, prev[-1], sport == "run") if prev else None,
            "items": items[-12:]}


def _cols(conn, activity_id: str) -> list[dict]:
    try:
        from domains.locations.cols import for_activity
        return for_activity(conn, activity_id)
    except Exception:
        return []


def _climbs(conn, activity_id: str) -> list[dict]:
    try:
        from domains.locations.climbs import for_activity
        return for_activity(conn, activity_id)
    except Exception:
        return []


def impact(conn: sqlite3.Connection, activity_id: str, analysis: dict | None = None,
           fuel_target_fn=None) -> dict | None:
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if act is None:
        return None
    t = _tables(conn)
    sport = sport_of(act["activity_type"])
    tss, tss_source = _tss(conn, act, t, analysis)
    out = {
        "tss": round(tss) if tss else None, "tss_source": tss_source,
        "load": _load(conn, act["date"], tss, t),
        "strain": _strain(conn, act, t, analysis),
        "efficiency": _efficiency(conn, act, sport, t, analysis),
        "race": _race(conn, act, sport, t, analysis, fuel_target_fn),
        "matched": _matched(conn, act, sport),
        "cols": _cols(conn, act["id"]),
        "climbs": _climbs(conn, act["id"]),
    }
    if not any((out["tss"], out["load"], out["strain"], out["efficiency"], out["race"], out["matched"], out["cols"], out["climbs"])):
        return None
    return out
