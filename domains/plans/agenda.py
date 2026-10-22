"""
What's ahead: tasks by when they matter, notes resurfacing, birthdays.

Shared by GET /agenda (the Today strip) and the Plan page.
"""

from __future__ import annotations

import calendar
import sqlite3
from datetime import date, timedelta

REPEATS = ("weekly", "monthly", "yearly")
KINDS = ("task", "note")


# ── Dates ────────────────────────────────────────────────────────────────────

def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def next_occurrence(due: date, repeat: str) -> date:
    if repeat == "weekly":
        return due + timedelta(days=7)
    if repeat == "monthly":
        return add_months(due, 1)
    if repeat == "yearly":
        return add_months(due, 12)
    raise ValueError(f"unknown repeat {repeat!r}")


def parse_birthday(s: str | None) -> tuple[int | None, int, int] | None:
    """'YYYY-MM-DD' or '--MM-DD' → (year|None, month, day); None if unparseable."""
    if not s:
        return None
    try:
        if s.startswith("--"):
            m, d = int(s[2:4]), int(s[5:7])
            date(2000, m, d)                     # validates (2000 is leap → 29 Feb ok)
            return None, m, d
        b = date.fromisoformat(s)
        return b.year, b.month, b.day
    except (ValueError, IndexError):
        return None


def normalize_birthday(s: str | None) -> str | None:
    """Typed as 'DD-MM-YYYY' or 'DD-MM' ('/' or '.' work too); stored 'YYYY-MM-DD' / '--MM-DD'.
    The stored forms themselves are accepted unchanged."""
    if not s or not s.strip():
        return None
    s = s.strip().replace("/", "-").replace(".", "-")
    parts = s.split("-")
    if not s.startswith("--") and len(parts) == 3 and len(parts[0]) <= 2:      # DD-MM-YYYY
        s = f"{parts[2]:0>4}-{parts[1]:0>2}-{parts[0]:0>2}"
    elif len(parts) == 2:                                                      # DD-MM
        s = f"--{parts[1]:0>2}-{parts[0]:0>2}"
    p = parse_birthday(s)
    if p is None:
        raise ValueError("birthday must be DD-MM-YYYY, or DD-MM if you don't know the year")
    y, m, d = p
    return f"{y:04d}-{m:02d}-{d:02d}" if y else f"--{m:02d}-{d:02d}"


def birthday_on(year: int, month: int, day: int) -> date:
    if month == 2 and day == 29 and not calendar.isleap(year):
        return date(year, 2, 28)
    return date(year, month, day)


def next_birthday(s: str, today: date) -> date | None:
    p = parse_birthday(s)
    if p is None:
        return None
    _, m, d = p
    nxt = birthday_on(today.year, m, d)
    return nxt if nxt >= today else birthday_on(today.year + 1, m, d)


# ── Birthdays ────────────────────────────────────────────────────────────────

def birthdays(conn: sqlite3.Connection, today: date, within_days: int | None = None) -> list[dict]:
    """Contacts with a birthday, soonest first — plus when you last saw them."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(contacts)")}
    if "birthday" not in cols:
        return []
    rows = conn.execute(
        "SELECT id, name, emoji, group_, birthday FROM contacts WHERE birthday IS NOT NULL"
    ).fetchall()
    year_start = date(today.year, 1, 1).isoformat()
    out = []
    for r in rows:
        nxt = next_birthday(r["birthday"], today)
        if nxt is None:
            continue
        days_until = (nxt - today).days
        if within_days is not None and days_until > within_days:
            continue
        born = parse_birthday(r["birthday"])[0]
        seen = conn.execute(
            """SELECT MAX(date) AS last, SUM(date >= ?) AS this_year
               FROM day_companions WHERE contact_id=? AND date <= ?""",
            (year_start, r["id"], today.isoformat()),
        ).fetchone()
        out.append({
            "contact_id": r["id"],
            "name": r["name"],
            "emoji": r["emoji"],
            "group_": r["group_"],
            "birthday": r["birthday"],
            "date": nxt.isoformat(),
            "days_until": days_until,
            "turning": nxt.year - born if born else None,
            "last_seen": seen["last"],
            "days_since_seen": (today - date.fromisoformat(seen["last"])).days if seen["last"] else None,
            "days_together_this_year": seen["this_year"] or 0,
        })
    out.sort(key=lambda b: (b["days_until"], b["name"]))
    return out


# ── Tasks ────────────────────────────────────────────────────────────────────

def surfaces_on(task: dict) -> date | None:
    """First day a dated task shows in 'coming up' — earlier for cutoffs."""
    if not task.get("due_date"):
        return None
    due = date.fromisoformat(task["due_date"])
    return due - timedelta(days=task.get("remind_days") or 0)


def agenda(conn: sqlite3.Connection, today: date, horizon_days: int = 7) -> dict:
    """Open tasks bucketed for Today, notes due to resurface, upcoming birthdays."""
    t = today.isoformat()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM tasks WHERE done_at IS NULL ORDER BY due_date, due_time IS NOT NULL, due_time, id"
    ).fetchall()]
    horizon = today + timedelta(days=horizon_days)

    overdue, due_today, upcoming, notes = [], [], [], []
    inbox = 0
    for r in rows:
        due = r["due_date"]
        if r["kind"] == "note":
            if due and due <= t:
                notes.append(r)
            continue
        if not due:
            inbox += 1
        elif due < t:
            overdue.append(r)
        elif due == t:
            due_today.append(r)
        elif date.fromisoformat(due) <= horizon or surfaces_on(r) <= today:
            upcoming.append({**r, "days_until": (date.fromisoformat(due) - today).days})

    return {
        "date": t,
        "overdue": overdue,
        "today": due_today,
        "upcoming": upcoming,
        "notes": notes,
        "inbox_count": inbox,
        "birthdays": birthdays(conn, today, within_days=max(horizon_days, 14)),
    }


def complete(conn: sqlite3.Connection, task_id: int, on: date) -> dict | None:
    """Mark a task done on `on`. A repeating task leaves a done copy behind and
    moves itself to its next occurrence after `on`. Returns the live row."""
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        return None
    task = dict(row)
    if task["repeat"] in REPEATS and task["due_date"]:
        conn.execute(
            """INSERT INTO tasks (title, notes, kind, due_date, due_time, area, goal_id, planned_trip_id, done_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (task["title"], task["notes"], task["kind"], task["due_date"], task.get("due_time"),
             task["area"], task["goal_id"], task.get("planned_trip_id"), on.isoformat()),
        )
        nxt = next_occurrence(date.fromisoformat(task["due_date"]), task["repeat"])
        while nxt <= on:
            nxt = next_occurrence(nxt, task["repeat"])
        conn.execute("UPDATE tasks SET due_date=? WHERE id=?", (nxt.isoformat(), task_id))
    else:
        conn.execute("UPDATE tasks SET done_at=? WHERE id=?", (on.isoformat(), task_id))
    conn.commit()
    return dict(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())
