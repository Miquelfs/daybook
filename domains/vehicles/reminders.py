"""
Vehicle reminders (ITV, insurance, oil change, tyres…) that live in Plan.

A reminder is due every N months and/or every N km from the last time it was done, or on a fixed
date (an insurance renewal). Whichever comes first wins; a km interval becomes a date from your
pace (odometer km/day over the last few months), so it surfaces in Plan like any dated task.

Each reminder keeps one open task in daybook.db → tasks (area 'vehicles', title "Scooter · Oil
change", surfacing `remind_days` before). sync() keeps that task's date and notes current, and when
the task is ticked off in Plan, starts the next cycle from that day (km = the odometer then). The
same happens from the vehicle page (done(), which can log the cost too).

    python -m domains.vehicles.reminders          (nightly: vehicle_reminders)
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from domains.vehicles import garage

AREA = "vehicles"
PACE_DAYS = 180

PRESETS = {                       # what the form offers; every value is editable
    "scooter": [("ITV", 24, None), ("Insurance", 12, None), ("Oil change", 12, 3000), ("Belt & rollers", None, 15000),
                ("Tyres", None, 12000), ("Battery", 36, None)],
    "car": [("ITV", 24, None), ("Insurance", 12, None), ("Oil & filter", 12, 15000), ("Tyres", None, 40000),
            ("Brake pads", None, 30000), ("Timing belt", 60, 100000)],
}


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    return date(y, m, 28)


def pace(rs: list[tuple[str, float]]) -> float | None:
    """km a day, from the readings of the last ~6 months (else all of them)."""
    if len(rs) < 2:
        return None
    last_d, last_k = date.fromisoformat(rs[-1][0]), rs[-1][1]
    older = [(d, k) for d, k in rs[:-1] if (last_d - date.fromisoformat(d)).days >= 14]
    if not older:
        return None
    recent = [x for x in older if (last_d - date.fromisoformat(x[0])).days <= PACE_DAYS] or older[-1:]
    d0, k0 = recent[0]
    days = (last_d - date.fromisoformat(d0)).days
    return (last_k - k0) / days if days > 0 and last_k > k0 else None


def odometer_now(rs: list[tuple[str, float]], kmpd: float | None, today: date) -> float | None:
    if not rs:
        return None
    d, k = rs[-1]
    return k + (kmpd or 0) * max(0, (today - date.fromisoformat(d)).days)


def odometer_on(rs: list[tuple[str, float]], day: str) -> float | None:
    """The dial on a day: the last reading before it, moved on at your pace."""
    before = [(d, k) for d, k in rs if d <= day]
    if not before:
        return None
    d, k = before[-1]
    kmpd = pace(before) or 0
    return round(k + kmpd * (date.fromisoformat(day) - date.fromisoformat(d)).days)


def next_due(r, rs: list[tuple[str, float]], today: date | None = None) -> dict:
    """{'date', 'km', 'by', 'km_left', 'days_left', 'odometer'} — date is when it's due (projected for km)."""
    today = today or date.today()
    kmpd = pace(rs)
    odo = odometer_now(rs, kmpd, today)
    by_date = None
    if r["due_date"]:
        by_date = date.fromisoformat(r["due_date"])
    elif r["every_months"] and r["last_date"]:
        by_date = _add_months(date.fromisoformat(r["last_date"]), int(r["every_months"]))
    due_km = km_date = km_left = None
    if r["every_km"] and r["last_km"] is not None:
        due_km = float(r["last_km"]) + float(r["every_km"])
        if odo is not None:
            km_left = due_km - odo
            if kmpd:
                km_date = today + timedelta(days=max(0, round(km_left / kmpd)))
            elif km_left <= 0:
                km_date = today
    options = [(d, w) for d, w in ((by_date, "date"), (km_date, "km")) if d]
    when, by = min(options) if options else (None, "km" if due_km else None)
    return {
        "date": when.isoformat() if when else None,
        "by": by,
        "km": round(due_km) if due_km is not None else None,
        "km_left": round(km_left) if km_left is not None else None,
        "days_left": (when - today).days if when else None,
        "odometer": round(odo) if odo is not None else None,
        "pace_km_day": round(kmpd, 1) if kmpd else None,
    }


def _notes(r, due: dict) -> str:
    bits = []
    if r["every_km"] and r["every_months"]:
        bits.append(f"Every {r['every_km']:,.0f} km or {r['every_months']} months")
    elif r["every_km"]:
        bits.append(f"Every {r['every_km']:,.0f} km")
    elif r["every_months"]:
        bits.append(f"Every {r['every_months']} months")
    if r["last_date"]:
        bits.append(f"last done {r['last_date']}" + (f" at {r['last_km']:,.0f} km" if r["last_km"] is not None else ""))
    if due["km"] is not None:
        bits.append(f"due at {due['km']:,} km" + (f" ({due['km_left']:,} to go)" if due["km_left"] is not None and due["km_left"] > 0 else ""))
    if due["by"] == "km" and due["date"]:
        bits.append("date projected from your pace")
    return " · ".join(bits) + ". Tick it off here or on the vehicle's page (Explore → Vehicles)."


