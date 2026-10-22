"""
Planned trips — light on purpose (the daybook isn't a travel planner): name,
dates, destination, who's coming, a budget, one line per day (planned_trip_days)
and a checklist (tasks with planned_trip_id). Passenger flights logged inside
the window show up on their own. Once you're back and trip detection finds the
real trip (overlapping dates), adopt() hands it the name and the companions,
and that trip's page shows the plan next to what actually happened.

Nightly (daily_sync.sh, after trip_detection): python -m domains.plans.planned_trips
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date, timedelta

from domains.plans.metrics import _has_table


def _with(conn: sqlite3.Connection, planned_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute("""
        SELECT c.id, c.name, c.emoji, c.group_ FROM contacts c
        JOIN planned_trip_companions p ON p.contact_id = c.id
        WHERE p.planned_id = ? ORDER BY c.name""", (planned_id,))]


def _checklist_counts(conn: sqlite3.Connection, planned_id: int) -> tuple[int, int]:
    if not any(c[1] == "planned_trip_id" for c in conn.execute("PRAGMA table_info(tasks)")):
        return 0, 0
    r = conn.execute("SELECT COUNT(*), SUM(done_at IS NOT NULL) FROM tasks WHERE planned_trip_id=?",
                     (planned_id,)).fetchone()
    return r[0] or 0, r[1] or 0


def _row(conn: sqlite3.Connection, r: sqlite3.Row, today: date) -> dict:
    start, end = date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"])
    total, done = _checklist_counts(conn, r["id"])
    return {
        **dict(r),
        "nights": (end - start).days,
        "days_until": (start - today).days,
        "ongoing": start <= today <= end,
        "with": _with(conn, r["id"]),
        "checklist_total": total,
        "checklist_done": done,
    }


def detail(conn: sqlite3.Connection, planned_id: int, today: date) -> dict | None:
    """The trip's page: every day with its outline line, the checklist, flights in the window."""
    base = get(conn, planned_id, today)
    if base is None:
        return None
    start, end = date.fromisoformat(base["start_date"]), date.fromisoformat(base["end_date"])
    notes = {d: n for d, n in conn.execute(
        "SELECT date, note FROM planned_trip_days WHERE planned_id=?", (planned_id,))}
    days = []
    d = start
    while d <= end:
        days.append({"date": d.isoformat(), "note": notes.get(d.isoformat())})
        d += timedelta(days=1)
    checklist = [dict(r) for r in conn.execute(
        "SELECT * FROM tasks WHERE planned_trip_id=? ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date, id",
        (planned_id,))]
    flights = []
    if _has_table(conn, "passenger_flights"):
        flights = [dict(r) for r in conn.execute("""
            SELECT id, date, origin, destination, flight_number, airline, dep_time, arr_time
            FROM passenger_flights WHERE date BETWEEN ? AND ? ORDER BY date, dep_time""",
            ((start - timedelta(days=1)).isoformat(), (end + timedelta(days=1)).isoformat()))]
    return {**base, "days": days, "checklist": checklist, "flights": flights}


def set_day(conn: sqlite3.Connection, planned_id: int, day: str, note: str | None) -> None:
    if note and note.strip():
        conn.execute("""INSERT INTO planned_trip_days (planned_id, date, note) VALUES (?, ?, ?)
                        ON CONFLICT(planned_id, date) DO UPDATE SET note = excluded.note""",
                     (planned_id, day, note.strip()))
    else:
        conn.execute("DELETE FROM planned_trip_days WHERE planned_id=? AND date=?", (planned_id, day))
    conn.commit()


def for_trip(conn: sqlite3.Connection, start: str, end: str, today: date) -> dict | None:
    """The plan a detected trip came from, if any."""
    r = conn.execute("SELECT id FROM planned_trips WHERE adopted_start=? AND adopted_end=?", (start, end)).fetchone()
    return detail(conn, r[0], today) if r else None


def upcoming(conn: sqlite3.Connection, today: date) -> list[dict]:
    """Planned trips not over yet and not yet matched to a detected trip, soonest first."""
    rows = conn.execute("""
        SELECT * FROM planned_trips WHERE adopted_start IS NULL AND end_date >= ?
        ORDER BY start_date""", (today.isoformat(),)).fetchall()
    return [_row(conn, r, today) for r in rows]


def get(conn: sqlite3.Connection, planned_id: int, today: date) -> dict | None:
    r = conn.execute("SELECT * FROM planned_trips WHERE id=?", (planned_id,)).fetchone()
    return _row(conn, r, today) if r else None


def save(conn: sqlite3.Connection, fields: dict, contact_ids: list[int] | None, planned_id: int | None = None) -> int:
    cols = ("name", "destination", "start_date", "end_date", "notes", "budget")
    vals = {k: fields[k] for k in cols if k in fields}
    if planned_id is None:
        cur = conn.execute(f"INSERT INTO planned_trips ({', '.join(vals)}) VALUES ({', '.join('?' * len(vals))})",
                           list(vals.values()))
        planned_id = cur.lastrowid
    elif vals:
        conn.execute(f"UPDATE planned_trips SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?",
                     [*vals.values(), planned_id])
    if contact_ids is not None:
        conn.execute("DELETE FROM planned_trip_companions WHERE planned_id=?", (planned_id,))
        conn.executemany("INSERT OR IGNORE INTO planned_trip_companions VALUES (?, ?)",
                         [(planned_id, c) for c in dict.fromkeys(contact_ids)])
    conn.commit()
    return planned_id


def delete(conn: sqlite3.Connection, planned_id: int) -> None:
    conn.execute("DELETE FROM planned_trips WHERE id=?", (planned_id,))
    conn.commit()


def adopt(conn: sqlite3.Connection) -> int:
    """Hand each finished plan to the detected trip that overlaps it: its name
    (unless you already renamed the trip) and who came. Returns how many."""
    if not _has_table(conn, "trips"):
        return 0
    n = 0
    for p in conn.execute("SELECT * FROM planned_trips WHERE adopted_start IS NULL").fetchall():
        trip = conn.execute("""
            SELECT start_date, end_date, user_name FROM trips
            WHERE hidden = 0 AND start_date <= date(?, '+1 day') AND end_date >= date(?, '-1 day')
            ORDER BY ABS(julianday(start_date) - julianday(?)) LIMIT 1""",
            (p["end_date"], p["start_date"], p["start_date"])).fetchone()
        if trip is None:
            continue
        if not trip["user_name"]:
            conn.execute("UPDATE trips SET user_name=? WHERE start_date=? AND end_date=?",
                         (p["name"], trip["start_date"], trip["end_date"]))
        conn.execute("""INSERT OR IGNORE INTO trip_companions (start_date, end_date, contact_id)
                        SELECT ?, ?, contact_id FROM planned_trip_companions WHERE planned_id=?""",
                     (trip["start_date"], trip["end_date"], p["id"]))
        conn.execute("UPDATE planned_trips SET adopted_start=?, adopted_end=? WHERE id=?",
                     (trip["start_date"], trip["end_date"], p["id"]))
        n += 1
    conn.commit()
    return n


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    from infrastructure.db.migrate_plans import migrate
    c = get_connection()
    migrate(c)
    print(f"planned trips matched to detected trips: {adopt(c)}")
    c.close()
    sys.exit(0)
