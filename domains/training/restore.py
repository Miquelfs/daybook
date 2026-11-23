"""
Put a session back to what the plan wrote: its full length (× the goal's volume factor) and its
own intensity, with no override left from a recovery week, B race or "only ~1h free".

The intensity a session was written with is the hardest zone in its structure (a Puig Major climb
sim is Z3 work in Z1 recoveries → Z3); a recovery week turns that into Z2 on the session but
leaves the structure alone. Restoring also takes the session out of any block's recovery list
(so deleting the tour later doesn't cut it again) and re-plans the goal: the session then lands
on a day that holds it.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

ZONES = ["Z1", "Z2", "Z3", "Z4", "Z5"]
RECOVERY_DAYS = 7


def written_zone(structure_json: str | None) -> str | None:
    try:
        steps = json.loads(structure_json or "null") or []
    except (TypeError, ValueError):
        return None
    zs = [z for st in steps if isinstance(st, dict) for z in (st.get("zone"), st.get("work_zone")) if z in ZONES]
    return max(zs, key=ZONES.index) if zs else None


def recovery_windows(conn: sqlite3.Connection, goal_id: int | None = None) -> list[dict]:
    """Each tour/camp block's recovery week: {name, start, end, entries: {session id: {eff, zone}}}."""
    try:
        rows = conn.execute("SELECT id, goal_id, name, end_date, changes_json FROM training_blocks").fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for b in rows:
        if goal_id is not None and b["goal_id"] != goal_id:
            continue
        end = date.fromisoformat(b["end_date"])
        try:
            ch = json.loads(b["changes_json"] or "{}")
        except ValueError:
            ch = {}
        out.append({"id": b["id"], "name": b["name"], "start": end + timedelta(days=1),
                    "end": end + timedelta(days=RECOVERY_DAYS),
                    "entries": {int(e["id"]): e for e in ch.get("recovery", []) if "id" in e}})
    return out


def forget_recovery(conn: sqlite3.Connection, session_id: int) -> None:
    """Drop the session from every block's recovery list."""
    for w in recovery_windows(conn):
        if session_id not in w["entries"]:
            continue
        b = conn.execute("SELECT changes_json FROM training_blocks WHERE id=?", (w["id"],)).fetchone()
        ch = json.loads(b["changes_json"] or "{}")
        ch["recovery"] = [e for e in ch.get("recovery", []) if int(e.get("id", -1)) != session_id]
        conn.execute("UPDATE training_blocks SET changes_json=? WHERE id=?", (json.dumps(ch), w["id"]))


def restore_full(conn: sqlite3.Connection, session_id: int, replan: bool = True) -> dict:
    s = conn.execute("""SELECT ps.*, rg.volume_factor FROM plan_sessions ps JOIN race_goals rg ON rg.id = ps.goal_id
                        WHERE ps.id=?""", (session_id,)).fetchone()
    if s is None:
        raise LookupError("session not found")
    if s["status"] not in ("pending", "displaced"):
        raise ValueError("only a session still to do can be restored")
    eff = max(10, round((s["duration_min"] or 0) * (s["volume_factor"] or 1.0)))
    zone = written_zone(s["structure_json"] if "structure_json" in s.keys() else None) or s["intensity_zone"]
    from domains.training.reflow import _ensure_columns, reflow_goal
    _ensure_columns(conn)
    conn.execute("""UPDATE plan_sessions SET effective_duration_min=?, eff_override=NULL, intensity_zone=?,
                           status='pending', schedule_note=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                    WHERE id=?""", (eff, zone, session_id))
    forget_recovery(conn, session_id)
    conn.commit()
    if replan:
        reflow_goal(conn, s["goal_id"])
    return {"id": session_id, "effective_duration_min": eff, "intensity_zone": zone}
