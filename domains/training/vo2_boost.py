"""
The weekly VO2 boost (mallorca_312.VO2_BOOST): in each boost week one midweek "Zone 2
Ride" becomes "Z2 + VO2 (trainer)" — same easy slot, same aerobic minutes, plus a short
VO2 set that the reflow switches on only where the week has room for it (see reflow).

apply() brings it into a plan that was already materialized. Weeks that already hold
it are left alone, so it's idempotent; the goal is then re-flowed.
as_ridden() is the structure a session will actually be ridden with: a boost whose set
is off this week (intensity Z2) has the VO2 block replaced by steady Z2 — what the
plan card, the Garmin workout and MyWhoosh all get.

  python -m domains.training.vo2_boost            # every active Mallorca 312 goal
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date

from domains.training.plan_templates.mallorca_312 import BOOST_TYPE, MALLORCA_312_TEMPLATE, VO2_BOOST, z2_vo2

Z2_TYPE = "Cycling - Zone 2 Ride"


def as_ridden(structure: list | None, session_type: str | None, zone: str | None) -> list | None:
    if session_type != BOOST_TYPE or zone == "Z5" or not structure:
        return structure
    out = []
    for st in structure:
        if st.get("kind") == "intervals" and st.get("work_zone") == "Z5":
            mins = (st.get("reps") or 1) * ((st.get("work_min") or 0) + (st.get("rest_min") or 0))
            out.append({"kind": "steady", "label": "Aerobic ride", "duration_min": mins, "zone": "Z2",
                        "cue": "No VO2 set this week — steady Z2"})
        else:
            out.append(st)
    return out


def apply(conn: sqlite3.Connection, goal_id: int, today: date | None = None) -> list[int]:
    from domains.training.reflow import _ensure_columns
    _ensure_columns(conn)
    today = today or date.today()
    last = conn.execute("SELECT MAX(week_number) FROM plan_sessions WHERE goal_id=?", (goal_id,)).fetchone()[0]
    if not last:
        return []
    offset = len(MALLORCA_312_TEMPLATE) - last          # a trimmed plan drops foundation weeks first
    changed = []
    for week in sorted({w - offset for w in VO2_BOOST}):
        reps, work = VO2_BOOST[week + offset]
        rows = conn.execute(
            """SELECT * FROM plan_sessions WHERE goal_id=? AND week_number=? AND session_date >= ?""",
            (goal_id, week, today.isoformat())).fetchall()
        if not rows or any(r["session_type"] == BOOST_TYPE for r in rows):
            continue
        cands = [r for r in rows if r["session_type"] == Z2_TYPE
                 and (r["status"] == "pending" or (r["status"] == "displaced"
                                                  and (r["schedule_note"] or "").startswith("No free")))]
        if not cands:
            continue
        # a scheduled, non-optional one first (it keeps its optional flag); displaced ones re-enter the reflow
        r = min(cands, key=lambda r: (r["status"] != "pending", r["is_optional"], r["duration_min"]))
        s = z2_vo2(reps, work, mins=r["duration_min"])
        conn.execute(
            """UPDATE plan_sessions SET session_type=?, intensity_zone=?, duration_min=?, effective_duration_min=?,
                      structure_json=?, role=?, eff_override=NULL, status='pending',
                      schedule_note=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE id=?""",
            (s["type"], s["intensity_zone"], s["duration"], s["duration"], json.dumps(s["structure"]),
             s["role"], r["id"]))
        changed.append(r["id"])
    conn.commit()
    if changed:
        from domains.training.reflow import reflow_goal
        reflow_goal(conn, goal_id)
    return changed


def apply_all(conn: sqlite3.Connection) -> dict[int, list[int]]:
    try:
        goals = conn.execute("SELECT id FROM race_goals WHERE status='active' AND race_type='mallorca_312'").fetchall()
    except sqlite3.OperationalError:
        return {}
    return {g[0]: apply(conn, g[0]) for g in goals}


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    c = get_connection()
    for gid, ids in apply_all(c).items():
        print(f"goal {gid}: {len(ids)} Zone 2 rides → Z2 + VO2 ({ids})")
    c.close()
