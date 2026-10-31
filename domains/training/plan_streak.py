"""
Plan consistency around one completed session: how many planned sessions in a row are done
(ending at this one) and how much of the last four weeks' plan was completed.

Optional sessions don't break a streak unless they were done (then they count); displaced
sessions moved elsewhere and are ignored. A skipped or still-pending past session breaks it.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta


def for_activity(conn: sqlite3.Connection, activity_id: str) -> dict | None:
    try:
        s = conn.execute("SELECT p.*, g.name AS goal_name FROM plan_sessions p JOIN race_goals g ON g.id = p.goal_id "
                         "WHERE p.completed_activity_id = ? LIMIT 1", (activity_id,)).fetchone()
    except sqlite3.OperationalError:
        return None
    if s is None:
        return None
    rows = conn.execute(
        """SELECT id, session_date, status, is_optional FROM plan_sessions
           WHERE goal_id = ? AND session_date <= ? AND status != 'displaced'
           ORDER BY session_date DESC, id DESC""", (s["goal_id"], s["session_date"])).fetchall()
    streak = 0
    for r in rows:
        if r["status"] == "completed":
            streak += 1
        elif r["is_optional"]:
            continue
        else:
            break
    since = (date.fromisoformat(s["session_date"]) - timedelta(days=27)).isoformat()
    window = [r for r in rows if r["session_date"] >= since and (not r["is_optional"] or r["status"] == "completed")]
    done = sum(1 for r in window if r["status"] == "completed")
    return {"goal": s["goal_name"], "streak": streak, "done_4w": done, "planned_4w": len(window),
            "pct_4w": round(done / len(window) * 100) if window else None}
