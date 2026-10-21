"""
iCalendar feed of what's ahead — subscribe once in iOS/macOS Calendar
(webcal://<pi>:8000/calendar.ics) and the phone shows tasks, notes, cutoffs,
birthdays and goal deadlines with native alerts, even offline.

All-day events; each carries an alert at 09:00 that day, and a cutoff
(`remind_days`) gets a second alert that many days earlier.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

from domains.plans.agenda import parse_birthday

_RRULE = {"weekly": "FREQ=WEEKLY", "monthly": "FREQ=MONTHLY", "yearly": "FREQ=YEARLY"}


def _esc(s: str) -> str:
    return (s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
             .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> str:
    """RFC 5545: lines over 75 octets continue on the next line after a space."""
    out, cur = [], b""
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > (75 if not out else 74):
            out.append(cur.decode())
            cur = b""
        cur += b
    out.append(cur.decode())
    return "\r\n ".join(out)


def _alarm(trigger: str, text: str) -> list[str]:
    return ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(text)}",
            f"TRIGGER;RELATED=START:{trigger}", "END:VALARM"]


def _event(uid: str, day: date, summary: str, stamp: str, *, rrule: str | None = None,
           description: str | None = None, early_days: int | None = None) -> list[str]:
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}@daybook",
        f"DTSTAMP:{stamp}",
        f"DTSTART;VALUE=DATE:{day:%Y%m%d}",
        f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}",
        f"SUMMARY:{_esc(summary)}",
        "TRANSP:TRANSPARENT",
    ]
    if rrule:
        lines.append(f"RRULE:{rrule}")
    if description:
        lines.append(f"DESCRIPTION:{_esc(description)}")
    lines += _alarm("PT9H", summary)
    if early_days:
        # 09:00, `early_days` days before the (midnight) start.
        lines += _alarm(f"-P{early_days - 1}DT15H", f"{summary} — in {early_days} days")
    lines.append("END:VEVENT")
    return lines


def build(conn: sqlite3.Connection, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Daybook//Plan ahead//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Daybook", "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ]

    for t in conn.execute(
        "SELECT * FROM tasks WHERE done_at IS NULL AND due_date IS NOT NULL"
    ).fetchall():
        icon = "📝" if t["kind"] == "note" else "☐"
        lines += _event(
            f"task-{t['id']}", date.fromisoformat(t["due_date"]), f"{icon} {t['title']}", stamp,
            rrule=_RRULE.get(t["repeat"] or ""), description=t["notes"],
            early_days=t["remind_days"] if t["remind_days"] else None,
        )

    cols = {r[1] for r in conn.execute("PRAGMA table_info(contacts)")}
    if "birthday" in cols:
        for c in conn.execute("SELECT id, name, emoji, birthday FROM contacts WHERE birthday IS NOT NULL"):
            p = parse_birthday(c["birthday"])
            if p is None:
                continue
            y, m, d = p
            # Year unknown → anchor in a leap year so 29 Feb stays valid.
            start = date(y or 2000, m, d)
            rrule = "FREQ=YEARLY" + (";BYMONTH=2;BYMONTHDAY=-1" if (m, d) == (2, 29) else "")
            lines += _event(f"bday-{c['id']}", start, f"🎂 {c['name']}", stamp, rrule=rrule,
                            description=f"Born {y}" if y else None)

    for g in conn.execute(
        "SELECT id, title, emoji, deadline FROM goals WHERE status='active' AND deadline IS NOT NULL"
    ).fetchall():
        lines += _event(f"goal-{g['id']}", date.fromisoformat(g["deadline"]),
                        f"🎯 {(g['emoji'] + ' ') if g['emoji'] else ''}{g['title']} — deadline", stamp,
                        early_days=14)

    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"
