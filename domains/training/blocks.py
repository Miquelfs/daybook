"""
Camp / tour blocks — a deliberate block of riding that replaces the plan for a
date range (e.g. a bike tour in Taiwan).

Creating a block:
  1. pending plan sessions inside the range are set aside ('displaced', note
     "Replaced by tour: …") — not missed, not rescheduled;
  2. each riding day gets a pinned "Tour day" session (Z2), its duration
     estimated from the day's km and climbing (loaded touring: 24 km/h on the
     flat + 1 h per 800 m of climbing), so the real rides auto-link and count;
  3. the week after the block becomes a recovery week: hard sessions turn into
     easy Z2 at ~60 % duration, long rides are capped at 2 h.
Riding days can carry a GPX course: the session then takes its time, load,
climbs and step-by-step structure from the route (see gpx_course), and the
course is kept in `session_courses` for the session sheet, the map and the
planned-vs-actual comparison. `projection` runs the fitness model forward
through the block and its recovery week.
Everything changed is recorded so deleting the block restores the plan exactly.

Re-plan (reflow) never places sessions on block days, the weekend planning
nudge stays quiet for weeks inside a block, and the AI coach is told the block
is deliberate.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

FLAT_KMH = 24.0
CLIMB_M_PER_H = 800.0
RECOVERY_FACTOR = 0.6
RECOVERY_LONG_CAP = 120


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS training_blocks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id      INTEGER NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'tour',     -- tour | camp
        name         TEXT NOT NULL,
        start_date   TEXT NOT NULL,
        end_date     TEXT NOT NULL,
        days_json    TEXT NOT NULL DEFAULT '[]',       -- [{date, km, climb_m, note, optional}]
        changes_json TEXT NOT NULL DEFAULT '{}',       -- what to undo
        created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    conn.commit()


def ensure_courses(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS session_courses (
        session_id   INTEGER PRIMARY KEY,
        name         TEXT,
        course_json  TEXT NOT NULL,                    -- gpx_course.parse() output
        created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")


def course_for(conn, session_id: int) -> dict | None:
    try:
        r = conn.execute("SELECT course_json FROM session_courses WHERE session_id=?", (session_id,)).fetchone()
        return json.loads(r[0]) if r else None
    except (sqlite3.OperationalError, ValueError):
        return None


def estimate_minutes(km: float, climb_m: float) -> int:
    return int(round((km / FLAT_KMH + (climb_m or 0) / CLIMB_M_PER_H) * 60 / 5) * 5)


def block_for(conn, d: str) -> sqlite3.Row | None:
    try:
        return conn.execute("SELECT * FROM training_blocks WHERE start_date <= ? AND end_date >= ? LIMIT 1",
                            (d, d)).fetchone()
    except sqlite3.OperationalError:
        return None


def _week_number_for(conn, goal_id: int, d: str) -> int:
    r = conn.execute("SELECT plan_start_date FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    if not r or not r[0]:
        return 1
    return max(1, (date.fromisoformat(d) - date.fromisoformat(r[0])).days // 7 + 1)


def create(conn, goal_id: int, name: str, start: str, end: str, days: list[dict], kind: str = "tour") -> dict:
    ensure_table(conn)
    if end < start:
        raise ValueError("end before start")
    overlap = conn.execute(
        "SELECT name FROM training_blocks WHERE goal_id=? AND start_date <= ? AND end_date >= ?",
        (goal_id, end, start)).fetchone()
    if overlap:
        raise ValueError(f"overlaps '{overlap[0]}'")
    from domains.training.reflow import _ensure_columns
    _ensure_columns(conn)
    label = f"Replaced by {kind}: {name}"
    changes: dict = {"displaced": [], "tour_sessions": [], "recovery": []}

    # 1. set the plan aside inside the block
    for r in conn.execute(
            "SELECT id, session_type FROM plan_sessions WHERE goal_id=? AND status='pending' "
            "AND session_date BETWEEN ? AND ? AND lower(session_type) != 'race day'",
            (goal_id, start, end)).fetchall():
        conn.execute("UPDATE plan_sessions SET status='displaced', schedule_note=? WHERE id=?", (label, r["id"]))
        changes["displaced"].append(r["id"])

    # 2. one pinned Tour day per riding day (from its GPX course when there is one)
    ensure_courses(conn)
    for d in days:
        course = None
        if d.get("gpx"):
            from domains.training import gpx_course
            course = gpx_course.parse(d["gpx"], d.get("note"))
            d["km"], d["climb_m"] = course["km"], course["climb_m"]
            d["note"] = d.get("note") or course["name"]
        km = float(d.get("km") or 0)
        if km <= 0 or not (start <= d["date"] <= end):
            continue
        note = d.get("note") or ""
        if course:
            from domains.training.gpx_course import structure as course_structure
            mins = course["minutes"]
            structure = course_structure(course, f"{name}: {note}".strip(": ") or name)
        else:
            mins = estimate_minutes(km, float(d.get("climb_m") or 0))
            structure = [{"kind": "steady", "label": f"{name}: {note}".strip(": ") or name, "duration_min": mins, "zone": "Z2",
                          "cue": f"{km:.0f} km · {int(d.get('climb_m') or 0)} m — conversational Z2, climbs low Z3 max; "
                                 f"eat from minute 20"}]
        cur = conn.execute(
            """INSERT INTO plan_sessions (goal_id, session_date, original_date, week_number, session_type, discipline,
                   duration_min, intensity_zone, is_optional, effective_duration_min, status, structure_json,
                   is_displaced, role, schedule_note)
               VALUES (?,?,?,?,?, 'cycling', ?, 'Z2', ?, ?, 'pending', ?, 1, ?, ?)""",
            (goal_id, d["date"], d["date"], _week_number_for(conn, goal_id, d["date"]),
             f"Cycling - {kind.title()} day", mins, 1 if d.get("optional") else 0, mins, json.dumps(structure),
             "long" if mins >= 150 else "easy", f"{kind.title()}: {name}" + (f" — {note}" if note else "")))
        changes["tour_sessions"].append(cur.lastrowid)
        if course:
            conn.execute("INSERT OR REPLACE INTO session_courses (session_id, name, course_json) VALUES (?,?,?)",
                         (cur.lastrowid, course["name"], json.dumps(course)))
        d.pop("gpx", None)                       # the course lives in session_courses, not in days_json

    # 3. the week after: recovery
    r_start = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    r_end = (date.fromisoformat(end) + timedelta(days=7)).isoformat()
    for r in conn.execute(
            """SELECT id, session_type, intensity_zone, effective_duration_min, duration_min, role FROM plan_sessions
               WHERE goal_id=? AND status='pending' AND session_date BETWEEN ? AND ?
                 AND lower(session_type) != 'race day'""", (goal_id, r_start, r_end)).fetchall():
        eff = r["effective_duration_min"] or r["duration_min"] or 0
        stype = (r["session_type"] or "").lower()
        if stype.startswith("strength"):
            new_eff, new_zone = max(25, round(eff * 0.7)), r["intensity_zone"]       # light gym
        elif r["intensity_zone"] in ("Z3", "Z4", "Z5") or stype.startswith("test"):
            new_eff, new_zone = max(30, round(eff * RECOVERY_FACTOR)), "Z2"
        elif (r["role"] or "") in ("long", "long2") or eff >= 150:
            new_eff, new_zone = min(eff, RECOVERY_LONG_CAP), "Z2"
        else:
            new_eff, new_zone = max(20, round(eff * RECOVERY_FACTOR)), r["intensity_zone"]
        changes["recovery"].append({"id": r["id"], "eff": eff, "zone": r["intensity_zone"]})
        conn.execute("""UPDATE plan_sessions SET effective_duration_min=?, intensity_zone=?, schedule_note=?
                        WHERE id=?""", (new_eff, new_zone, f"Recovery after {name} — easy, let it absorb", r["id"]))

    cur = conn.execute(
        """INSERT INTO training_blocks (goal_id, kind, name, start_date, end_date, days_json, changes_json)
           VALUES (?,?,?,?,?,?,?)""",
        (goal_id, kind, name, start, end, json.dumps(days), json.dumps(changes)))
    conn.commit()
    return get(conn, cur.lastrowid)


def delete(conn, block_id: int) -> None:
    """Undo a block exactly: remove its tour days, restore set-aside and recovery-week sessions."""
    ensure_table(conn)
    b = conn.execute("SELECT * FROM training_blocks WHERE id=?", (block_id,)).fetchone()
    if not b:
        raise ValueError("block not found")
    ch = json.loads(b["changes_json"] or "{}")
    ensure_courses(conn)
    for sid in ch.get("tour_sessions", []):
        gone = conn.execute("DELETE FROM plan_sessions WHERE id=? AND status != 'completed'", (sid,)).rowcount
        if gone:
            conn.execute("DELETE FROM session_courses WHERE session_id=?", (sid,))
    for sid in ch.get("displaced", []):
        conn.execute("UPDATE plan_sessions SET status='pending', schedule_note=NULL WHERE id=? AND status='displaced'",
                     (sid,))
    for r in ch.get("recovery", []):
        conn.execute("UPDATE plan_sessions SET effective_duration_min=?, intensity_zone=?, schedule_note=NULL "
                     "WHERE id=? AND status='pending'", (r["eff"], r["zone"], r["id"]))
    conn.execute("DELETE FROM training_blocks WHERE id=?", (block_id,))
    conn.commit()


def get(conn, block_id: int) -> dict:
    b = conn.execute("SELECT * FROM training_blocks WHERE id=?", (block_id,)).fetchone()
    return _out(conn, b) if b else {}


def _out(conn, b) -> dict:
    days = json.loads(b["days_json"] or "[]")
    sessions = conn.execute(
        "SELECT id, session_date, status, effective_duration_min, completed_activity_id FROM plan_sessions "
        "WHERE goal_id=? AND session_type LIKE ? AND session_date BETWEEN ? AND ? ORDER BY session_date",
        (b["goal_id"], f"Cycling - {b['kind'].title()} day", b["start_date"], b["end_date"])).fetchall()
    done = sum(1 for s in sessions if s["status"] == "completed")
    ride_days = []
    for s in sessions:
        c = course_for(conn, s["id"])
        ride_days.append({"session_id": s["id"], "date": s["session_date"], "status": s["status"],
                          "minutes": s["effective_duration_min"],
                          "course": {k: c[k] for k in ("name", "km", "climb_m", "climb_raw_m", "high_m", "tss", "avg_kmh")}
                          | {"tunnels": len(c["tunnels"]), "climbs": len(c["climbs"])} if c else None})
    return {"id": b["id"], "goal_id": b["goal_id"], "kind": b["kind"], "name": b["name"],
            "start_date": b["start_date"], "end_date": b["end_date"], "days": days, "ride_days": ride_days,
            "riding_days": len(sessions), "done": done,
            "total_km": round(sum(float(d.get("km") or 0) for d in days)),
            "total_climb_m": int(sum(float(d.get("climb_m") or 0) for d in days)),
            "planned_hours": round(sum(s["effective_duration_min"] or 0 for s in sessions) / 60, 1),
            "projection": projection(conn, b)}


def list_blocks(conn, goal_id: int | None = None) -> list[dict]:
    ensure_table(conn)
    q = "SELECT * FROM training_blocks" + (" WHERE goal_id=?" if goal_id else "") + " ORDER BY start_date"
    return [_out(conn, b) for b in conn.execute(q, (goal_id,) if goal_id else ())]


def context_for_coach(conn, start: str, end: str) -> list[dict]:
    """Blocks overlapping [start − 14 d, end] for the AI coach prompt."""
    ensure_table(conn)
    s = (date.fromisoformat(start) - timedelta(days=14)).isoformat()
    return [{"name": b["name"], "kind": b["kind"], "from": b["start_date"], "to": b["end_date"],
             "recovery_week_after": [(date.fromisoformat(b["end_date"]) + timedelta(days=1)).isoformat(),
                                     (date.fromisoformat(b["end_date"]) + timedelta(days=7)).isoformat()]}
            for b in conn.execute("SELECT * FROM training_blocks WHERE end_date >= ? AND start_date <= ?", (s, end))]


# ── fitness projection ───────────────────────────────────────────────────────

ZONE_IF = {"Z1": 0.55, "Z2": 0.65, "Z3": 0.80, "Z4": 0.90, "Z5": 1.00}
GYM_TSS_H = 25


def session_tss(conn, s) -> float:
    """Planned load of one session: the course estimate for routed days, else minutes × IF² by zone."""
    c = course_for(conn, s["id"])
    if c and c.get("tss"):
        return float(c["tss"])
    mins = s["effective_duration_min"] or s["duration_min"] or 0
    if (s["discipline"] or "") not in ("cycling", "running", "swimming", "brick"):
        return mins / 60 * GYM_TSS_H
    if_ = ZONE_IF.get(s["intensity_zone"], 0.65)
    return mins / 60 * 100 * if_ ** 2


def projection(conn, b, today: date | None = None) -> dict | None:
    """Fitness / form from today through the block and its recovery week, if the plan is ridden as written."""
    import math
    today = today or date.today()
    try:
        row = conn.execute("SELECT date, ctl, atl FROM training_load_daily WHERE sport='combined' AND date <= ? "
                           "AND ctl IS NOT NULL ORDER BY date DESC LIMIT 1", (today.isoformat(),)).fetchone()
    except sqlite3.OperationalError:
        return None
    if not row:
        return None
    k_ctl, k_atl = 1 - math.exp(-1 / 42), 1 - math.exp(-1 / 7)
    ctl, atl = row["ctl"], row["atl"]
    start, end = date.fromisoformat(b["start_date"]), date.fromisoformat(b["end_date"])
    rec_end = end + timedelta(days=7)
    d = date.fromisoformat(row["date"]) + timedelta(days=1)
    snap: dict = {}
    block_tss = 0.0
    if d >= start:                                # block already under way / over — project from now
        snap["before"] = {"date": row["date"], "fitness": round(ctl), "form": round(ctl - atl)}
    while d <= rec_end:
        tss = sum(session_tss(conn, s) for s in conn.execute(
            "SELECT * FROM plan_sessions WHERE goal_id=? AND session_date=? AND status='pending'",
            (b["goal_id"], d.isoformat())).fetchall())
        if start <= d <= end:
            block_tss += tss
        if d == start:
            snap.setdefault("before", {"date": (d - timedelta(days=1)).isoformat(), "fitness": round(ctl),
                                       "form": round(ctl - atl)})
        ctl += (tss - ctl) * k_ctl
        atl += (tss - atl) * k_atl
        if d == end:
            snap["after_block"] = {"date": d.isoformat(), "fitness": round(ctl), "form": round(ctl - atl)}
        d += timedelta(days=1)
    snap["after_recovery"] = {"date": rec_end.isoformat(), "fitness": round(ctl), "form": round(ctl - atl)}
    if "before" in snap and "after_block" in snap:
        snap["fitness_gain"] = snap["after_block"]["fitness"] - snap["before"]["fitness"]
    snap["block_tss"] = round(block_tss)
    return snap
