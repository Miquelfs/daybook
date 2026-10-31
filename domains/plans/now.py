"""
Today's "what now?" — the one thing that matters at this moment, plus up to three things next.

Built from what Daybook already knows: the roster (local report / end times), the race plan's
sessions for the day with day_context's advice (ride window around duty, layovers…), open
tasks, last night's sleep and tomorrow's duty. Time of day decides the headline:

  before report        → "Report 06:55" · in 2h 10m
  on duty / standby    → "On duty until 16:20"
  a session to do      → "Long Ride · 2h Z2" + today's advice
  session done, no RPE → "How did the Long Ride feel?"
  evening, early start → "Early start tomorrow" · lights out by 21:30
  otherwise            → the day's shape ("Day off", "Free evening")
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from domains.training.day_context import day_context, today_advice

SLEEP_NEED_MIN = 8 * 60 + 30       # 8 h asleep + 30 min to fall asleep, before an early report
EARLY_REPORT = 8 * 60              # report before 08:00 = early start
EVENING = 19 * 60


def _m(hhmm: str | None) -> int | None:
    if not hhmm or len(hhmm) < 4:
        return None
    try:
        h, m = hhmm[:5].split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def _hm(m: int) -> str:
    m %= 24 * 60
    return f"{m // 60:02d}:{m % 60:02d}"


def _dur(m: int) -> str:
    h, mm = divmod(max(0, m), 60)
    return f"{h}h {mm:02d}m" if h else f"{mm} min"


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


DUTY_LABEL = {"flying_duty": "Flying duty", "ground_duty": "Ground duty", "standby": "Standby",
              "vacation": "Vacation", "day_off": "Day off"}


def _sessions(conn, d: str, t: set[str]) -> list[dict]:
    if "plan_sessions" not in t:
        return []
    rows = conn.execute(
        """SELECT p.* FROM plan_sessions p JOIN race_goals g ON g.id = p.goal_id
           WHERE g.status = 'active' AND p.session_date = ? AND p.status NOT IN ('displaced', 'skipped')
           ORDER BY p.is_optional, COALESCE(p.effective_duration_min, p.duration_min) DESC""", (d,)).fetchall()
    return [dict(r) for r in rows]


def _name(s: dict) -> str:
    return (s.get("session_type") or "Session").split(" - ", 1)[-1]


def _what(s: dict) -> str:
    mins = s.get("effective_duration_min") or s.get("duration_min") or 0
    return f"{_dur(mins)} · {s.get('intensity_zone') or ''}".strip(" ·")


def now(conn: sqlite3.Connection, d: str, hhmm: str) -> dict:
    t = _tables(conn)
    now_m = _m(hhmm) or 12 * 60
    ctx = day_context(conn, d)
    nxt = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
    tomorrow = conn.execute("SELECT duty_type, report_time, end_time FROM roster WHERE date=?", (nxt,)).fetchone() \
        if "roster" in t else None
    sessions = _sessions(conn, d, t)
    pending = [s for s in sessions if s["status"] == "pending"]
    unrated = [s for s in sessions if s["status"] == "completed" and s.get("rpe_actual") is None]
    tasks = conn.execute(
        """SELECT id, title, due_date, due_time FROM tasks WHERE kind = 'task' AND done_at IS NULL
           AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date, due_time IS NULL, due_time""", (d,)).fetchall() \
        if "tasks" in t else []

    duty, rep, end = ctx.get("duty"), _m(ctx.get("report_time")), _m(ctx.get("end_time"))
    if end is not None and rep is not None and end <= rep:
        end += 24 * 60                                   # finishes after midnight
    working = duty in ("flying_duty", "ground_duty", "standby")
    head: dict | None = None
    used: set[str] = set()

    # 1 · duty frames the day
    if working and rep is not None:
        if now_m < rep and duty != "standby":
            head = {"kind": "duty", "title": f"Report {ctx['report_time']}",
                    "detail": f"in {_dur(rep - now_m)} · {DUTY_LABEL.get(duty, 'Duty')}"
                              + (f" until {ctx['end_time']}" if ctx.get("end_time") else ""), "href": f"/day/{d}"}
        elif end is not None and rep <= now_m < end:
            head = {"kind": "duty", "title": f"{'On standby' if duty == 'standby' else 'On duty'} until {_hm(end)}",
                    "detail": ctx.get("label") or DUTY_LABEL.get(duty, ""), "href": f"/day/{d}"}
    # 2 · a session still to do (before the evening)
    if head is None and pending and now_m < EVENING + 60:
        s = pending[0]
        adv = today_advice(ctx, s)
        detail = _what(s)
        if adv.get("duration_min"):
            detail += f" → {_dur(adv['duration_min'])}"
        head = {"kind": "train", "title": _name(s), "detail": detail,
                "note": (adv.get("notes") or [None])[0], "href": f"/day/{d}"}
        used.add(f"s{s['id']}")
    # 3 · done but not rated
    if head is None and unrated:
        s = unrated[0]
        head = {"kind": "rpe", "title": f"How did the {_name(s)} feel?",
                "detail": "Rate it — the coach and next week's plan read it",
                "href": f"/activity/{s['completed_activity_id']}" if s.get("completed_activity_id") else f"/day/{d}"}
        used.add(f"r{s['id']}")
    # 4 · evening before an early start
    t_rep = _m(tomorrow["report_time"]) if tomorrow else None
    early = bool(tomorrow and tomorrow["duty_type"] in ("flying_duty", "ground_duty", "standby")
                 and t_rep is not None and t_rep < EARLY_REPORT)
    if head is None and early and now_m >= EVENING - 60:
        lights = t_rep - SLEEP_NEED_MIN + 24 * 60          # tonight, in today's minutes
        bed = f"lights out by {_hm(lights)}" if lights > now_m else "lights out as soon as you can"
        head = {"kind": "sleep", "title": "Early start tomorrow",
                "detail": f"{DUTY_LABEL.get(tomorrow['duty_type'], 'Duty')} {tomorrow['report_time']} · {bed}",
                "href": f"/day/{nxt}"}
        used.add("tomorrow")
    # 5 · the day's shape
    if head is None:
        part = "morning" if now_m < 12 * 60 else "afternoon" if now_m < 18 * 60 else "evening"
        if duty == "vacation":
            head = {"kind": "free", "title": "Vacation", "detail": "Nothing planned — enjoy it", "href": f"/day/{d}"}
        elif working and end is not None and now_m >= end:
            head = {"kind": "free", "title": f"Free {part}", "detail": f"Duty done at {_hm(end)}", "href": f"/day/{d}"}
        else:
            head = {"kind": "free", "title": "Day off" if duty == "day_off" else f"Free {part}",
                    "detail": "Nothing scheduled", "href": f"/day/{d}"}

    # Next: up to three lines, not repeating the headline
    lines: list[dict] = []
    for s in pending:
        if f"s{s['id']}" not in used and head["kind"] != "train":
            lines.append({"kind": "train", "text": f"{_name(s)} · {_what(s)}", "href": f"/day/{d}"})
            break
    for s in unrated:
        if f"r{s['id']}" not in used:
            lines.append({"kind": "rpe", "text": f"Rate the {_name(s)}",
                          "href": f"/activity/{s['completed_activity_id']}" if s.get("completed_activity_id") else f"/day/{d}"})
            break
    if tasks:
        overdue = sum(1 for r in tasks if r["due_date"] < d)
        first = tasks[0]["title"]
        more = f" +{len(tasks) - 1}" if len(tasks) > 1 else ""
        lines.append({"kind": "task", "text": f"{first}{more}" + (f" · {overdue} overdue" if overdue else ""),
                      "href": "/plan"})
    if tomorrow and "tomorrow" not in used and tomorrow["duty_type"] not in (None, "day_off"):
        span = f" {tomorrow['report_time']}" + (f"–{tomorrow['end_time']}" if tomorrow["end_time"] else "") \
            if tomorrow["report_time"] and tomorrow["duty_type"] != "vacation" else ""
        lines.append({"kind": "duty", "text": f"Tomorrow: {DUTY_LABEL.get(tomorrow['duty_type'], 'Duty')}{span}",
                      "href": f"/day/{nxt}"})
    return {"date": d, "time": _hm(now_m), "head": head, "next": lines[:3]}
