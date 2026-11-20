"""
Remove an activity that isn't yours — a friend borrowed the watch, a test recording.

It goes everywhere: the activity row, everything computed from it (streams, analysis, efforts,
climbs, wind…), its Strava copy (Garmin uploads there too — the copy would otherwise surface
once the Garmin row is gone), the plan session it completed (back to pending, and that day is
re-matched), and fitness/fatigue from that day on. The ids go into activity_removed so the next
Garmin or Strava sync doesn't bring it back; the row is kept there as JSON in case it was a mistake.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

STRAVA_TWIN_S = 120          # a Strava copy starts within 2 min of the Garmin one


def ensure_table(conn: sqlite3.Connection) -> None:
    # column deliberately not called activity_id: removal sweeps every table that has one
    conn.execute("""CREATE TABLE IF NOT EXISTS activity_removed (
        removed_id TEXT PRIMARY KEY, reason TEXT, date TEXT, name TEXT, row_json TEXT,
        removed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")


def is_removed(conn: sqlite3.Connection, activity_id: str) -> bool:
    try:
        return conn.execute("SELECT 1 FROM activity_removed WHERE removed_id=?", (activity_id,)).fetchone() is not None
    except sqlite3.OperationalError:
        return False


def _tables_with(conn, column: str) -> list[str]:
    return [t for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            if any(c[1] == column for c in conn.execute(f'PRAGMA table_info("{t}")'))]


def _start(s: str | None) -> datetime | None:
    """Start as naive UTC (Garmin stores naive GMT, Strava ISO with Z)."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d


def _strava_copies(conn, act) -> list[str]:
    """Strava rows of the same workout: linked by strava_id, or starting within 2 min."""
    ids = []
    if act["strava_id"]:
        ids.append(f"strava_{act['strava_id']}")
    s0 = _start(act["start_time"])
    if s0 is not None:
        for r in conn.execute("SELECT id, start_time FROM activities WHERE source='strava' AND date BETWEEN ? AND ?",
                              ((date.fromisoformat(act["date"]) - timedelta(days=1)).isoformat(),
                               (date.fromisoformat(act["date"]) + timedelta(days=1)).isoformat())):
            s = _start(r["start_time"])
            if s is not None and abs((s - s0).total_seconds()) <= STRAVA_TWIN_S:
                ids.append(r["id"])
    return [i for i in dict.fromkeys(ids) if i != act["id"]]


def remove(conn: sqlite3.Connection, activity_id: str, reason: str | None = None) -> dict:
    """Remove the activity (and its Strava copy). Returns {removed: [ids], date}. Commits."""
    ensure_table(conn)
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if act is None:
        raise LookupError("activity not found")
    ids = [activity_id] + _strava_copies(conn, act)
    tables = _tables_with(conn, "activity_id")
    has_plan = "plan_sessions" in _tables_with(conn, "completed_activity_id")
    auto = has_plan and any(c[1] == "auto_matched" for c in conn.execute("PRAGMA table_info(plan_sessions)"))
    for aid in ids:
        row = conn.execute("SELECT * FROM activities WHERE id=?", (aid,)).fetchone()
        conn.execute("INSERT OR REPLACE INTO activity_removed (removed_id, reason, date, name, row_json) VALUES (?,?,?,?,?)",
                     (aid, reason, row["date"] if row else act["date"], row["name"] if row else act["name"],
                      json.dumps(dict(row)) if row else None))
        for t in tables:
            conn.execute(f'DELETE FROM "{t}" WHERE activity_id=?', (aid,))
        if has_plan:
            conn.execute(f"""UPDATE plan_sessions SET completed_activity_id=NULL, status='pending'
                             {', auto_matched=0' if auto else ''} WHERE completed_activity_id=?""", (aid,))
        conn.execute("DELETE FROM activities WHERE id=?", (aid,))

    day = act["date"]
    try:
        from domains.health.activity_dates import relink
        relink(conn, {}, {day})                      # another activity that day may fulfil the session
    except Exception:                                # noqa: BLE001 — never block a removal on re-matching
        pass
    try:
        from domains.health.compute_training_load import recompute
        recompute(conn, date.fromisoformat(day) - timedelta(days=1))
    except sqlite3.OperationalError:
        pass
    conn.commit()
    return {"removed": ids, "date": day}
