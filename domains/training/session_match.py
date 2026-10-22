"""
Which plan session did this activity really fulfil?

Auto-linking pairs an activity with that day's session by discipline only, so
a hard ride on an easy day counts as the easy ride. Here every session of the
same goal/week and sport is scored against what was actually done:

  intensity  where the HR sat on your zones — time-in-zone mean from the cached
             analysis (1 Hz), else avg HR placed inside its band — vs the
             session's zone (65 % of the score)
  duration   moving time vs the session's minutes, log-ratio (35 %)

and a clearly better session is suggested. `swap` relinks the activity to it
and gives the session you skipped its slot, back to pending, so the week's
plan stays whole.
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, timedelta

from domains.health.activity_analysis import _hr_bands, _zone_row, sport_of

_DISC_SPORT = {"cycling": {"ride"}, "running": {"run"}, "swimming": {"swim"}, "brick": {"ride", "run"}}
_SUGGEST_MIN = 0.6       # the alternative must fit well…
_SUGGEST_GAIN = 0.2      # …and clearly better than the current link


def _zone_num(z: str | None) -> int | None:
    return int(z[1]) if z and len(z) >= 2 and z[0].upper() == "Z" and z[1].isdigit() else None


def activity_intensity(conn: sqlite3.Connection, act) -> float | None:
    """Continuous zone (1.0–5.0) the activity was ridden/run at."""
    try:
        r = conn.execute("SELECT result_json FROM activity_analysis WHERE activity_id=?", (act["id"],)).fetchone()
        zones = ((json.loads(r[0]) if r and r[0] else {}).get("hr") or {}).get("zones") or []
    except (sqlite3.OperationalError, ValueError):
        zones = []
    tot = sum(z.get("secs") or 0 for z in zones)
    if tot:
        return sum((_zone_num(z.get("zone")) or 1) * (z.get("secs") or 0) for z in zones) / tot
    hr = act["avg_heart_rate"]
    if not hr:
        return None
    sport = sport_of(act["activity_type"])
    bands, _ = _hr_bands(_zone_row(conn, sport if sport in ("ride", "run", "swim") else "run", act["date"]),
                         act["max_heart_rate"])
    for i, (_, lo, hi) in enumerate(bands):
        if hr < hi or i == len(bands) - 1:
            frac = max(0.0, min(1.0, (hr - lo) / (hi - lo))) if hi > lo else 0.5
            return i + 1 + frac - 0.5
    return None


def score(intensity: float | None, minutes: float, zone: str | None, planned_min: float | None) -> float:
    zn = _zone_num(zone)
    zone_pen = min(1.0, abs(intensity - zn) / 2) if intensity is not None and zn else 0.5
    dur_pen = (min(1.0, abs(math.log(minutes / planned_min)) / math.log(2))
               if minutes > 0 and planned_min else 0.5)
    return round(1 - (0.65 * zone_pen + 0.35 * dur_pen), 2)


def _week(d: str) -> tuple[str, str]:
    x = date.fromisoformat(d)
    mon = x - timedelta(days=x.weekday())
    return mon.isoformat(), (mon + timedelta(days=6)).isoformat()


def _session(s, sc: float) -> dict:
    return {"id": s["id"], "session_type": s["session_type"], "session_date": s["session_date"],
            "intensity_zone": s["intensity_zone"], "status": s["status"],
            "duration_min": s["effective_duration_min"] or s["duration_min"], "score": sc}


def suggest(conn: sqlite3.Connection, activity_id: str) -> dict | None:
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if act is None:
        return None
    sport = sport_of(act["activity_type"])
    current = conn.execute("SELECT * FROM plan_sessions WHERE completed_activity_id=? LIMIT 1", (activity_id,)).fetchone()
    mon, sun = _week(act["date"])
    goal_clause, params = "", [mon, sun]
    if current is not None:
        goal_clause, params = " AND goal_id=?", [mon, sun, current["goal_id"]]
    rows = conn.execute(
        f"""SELECT * FROM plan_sessions WHERE session_date BETWEEN ? AND ?{goal_clause}
            AND (status='pending' OR completed_activity_id=?)""", (*params, activity_id)).fetchall()
    rows = [s for s in rows if sport in _DISC_SPORT.get(s["discipline"], set())]
    if not rows:
        return None
    intensity = activity_intensity(conn, act)
    minutes = (act["moving_time_seconds"] or act["duration_seconds"] or 0) / 60
    scored = sorted(((score(intensity, minutes, s["intensity_zone"], s["effective_duration_min"] or s["duration_min"]), s)
                     for s in rows), key=lambda x: -x[0])
    cur = next(((sc, s) for sc, s in scored if current is not None and s["id"] == current["id"]), None)
    best_sc, best = next(((sc, s) for sc, s in scored if current is None or s["id"] != current["id"]), (None, None))
    better = (best is not None and best_sc >= _SUGGEST_MIN
              and (cur is None or best_sc - cur[0] >= _SUGGEST_GAIN))
    return {
        "activity": {"intensity_zone": round(intensity, 1) if intensity is not None else None,
                     "minutes": round(minutes)},
        "current": _session(cur[1], cur[0]) if cur else None,
        "suggestion": _session(best, best_sc) if better else None,
    }


def swap(conn: sqlite3.Connection, activity_id: str, to_session_id: int) -> dict:
    """Link the activity to `to_session_id`; the session it leaves takes that slot, back to pending."""
    act = conn.execute("SELECT date FROM activities WHERE id=?", (activity_id,)).fetchone()
    to = conn.execute("SELECT * FROM plan_sessions WHERE id=?", (to_session_id,)).fetchone()
    if act is None or to is None:
        raise ValueError("activity or session not found")
    if to["completed_activity_id"] and to["completed_activity_id"] != activity_id:
        raise ValueError("that session is already linked to another activity")
    frm = conn.execute("SELECT * FROM plan_sessions WHERE completed_activity_id=? AND id!=?",
                       (activity_id, to_session_id)).fetchone()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(plan_sessions)")}
    auto = ", auto_matched=0" if "auto_matched" in cols else ""
    now = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    # the session that was skipped takes the freed slot when it's still ahead, else stays put — to do either way
    moved_to = None
    if frm is not None:
        moved_to = to["session_date"] if to["session_date"] > act["date"] else frm["session_date"]
        conn.execute(f"""UPDATE plan_sessions SET completed_activity_id=NULL, status='pending', rpe_actual=NULL,
                         session_date=?{auto}, updated_at={now} WHERE id=?""", (moved_to, frm["id"]))
    conn.execute(f"""UPDATE plan_sessions SET completed_activity_id=?, status='completed', session_date=?,
                     rpe_actual=COALESCE(rpe_actual, ?){auto}, updated_at={now} WHERE id=?""",
                 (activity_id, act["date"], frm["rpe_actual"] if frm is not None else None, to_session_id))
    if frm is not None:
        try:
            conn.execute("UPDATE fueling_logs SET plan_session_id=? WHERE plan_session_id=? AND "
                         "(activity_id=? OR activity_id IS NULL)", (to_session_id, frm["id"], activity_id))
        except sqlite3.OperationalError:
            pass
    conn.commit()
    return {"linked": to_session_id, "moved": frm["id"] if frm is not None else None, "moved_to": moved_to}