def _readings(conn, v) -> list[tuple[str, float]]:
    return garage.readings(conn, v)


def _start_next_cycle(conn: sqlite3.Connection, r, rs, on: str, km: float | None) -> None:
    conn.execute("UPDATE vehicle_reminders SET last_date=?, last_km=?, due_date=NULL, task_id=NULL WHERE id=?",
                 (on, km if km is not None else odometer_on(rs, on), r["id"]))


def sync(conn: sqlite3.Connection, day_conn: sqlite3.Connection, today: date | None = None) -> int:
    """Bring every reminder's Plan task up to date. Returns tasks created/changed."""
    today = today or date.today()
    changed = 0
    vehicles = {v["id"]: v for v in conn.execute("SELECT * FROM vehicles")}
    for r in conn.execute("SELECT * FROM vehicle_reminders").fetchall():
        v = vehicles.get(r["vehicle_id"])
        rs = _readings(conn, v) if v else []
        task = day_conn.execute("SELECT * FROM tasks WHERE id=?", (r["task_id"],)).fetchone() if r["task_id"] else None
        if task and task["done_at"]:                               # ticked off in Plan → next cycle
            _start_next_cycle(conn, r, rs, task["done_at"], None)
            r = conn.execute("SELECT * FROM vehicle_reminders WHERE id=?", (r["id"],)).fetchone()
            task = None
        if not v or v["sold_on"]:
            if task:
                day_conn.execute("DELETE FROM tasks WHERE id=?", (task["id"],))
                conn.execute("UPDATE vehicle_reminders SET task_id=NULL WHERE id=?", (r["id"],))
                changed += 1
            continue
        due = next_due(r, rs, today)
        title = f"{v['name']} · {r['title']}"
        notes = _notes(r, due)
        fields = (title, notes, due["date"], r["remind_days"])
        if task is None:
            cur = day_conn.execute(
                "INSERT INTO tasks (title, notes, kind, due_date, remind_days, area) VALUES (?,?,'task',?,?,?)",
                (title, notes, due["date"], r["remind_days"], AREA))
            conn.execute("UPDATE vehicle_reminders SET task_id=? WHERE id=?", (cur.lastrowid, r["id"]))
            changed += 1
        elif (task["title"], task["notes"], task["due_date"], task["remind_days"]) != fields:
            day_conn.execute("UPDATE tasks SET title=?, notes=?, due_date=?, remind_days=? WHERE id=?", (*fields, task["id"]))
            changed += 1
    conn.commit()
    day_conn.commit()
    return changed


def done(conn: sqlite3.Connection, day_conn: sqlite3.Connection, rid: int, on: str, km: float | None) -> None:
    """Done today (or on `on`) at `km`: close the Plan task, start the next cycle."""
    r = conn.execute("SELECT * FROM vehicle_reminders WHERE id=?", (rid,)).fetchone()
    if not r:
        return
    v = conn.execute("SELECT * FROM vehicles WHERE id=?", (r["vehicle_id"],)).fetchone()
    if r["task_id"]:
        day_conn.execute("UPDATE tasks SET done_at=? WHERE id=? AND done_at IS NULL", (on, r["task_id"]))
    _start_next_cycle(conn, r, _readings(conn, v) if v else [], on, km)
    conn.commit()
    sync(conn, day_conn)


def remove(conn: sqlite3.Connection, day_conn: sqlite3.Connection, rid: int) -> None:
    r = conn.execute("SELECT task_id FROM vehicle_reminders WHERE id=?", (rid,)).fetchone()
    if r and r["task_id"]:
        day_conn.execute("DELETE FROM tasks WHERE id=? AND done_at IS NULL", (r["task_id"],))
        day_conn.commit()
    conn.execute("DELETE FROM vehicle_reminders WHERE id=?", (rid,))
    conn.commit()


def listing(conn: sqlite3.Connection, vehicle_id: int, today: date | None = None) -> list[dict]:
    v = conn.execute("SELECT * FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
    rs = _readings(conn, v) if v else []
    out = []
    for r in conn.execute("SELECT * FROM vehicle_reminders WHERE vehicle_id=? ORDER BY id", (vehicle_id,)):
        out.append(dict(r) | {"due": next_due(r, rs, today)})
    out.sort(key=lambda x: (x["due"]["date"] is None, x["due"]["date"] or ""))
    return out


def main() -> None:
    from infrastructure.db.connection import get_connection
    from infrastructure.db.money_connection import get_money_connection
    conn, day_conn = get_money_connection(), get_connection()
    try:
        n = sync(conn, day_conn)
    finally:
        conn.close()
        day_conn.close()
    print(f"vehicle_reminders: {n} Plan task(s) created or updated")


if __name__ == "__main__":
    main()
