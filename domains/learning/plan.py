"""
Where a learning plan stands on a given day: the week, its phase, what's due this
week (and what slipped from earlier weeks), and the hours put in.

The roadmap's two-week rule: an item still open two weeks past its slot is `stale`
— drop it, park it or move it, but don't let it nag forever.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

KINDS = ("course", "learn", "skill", "build", "buy", "decide")
TIERS = ("core", "pick", "later")
ITEM_STATUSES = ("todo", "done", "skipped")
PLAN_STATUSES = ("active", "paused", "done")
STALE_AFTER = 2                    # weeks past the slot


def week_of(start: str, d: date) -> int:
    """1-based plan week of `d` (≤ 0 before the plan starts)."""
    return (d - date.fromisoformat(start)).days // 7 + 1


def week_bounds(start: str, week: int) -> tuple[date, date]:
    mon = date.fromisoformat(start) + timedelta(weeks=week - 1)
    return mon, mon + timedelta(days=6)


def item_state(item: dict, week: int) -> str:
    """done | skipped | anytime | upcoming | now | late | stale."""
    if item["status"] in ("done", "skipped"):
        return item["status"]
    if item["week"] is None:
        return "anytime"
    last = item["week"] + (item["weeks"] or 1) - 1
    if week < item["week"]:
        return "upcoming"
    if week <= last:
        return "now"
    return "stale" if week - last >= STALE_AFTER else "late"


def phase_for(phases: list[dict], week: int) -> dict | None:
    for ph in phases:
        if ph["week_from"] is not None and ph["week_from"] <= week <= (ph["week_to"] or ph["week_from"]):
            return ph
    if phases and week < (phases[0]["week_from"] or 1):
        return phases[0]
    return None


def _rows(conn: sqlite3.Connection, sql: str, args=()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args)]


def _minutes(conn, plan_id: int, start: date, end: date) -> int:
    r = conn.execute("SELECT COALESCE(SUM(minutes), 0) FROM learning_logs WHERE plan_id=? AND date BETWEEN ? AND ?",
                     (plan_id, start.isoformat(), end.isoformat())).fetchone()
    return int(r[0])


def _with_state(items: list[dict], week: int) -> list[dict]:
    for it in items:
        it["state"] = item_state(it, week)
        it["last_week"] = None if it["week"] is None else it["week"] + (it["weeks"] or 1) - 1
    return items


_ORDER = {"stale": 0, "late": 1, "now": 2}


def day(conn: sqlite3.Connection, d: date) -> list[dict]:
    """Every active plan as the Today lane shows it; on any day, what was done / logged then."""
    out = []
    for p in _rows(conn, "SELECT * FROM learning_plans WHERE status='active' ORDER BY id"):
        wk = week_of(p["start_date"], d)
        phases = _rows(conn, "SELECT * FROM learning_phases WHERE plan_id=? ORDER BY ord", (p["id"],))
        items = _with_state(_rows(conn, "SELECT * FROM learning_items WHERE plan_id=? ORDER BY week, ord",
                                  (p["id"],)), wk)
        due = sorted([i for i in items if i["state"] in _ORDER and i["tier"] != "later"],
                     key=lambda i: (_ORDER[i["state"]], i["tier"] != "core", i["week"], i["ord"]))
        mon, sun = week_bounds(p["start_date"], max(wk, 1))
        logs = _rows(conn, "SELECT l.*, i.title AS item_title FROM learning_logs l "
                           "LEFT JOIN learning_items i ON i.id = l.item_id "
                           "WHERE l.plan_id=? AND l.date=? ORDER BY l.id", (p["id"], d.isoformat()))
        ph = phase_for(phases, wk)
        out.append({
            "plan": p,
            "week": wk,
            "week_start": mon.isoformat(),
            "phase": ph,
            "due": due,
            "week_total": sum(1 for i in items if i["week"] is not None and i["tier"] != "later"
                              and i["week"] <= wk <= i["last_week"]),
            "week_done": sum(1 for i in items if i["week"] is not None and i["tier"] != "later"
                             and i["week"] <= wk <= i["last_week"] and i["status"] != "todo"),
            "done_today": [i for i in items if i["status"] == "done" and i["done_at"] == d.isoformat()],
            "logs": logs,
            "minutes_today": sum(l["minutes"] for l in logs),
            "minutes_week": _minutes(conn, p["id"], mon, min(sun, d)) if wk >= 1 else 0,
        })
    return out


def detail(conn: sqlite3.Connection, plan_id: int, today: date) -> dict | None:
    p = conn.execute("SELECT * FROM learning_plans WHERE id=?", (plan_id,)).fetchone()
    if not p:
        return None
    p = dict(p)
    wk = week_of(p["start_date"], today)
    phases = _rows(conn, "SELECT * FROM learning_phases WHERE plan_id=? ORDER BY ord", (plan_id,))
    items = _with_state(_rows(conn, "SELECT * FROM learning_items WHERE plan_id=? "
                                    "ORDER BY COALESCE(week, 999), ord", (plan_id,)), wk)
    by_phase: dict[int | None, list[dict]] = {}
    for it in items:
        by_phase.setdefault(it["phase_id"], []).append(it)
    current = phase_for(phases, wk)
    for ph in phases:
        ph["items"] = by_phase.get(ph["id"], [])
        ph["current"] = current is not None and ph["id"] == current["id"]

    # Hours per plan week, from week 1 to now (at least the last 8 slots for the chart).
    weeks = []
    for w in range(max(1, wk - 7), max(wk, 1) + 1):
        mon, sun = week_bounds(p["start_date"], w)
        weeks.append({"week": w, "start": mon.isoformat(), "minutes": _minutes(conn, plan_id, mon, sun)})
    total = conn.execute("SELECT COALESCE(SUM(minutes), 0) FROM learning_logs WHERE plan_id=?",
                         (plan_id,)).fetchone()[0]
    core = [i for i in items if i["tier"] == "core"]
    return {
        "plan": p,
        "week": wk,
        "phases": phases,
        "hours_by_week": weeks,
        "minutes_total": int(total),
        "core_done": sum(1 for i in core if i["status"] == "done"),
        "core_total": len(core),
        "gates_passed": sum(1 for ph in phases if ph["gate_passed_at"]),
        "behind": sum(1 for i in items if i["state"] in ("late", "stale") and i["tier"] != "later"),
    }
