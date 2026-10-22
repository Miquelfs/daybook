"""
Planned trips — the shape of a trip worth remembering, not a travel agency:
name, dates, destination, who; per day the plan, where you sleep, its price and
whether it's booked (planned_trip_days); packing by section, open decisions,
risks and info notes (planned_trip_items); budget lines low / mid / high /
actual in the local currency (planned_trip_budget); a checklist (tasks with
planned_trip_id). Passenger flights logged inside the window show up on their own. Once you're back and trip detection finds the
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
    saved = {r["date"]: dict(r) for r in conn.execute(
        "SELECT * FROM planned_trip_days WHERE planned_id=?", (planned_id,))}
    days = []
    d = start
    while d <= end:
        r = saved.get(d.isoformat(), {})
        days.append({
            "date": d.isoformat(), "note": r.get("note") or None, "kind": r.get("kind"),
            "sleep": r.get("sleep"), "sleep_cost": r.get("sleep_cost"),
            "booked": bool(r.get("booked")), "booking_ref": r.get("booking_ref"),
        })
        d += timedelta(days=1)
    items = [dict(r) for r in conn.execute(
        "SELECT * FROM planned_trip_items WHERE planned_id=? ORDER BY kind, sort, id", (planned_id,))]
    for it in items:
        it["done"] = bool(it["done"])
    lines = [dict(r) for r in conn.execute(
        "SELECT * FROM planned_trip_budget WHERE planned_id=? ORDER BY sort, id", (planned_id,))]
    totals = {k: sum((ln[k] or 0) for ln in lines) for k in ("low", "mid", "high", "actual")}
    fx = base.get("fx_rate")
    totals_eur = {k: round(v / fx, 2) if fx else None for k, v in totals.items()}
    checklist = [dict(r) for r in conn.execute(
        "SELECT * FROM tasks WHERE planned_trip_id=? ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date, id",
        (planned_id,))]
    flights = []
    if _has_table(conn, "passenger_flights"):
        flights = [dict(r) for r in conn.execute("""
            SELECT id, date, origin, destination, flight_number, airline, dep_time, arr_time
            FROM passenger_flights WHERE date BETWEEN ? AND ? ORDER BY date, dep_time""",
            ((start - timedelta(days=1)).isoformat(), (end + timedelta(days=1)).isoformat()))]
    return {
        **base, "days": days, "checklist": checklist, "flights": flights,
        "items": items,
        "budget_lines": lines,
        "budget_totals": totals,
        "budget_totals_eur": totals_eur,
        "sleep_total": sum(x["sleep_cost"] or 0 for x in days),
        # A night needs booking when you sleep somewhere — not in the air on a travel day.
        "nights_booked": sum(1 for x in days if x["sleep"] and x["kind"] != "travel" and x["booked"]),
        "nights_to_book": sum(1 for x in days if x["sleep"] and x["kind"] != "travel" and not x["booked"]),
    }


DAY_FIELDS = ("note", "kind", "sleep", "sleep_cost", "booked", "booking_ref")


def set_day(conn: sqlite3.Connection, planned_id: int, day: str, fields: dict) -> None:
    """Merge `fields` into the day (only the keys given). A day left with nothing is removed."""
    row = conn.execute("SELECT * FROM planned_trip_days WHERE planned_id=? AND date=?",
                       (planned_id, day)).fetchone()
    cur = {k: (row[k] if row else None) for k in DAY_FIELDS}
    for k, v in fields.items():
        if k in DAY_FIELDS:
            cur[k] = v.strip() if isinstance(v, str) else v
    cur["note"] = cur["note"] or ""
    cur["booked"] = 1 if cur["booked"] else 0
    if not (cur["note"] or cur["kind"] or cur["sleep"] or cur["sleep_cost"] or cur["booked"] or cur["booking_ref"]):
        conn.execute("DELETE FROM planned_trip_days WHERE planned_id=? AND date=?", (planned_id, day))
    else:
        conn.execute(f"""INSERT INTO planned_trip_days (planned_id, date, {", ".join(DAY_FIELDS)})
                         VALUES (?, ?, {", ".join("?" * len(DAY_FIELDS))})
                         ON CONFLICT(planned_id, date) DO UPDATE SET
                         {", ".join(f"{k}=excluded.{k}" for k in DAY_FIELDS)}""",
                     (planned_id, day, *[cur[k] for k in DAY_FIELDS]))
    conn.commit()


ITEM_KINDS = ("pack", "decision", "risk", "info")


def add_item(conn: sqlite3.Connection, planned_id: int, kind: str, title: str,
             section: str | None = None, detail: str | None = None) -> int:
    sort = conn.execute("SELECT COALESCE(MAX(sort), 0) + 1 FROM planned_trip_items WHERE planned_id=?",
                        (planned_id,)).fetchone()[0]
    cur = conn.execute("""INSERT INTO planned_trip_items (planned_id, kind, section, title, detail, sort)
                          VALUES (?,?,?,?,?,?)""", (planned_id, kind, section, title, detail, sort))
    conn.commit()
    return cur.lastrowid


def update_item(conn: sqlite3.Connection, item_id: int, fields: dict) -> bool:
    allowed = {k: (int(v) if k == "done" else v) for k, v in fields.items()
               if k in ("section", "title", "detail", "done")}
    if not conn.execute("SELECT 1 FROM planned_trip_items WHERE id=?", (item_id,)).fetchone():
        return False
    if allowed:
        conn.execute(f"UPDATE planned_trip_items SET {', '.join(f'{k}=?' for k in allowed)} WHERE id=?",
                     [*allowed.values(), item_id])
        conn.commit()
    return True


def delete_item(conn: sqlite3.Connection, item_id: int) -> None:
    conn.execute("DELETE FROM planned_trip_items WHERE id=?", (item_id,))
    conn.commit()


def add_budget_line(conn: sqlite3.Connection, planned_id: int, fields: dict) -> int:
    sort = conn.execute("SELECT COALESCE(MAX(sort), 0) + 1 FROM planned_trip_budget WHERE planned_id=?",
                        (planned_id,)).fetchone()[0]
    cur = conn.execute("""INSERT INTO planned_trip_budget (planned_id, line, low, mid, high, actual, sort)
                          VALUES (?,?,?,?,?,?,?)""",
                       (planned_id, fields["line"], fields.get("low"), fields.get("mid"),
                        fields.get("high"), fields.get("actual"), sort))
    conn.commit()
    return cur.lastrowid


def update_budget_line(conn: sqlite3.Connection, line_id: int, fields: dict) -> bool:
    allowed = {k: v for k, v in fields.items() if k in ("line", "low", "mid", "high", "actual")}
    if not conn.execute("SELECT 1 FROM planned_trip_budget WHERE id=?", (line_id,)).fetchone():
        return False
    if allowed:
        conn.execute(f"UPDATE planned_trip_budget SET {', '.join(f'{k}=?' for k in allowed)} WHERE id=?",
                     [*allowed.values(), line_id])
        conn.commit()
    return True


def delete_budget_line(conn: sqlite3.Connection, line_id: int) -> None:
    conn.execute("DELETE FROM planned_trip_budget WHERE id=?", (line_id,))
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
    cols = ("name", "destination", "start_date", "end_date", "notes", "budget", "currency", "fx_rate", "flights_eur")
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
