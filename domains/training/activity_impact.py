"""
Training impact of one activity — the "so what" next to the raw metrics.

  load        TSS of this session (power → Garmin/Strava TSS → hrTSS), its share of
              the week's load, and fitness/fatigue/form (CTL/ATL/TSB, combined) the
              day before vs after it.
  efficiency  aerobic efficiency factor (output per heartbeat, from activity_detail)
              vs your recent similar sessions (same sport, indoor/outdoor, comparable
              duration) — the cleanest "am I getting fitter" signal.
  race        for rides while a Mallorca 312 goal is active: distance and climbing
              vs the race and vs your longest ride so far, durability (HR drift) on
              long rides and carbs/h vs the fuelling target.

Cheap queries only; not cached (the week and the load model keep moving).
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from statistics import median

from domains.health.activity_analysis import is_indoor, sport_of

RACE_KM = {"mallorca_312": 312.0}
RACE_CLIMB_M = {"mallorca_312": 4750.0}
LONG_RIDE_MIN = 150


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _tss(conn, act, t, analysis) -> tuple[float | None, str | None]:
    if analysis and (analysis.get("power") or {}).get("tss"):
        return float(analysis["power"]["tss"]), "power"
    if act["training_stress_score"]:
        return float(act["training_stress_score"]), "device"
    if "activity_detail" in t:
        r = conn.execute("SELECT hr_tss FROM activity_detail WHERE activity_id=?", (act["id"],)).fetchone()
        if r and r[0]:
            return float(r[0]), "heart rate"
    return None, None


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


def _efficiency(conn, act, sport, t) -> dict | None:
    if "activity_detail" not in t:
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
               and dur and r["dur"] and 0.5 <= r["dur"] / dur <= 2.0][:8]
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
        "efficiency": _efficiency(conn, act, sport, t),
        "race": _race(conn, act, sport, t, analysis, fuel_target_fn),
    }
    if not any((out["tss"], out["load"], out["efficiency"], out["race"])):
        return None
    return out
