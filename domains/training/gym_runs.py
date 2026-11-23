"""
One gym a week, the other an easy run — you'd rather run, and the run feeds the half marathon.

When it's on, for every week from today to the race:
  · a week with two (or more) gym sessions keeps one — the heavy, short one that protects the last
    hours of the 312 and the tendons the running loads — and the other becomes an easy run
    (35 min; 30 when the gym had been cut, e.g. in a recovery week). The gym set aside is the one
    on a day of its own; the run starts on its day and the re-plan places it like any run
    (never on a key or long-ride day).
  · no gym in the last 10 days before the main race, or the 7 before a B race: legs fresh.
Everything changed is recorded (gym_run_swaps.changes_json), so turning it off restores the plan
exactly, and `apply` is idempotent — it undoes the last pass and redoes it — so it can run again
after "Regenerate plan" or a new B race.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

RUN_MIN, RUN_MIN_CUT = 35, 30
TAPER_A_DAYS, TAPER_B_DAYS = 10, 7
NOTE_SWAP = "Swapped for an easy run — one gym a week, the other a run"
NOTE_RUN = "Instead of the week's second gym"
NOTE_TAPER = "No gym this close to {race} — legs fresh"


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS gym_run_swaps (
        goal_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, changes_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")


def _state(conn, goal_id: int) -> tuple[bool, dict]:
    ensure_table(conn)
    r = conn.execute("SELECT enabled, changes_json FROM gym_run_swaps WHERE goal_id=?", (goal_id,)).fetchone()
    if not r:
        return False, {}
    try:
        return bool(r[0]), json.loads(r[1] or "{}")
    except ValueError:
        return bool(r[0]), {}


def _save(conn, goal_id: int, enabled: bool, ch: dict) -> None:
    conn.execute("""INSERT INTO gym_run_swaps (goal_id, enabled, changes_json) VALUES (?,?,?)
                    ON CONFLICT(goal_id) DO UPDATE SET enabled=excluded.enabled, changes_json=excluded.changes_json,
                    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')""", (goal_id, int(enabled), json.dumps(ch)))


def _undo(conn, ch: dict) -> None:
    for sid in ch.get("inserted", []):
        conn.execute("DELETE FROM plan_sessions WHERE id=? AND status IN ('pending', 'displaced')", (sid,))
    for s in ch.get("set_aside", []):
        conn.execute("UPDATE plan_sessions SET status='pending', schedule_note=? WHERE id=? AND status='displaced'",
                     (s.get("note"), s["id"]))


def _gyms(conn, goal_id: int, a: date, b: date) -> list:
    return conn.execute("""SELECT * FROM plan_sessions WHERE goal_id=? AND status='pending'
                           AND lower(session_type) LIKE 'strength%' AND session_date BETWEEN ? AND ?
                           ORDER BY session_date, id""", (goal_id, a.isoformat(), b.isoformat())).fetchall()


def apply(conn: sqlite3.Connection, goal_id: int, today: date | None = None, replan: bool = True) -> dict:
    """(Re)do the swap for the goal if it's on. Returns the summary. Commits."""
    on, ch = _state(conn, goal_id)
    _undo(conn, ch)
    if not on:
        _save(conn, goal_id, False, {})
        conn.commit()
        return summary(conn, goal_id)
    goal = conn.execute("SELECT * FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    if goal is None:
        raise LookupError("goal not found")
    today = today or date.today()
    race = date.fromisoformat(goal["race_date"])
    from domains.training.b_race import _insert, easy_run
    new: dict = {"inserted": [], "set_aside": []}

    def aside(s, note, kind):
        new["set_aside"].append({"id": s["id"], "note": s["schedule_note"], "kind": kind})
        conn.execute("UPDATE plan_sessions SET status='displaced', schedule_note=? WHERE id=?", (note, s["id"]))

    # tapers first: no gym in the last days before a race
    tapers = [(race - timedelta(days=TAPER_A_DAYS), race, goal["name"])]
    try:
        tapers += [(date.fromisoformat(b["race_date"]) - timedelta(days=TAPER_B_DAYS), date.fromisoformat(b["race_date"]),
                    b["name"]) for b in conn.execute("SELECT name, race_date FROM b_races WHERE goal_id=?", (goal_id,))]
    except sqlite3.OperationalError:
        pass
    for a, b, name in tapers:
        for s in _gyms(conn, goal_id, max(a, today), b):
            aside(s, NOTE_TAPER.format(race=name), "taper")

    monday = today - timedelta(days=today.weekday())
    while monday < race:
        gyms = _gyms(conn, goal_id, max(monday, today), monday + timedelta(days=6))
        if len(gyms) >= 2:
            def alone(s):
                return conn.execute("SELECT COUNT(*) FROM plan_sessions WHERE goal_id=? AND session_date=? "
                                    "AND status='pending'", (goal_id, s["session_date"])).fetchone()[0] == 1
            for s in sorted(gyms, key=lambda s: (not alone(s), s["session_date"]))[:len(gyms) - 1]:
                cut = (s["effective_duration_min"] or s["duration_min"]) < s["duration_min"]
                aside(s, NOTE_SWAP, "swap")
                new["inserted"].append(_insert(conn, goal_id, date.fromisoformat(s["session_date"]),
                                               easy_run(None, RUN_MIN_CUT if cut else RUN_MIN), NOTE_RUN))
        monday += timedelta(days=7)

    _save(conn, goal_id, True, new)
    conn.commit()
    if replan:
        from domains.training.reflow import reflow_goal
        reflow_goal(conn, goal_id)
    return summary(conn, goal_id)


def set_enabled(conn: sqlite3.Connection, goal_id: int, enabled: bool, today: date | None = None) -> dict:
    _, ch = _state(conn, goal_id)
    _save(conn, goal_id, enabled, ch)
    return apply(conn, goal_id, today)


def summary(conn: sqlite3.Connection, goal_id: int) -> dict:
    on, ch = _state(conn, goal_id)
    kinds = [x.get("kind") for x in ch.get("set_aside", [])]
    return {"goal_id": goal_id, "enabled": on, "runs": len(ch.get("inserted", [])),
            "gyms_swapped": kinds.count("swap"), "gyms_tapered": kinds.count("taper")}
