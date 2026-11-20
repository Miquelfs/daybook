"""
Auto-match activities → plan sessions.

A planned session and the real activity that fulfilled it should be one thing. When a
Garmin/Strava activity is logged on the same day as a pending session of the matching
discipline, it's linked automatically (status → completed), leaving RPE blank for you to
fill. Lives here (not in the race-plans router) so syncs and repairs can use it without
FastAPI.
"""

from __future__ import annotations

import sqlite3
from typing import Optional


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


# Activity types per sport — the training router's lists too, so both stay in sync.
_RIDE_ACT_TYPES = ("cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling", "virtual_ride")
_RUN_ACT_TYPES = ("running", "trail_running", "treadmill_running", "indoor_running", "virtual_run")
_SWIM_ACT_TYPES = ("lap_swimming", "open_water_swimming", "swimming")

# Gym sessions get recorded on the watch as strength, a stopwatch "timed activity", cardio…
_STRENGTH_ACT_TYPES: tuple[str, ...] = (
    "strength_training", "stop_watch", "fitness_equipment", "indoor_cardio", "hiit", "training",
    "other", "cardio", "functional_strength", "pilates", "yoga",
)

_DISCIPLINE_ACT_FAMILY: dict[str, tuple[str, ...]] = {
    "running": _RUN_ACT_TYPES,
    "cycling": _RIDE_ACT_TYPES,
    "swimming": _SWIM_ACT_TYPES,
    "brick": tuple(_RUN_ACT_TYPES) + tuple(_RIDE_ACT_TYPES),
}

# Exclude Strava rows that duplicate a Garmin activity (same rule as the training
# router's _DEDUP), so a single workout can't be double-counted.
_ACT_DEDUP = """
    AND NOT (source='strava' AND EXISTS (
      SELECT 1 FROM activities g
      WHERE g.date = activities.date
        AND g.source = 'garmin'
        AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
    ))
"""


def autolink_sessions(
    conn: sqlite3.Connection,
    goal_id: Optional[int] = None,
    on_date: Optional[str] = None,
) -> int:
    """
    Link pending plan sessions to a same-day real activity of the matching
    discipline. Marks matched sessions completed (auto_matched=1), leaving
    rpe_actual untouched. Idempotent — only touches pending, unlinked sessions
    of active goals, and never reuses an activity already linked elsewhere.
    Returns the number of sessions newly linked.
    """
    if not _table_exists(conn, "plan_sessions") or not _table_exists(conn, "activities"):
        return 0

    has_auto = "auto_matched" in {r["name"] for r in conn.execute("PRAGMA table_info(plan_sessions)")}

    clauses = ["ps.status='pending'", "ps.completed_activity_id IS NULL", "rg.status='active'"]
    params: list = []
    if goal_id is not None:
        clauses.append("ps.goal_id=?")
        params.append(goal_id)
    if on_date is not None:
        clauses.append("ps.session_date=?")
        params.append(on_date)

    sessions = conn.execute(
        f"""SELECT ps.id, ps.session_date, ps.discipline, ps.session_type
            FROM plan_sessions ps JOIN race_goals rg ON rg.id = ps.goal_id
            WHERE {' AND '.join(clauses)}
            ORDER BY ps.session_date, ps.discipline""",
        params,
    ).fetchall()
    if not sessions:
        return 0

    # Activities already linked to any session must not be reused.
    consumed: set[str] = {
        r["completed_activity_id"]
        for r in conn.execute(
            "SELECT completed_activity_id FROM plan_sessions WHERE completed_activity_id IS NOT NULL"
        ).fetchall()
    }

    linked = 0
    for s in sessions:
        family = _DISCIPLINE_ACT_FAMILY.get(s["discipline"])
        min_dur = 0
        if not family and (s["session_type"] or "").lower().startswith(("strength", "gym")):
            family, min_dur = _STRENGTH_ACT_TYPES, 15 * 60     # a real gym session, not a 2-min timer
        if not family:
            continue  # other 'other' sessions (mobility, rest…) — skip auto-match
        placeholders = ",".join("?" for _ in family)
        candidates = conn.execute(
            f"""SELECT id FROM activities
                WHERE date = ?
                  AND lower(activity_type) IN ({placeholders})
                  AND COALESCE(moving_time_seconds, duration_seconds, 0) >= {min_dur}
                  {_ACT_DEDUP}
                ORDER BY COALESCE(moving_time_seconds, duration_seconds, 0) DESC""",
            [s["session_date"], *family],
        ).fetchall()
        match_id = next((c["id"] for c in candidates if c["id"] not in consumed), None)
        if not match_id:
            continue
        consumed.add(match_id)
        auto_set = ", auto_matched=1" if has_auto else ""
        conn.execute(
            f"""UPDATE plan_sessions
                SET completed_activity_id=?, status='completed'{auto_set},
                    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE id=?""",
            (match_id, s["id"]),
        )
        linked += 1

    if linked:
        conn.commit()
    return linked
