"""
Calendar marks — what makes a day stand out, for the day picker.

  trip          a day inside a detected trip (or 'trip_planned' for one ahead)
  event         a life event
  achievement   a goal marked done that day, or a race day
  birthday      someone's birthday
  logged        you filled the day in (mood or notes) — shown brighter, not as a dot

With plan=True (Plan → Calendar) also what's due: open 'task' / 'note' on its
date and active goals' 'deadline'. Items carry an id so the UI can open them.
"""

from __future__ import annotations

import calendar
import sqlite3
from datetime import date, timedelta

from domains.plans.agenda import birthday_on, parse_birthday
from domains.plans.metrics import _has_column, _has_table


def month_marks(conn: sqlite3.Connection, year: int, month: int, plan: bool = False) -> dict[str, list[dict]]:
    """date → [{kind, label}] for every marked day in the month."""
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    m0, m1 = first.isoformat(), last.isoformat()
    marks: dict[str, list[dict]] = {}

    def add(d: str, kind: str, label: str | None = None, item_id=None, time: str | None = None, **extra) -> None:
        if m0 <= d <= m1:
            marks.setdefault(d, []).append({"kind": kind, "label": label, "id": item_id, "time": time, **extra})

    def span(start: str, end: str, kind: str, label: str | None, item_id=None) -> None:
        d, e = max(date.fromisoformat(start), first), min(date.fromisoformat(end), last)
        while d <= e:
            add(d.isoformat(), kind, label, item_id)
            d += timedelta(days=1)

    if _has_table(conn, "trips"):
        ret = "COALESCE(return_date, end_date)" if _has_column(conn, "trips", "return_date") else "end_date"
        for s, e, name in conn.execute(f"""
                SELECT start_date, {ret}, COALESCE(user_name, auto_name) FROM trips
                WHERE hidden = 0 AND start_date <= ? AND {ret} >= ?""", (m1, m0)):
            span(s, e, "trip", name)
    if _has_table(conn, "planned_trips"):
        for pid, s, e, name in conn.execute("""
                SELECT id, start_date, end_date, name FROM planned_trips
                WHERE adopted_start IS NULL AND start_date <= ? AND end_date >= ?""", (m1, m0)):
            span(s, e, "trip_planned", name, pid)
    if _has_table(conn, "life_events"):
        for d, label in conn.execute("SELECT event_date, label FROM life_events WHERE event_date BETWEEN ? AND ?", (m0, m1)):
            add(d, "event", label)
    if _has_table(conn, "goals"):
        for d, title in conn.execute("SELECT completed_at, title FROM goals WHERE status='done' AND completed_at BETWEEN ? AND ?",
                                     (m0, m1)):
            add(d, "achievement", title)
    if _has_table(conn, "race_goals"):
        for d, name in conn.execute("SELECT race_date, name FROM race_goals WHERE race_date BETWEEN ? AND ?", (m0, m1)):
            add(d, "achievement", name)
    if _has_column(conn, "contacts", "birthday"):
        for name, raw in conn.execute("SELECT name, birthday FROM contacts WHERE birthday IS NOT NULL"):
            p = parse_birthday(raw)
            if p and p[1] == month:
                add(birthday_on(year, month, p[2]).isoformat(), "birthday", name)
    if _has_table(conn, "user_profile"):                 # your own birthday, from the Life-in-weeks profile
        r = conn.execute("SELECT birthdate FROM user_profile WHERE id = 1").fetchone()
        if r and r[0] and r[0][5:7] == f"{month:02d}":
            born = date.fromisoformat(r[0])
            add(birthday_on(year, month, born.day).isoformat(), "birthday", "You", None, None,
                self=True, age=year - born.year)
    if _has_table(conn, "days"):
        for (d,) in conn.execute("""
                SELECT date FROM days WHERE date BETWEEN ? AND ?
                AND (mood IS NOT NULL OR (notes IS NOT NULL AND notes != ''))""", (m0, m1)):
            add(d, "logged")
    if plan and _has_table(conn, "tasks"):
        time_col = "due_time" if _has_column(conn, "tasks", "due_time") else "NULL"
        for tid, d, title, kind, t in conn.execute(f"""
                SELECT id, due_date, title, kind, {time_col} FROM tasks
                WHERE done_at IS NULL AND due_date BETWEEN ? AND ?
                ORDER BY {time_col} IS NOT NULL, {time_col}""", (m0, m1)):
            add(d, "note" if kind == "note" else "task", title, tid, t)
    # Duty first: it's how the days are really planned — and the training placed around it
    if plan and _has_table(conn, "roster"):
        for d, duty, rep_t, end_t, code in conn.execute("""
                SELECT date, duty_type, report_time, end_time, raw_code FROM roster
                WHERE date BETWEEN ? AND ? ORDER BY date""", (m0, m1)):
            span_t = f"{rep_t}–{end_t}" if rep_t and end_t and duty != "day_off" else rep_t if duty != "day_off" else None
            add(d, "duty", duty, None, span_t, code=code)
    if plan and _has_table(conn, "plan_sessions"):
        for sid, d, stype, disc, mins, eff, zone, status, opt, act in conn.execute("""
                SELECT p.id, p.session_date, p.session_type, p.discipline, p.duration_min, p.effective_duration_min,
                       p.intensity_zone, p.status, p.is_optional, p.completed_activity_id
                FROM plan_sessions p JOIN race_goals g ON g.id = p.goal_id
                WHERE g.status = 'active' AND p.status != 'displaced' AND p.session_date BETWEEN ? AND ?
                ORDER BY p.session_date, p.is_optional, p.id""", (m0, m1)):
            add(d, "training", stype, sid, None, discipline=disc, minutes=eff or mins, zone=zone,
                status=status, optional=bool(opt), activity_id=act)
    if plan and _has_table(conn, "goals"):
        for gid, d, title in conn.execute("""
                SELECT id, deadline, title FROM goals WHERE status = 'active' AND deadline BETWEEN ? AND ?""", (m0, m1)):
            add(d, "deadline", title, gid)
    return marks
