"""
Engine waypoints for a race goal: where FTP and weight should be at every FTP
test on the way to the targets, and where they actually were.

Targets live on race_goals (target_ftp_w, target_weight_kg, targets_date —
default three weeks before the race, so the weight is stable for race week).
The line starts at the first FTP test of the plan (or the current FTP) and the
weigh-in at the plan start, and runs straight to the targets. Straight is a
simplification — beginners gain FTP faster early on — so a test landing above
the line early is normal; under it is the signal worth acting on.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

from domains.health.weight_trend import glide, trend

TARGETS_LEAD_DAYS = 21


def _has(conn, table: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,)).fetchone())


def _weights(conn) -> list[dict]:
    if not _has(conn, "weight_log"):
        return []
    return [dict(r) for r in conn.execute("SELECT date, weight_kg FROM weight_log ORDER BY date")]


def _weight_near(entries: list[dict], tr: list[float], on: str, days: int = 7) -> float | None:
    """Trend weight on a date (from the nearest weigh-in within ±days)."""
    best = None
    d = date.fromisoformat(on)
    for e, t in zip(entries, tr):
        gap = abs((date.fromisoformat(e["date"]) - d).days)
        if gap <= days and (best is None or gap < best[0]):
            best = (gap, t)
    return best[1] if best else None


def goal_targets(conn, goal) -> dict | None:
    """{"target_ftp_w","target_kg","target_date","start_date","start_kg","start_ftp_w"} or None."""
    keys = goal.keys() if hasattr(goal, "keys") else goal
    if "target_weight_kg" not in keys:
        return None
    tftp, tkg = goal["target_ftp_w"], goal["target_weight_kg"]
    if not tftp and not tkg:
        return None
    tdate = goal["targets_date"] or (date.fromisoformat(goal["race_date"]) - timedelta(days=TARGETS_LEAD_DAYS)).isoformat()
    plan_start = goal["plan_start_date"] or date.today().isoformat()

    entries = _weights(conn)
    before = [e for e in entries if e["date"] <= plan_start]
    after = [e for e in entries if e["date"] > plan_start]
    start_w = before[-1] if before else (after[0] if after else None)

    start_ftp = None
    if _has(conn, "benchmark_results"):
        b = conn.execute("""SELECT date, derived_json FROM benchmark_results
                            WHERE sport='ride' AND date >= ? ORDER BY date LIMIT 1""",
                         ((date.fromisoformat(plan_start) - timedelta(days=7)).isoformat(),)).fetchone()
        if b:
            start_ftp = (b["date"], (json.loads(b["derived_json"] or "{}")).get("ftp_w"))
    if not start_ftp or not start_ftp[1]:
        z = conn.execute("SELECT valid_from, ftp_w FROM athlete_zones WHERE sport='ride' AND ftp_w IS NOT NULL "
                         "ORDER BY valid_from LIMIT 1").fetchone() if _has(conn, "athlete_zones") else None
        start_ftp = (z["valid_from"], z["ftp_w"]) if z else None
    return {
        "target_ftp_w": tftp, "target_kg": tkg, "target_date": tdate,
        "start_date": start_w["date"] if start_w else None, "start_kg": start_w["weight_kg"] if start_w else None,
        "start_ftp_date": start_ftp[0] if start_ftp else None, "start_ftp_w": start_ftp[1] if start_ftp else None,
    }


def waypoints(conn, goal_id: int) -> dict | None:
    goal = conn.execute("SELECT * FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    if goal is None:
        return None
    t = goal_targets(conn, goal)
    if t is None:
        return None
    entries = _weights(conn)
    tr = trend(entries) if entries else []

    tests = conn.execute(
        """SELECT id, session_date, status FROM plan_sessions
           WHERE goal_id=? AND lower(session_type) LIKE 'test%ftp%' AND status IN ('pending','completed','skipped')
           ORDER BY session_date""", (goal_id,)).fetchall()
    bench: dict = {}
    if _has(conn, "benchmark_results"):
        for b in conn.execute("SELECT date, session_id, derived_json FROM benchmark_results WHERE sport='ride' "
                              "AND test_type='bike_20min' ORDER BY date, id"):
            ftp = json.loads(b["derived_json"] or "{}").get("ftp_w")
            if ftp:
                bench[b["session_id"] or b["date"]] = (b["date"], ftp)

    def target_ftp(on: str):
        if not (t["target_ftp_w"] and t["start_ftp_w"] and t["start_ftp_date"]):
            return t["target_ftp_w"]
        return round(glide((t["start_ftp_date"], t["start_ftp_w"]), (t["target_date"], t["target_ftp_w"]), on))

    def target_kg(on: str):
        if not (t["target_kg"] and t["start_kg"]):
            return t["target_kg"]
        return round(glide((t["start_date"], t["start_kg"]), (t["target_date"], t["target_kg"]), on), 1)

    points = []
    for s in tests:
        d = s["session_date"]
        got = bench.get(s["id"]) or bench.get(d)
        ftp_t, kg_t = target_ftp(d), target_kg(d)
        kg_a = _weight_near(entries, tr, got[0] if got else d) if (got or d <= date.today().isoformat()) else None
        points.append({
            "date": d, "session_id": s["id"], "status": s["status"], "kind": "test",
            "target_ftp_w": ftp_t, "target_kg": kg_t,
            "target_wkg": round(ftp_t / kg_t, 2) if ftp_t and kg_t else None,
            "ftp_w": got[1] if got else None, "kg": round(kg_a, 1) if kg_a else None,
            "wkg": round(got[1] / kg_a, 2) if got and kg_a else None,
        })
    points.append({
        "date": t["target_date"], "session_id": None, "status": "pending", "kind": "goal",
        "target_ftp_w": t["target_ftp_w"], "target_kg": t["target_kg"],
        "target_wkg": round(t["target_ftp_w"] / t["target_kg"], 2) if t["target_ftp_w"] and t["target_kg"] else None,
        "ftp_w": None, "kg": None, "wkg": None,
    })
    points.sort(key=lambda p: p["date"])
    return {"targets": t, "points": points}


def active_goal_targets(conn) -> dict | None:
    """Targets of the nearest upcoming active race goal that has any — for the weight page."""
    try:
        goals = conn.execute("SELECT * FROM race_goals WHERE status='active' AND race_date >= ? ORDER BY race_date",
                             (date.today().isoformat(),)).fetchall()
    except sqlite3.OperationalError:
        return None
    for g in goals:
        t = goal_targets(conn, g)
        if t:
            return {**t, "goal_id": g["id"], "goal_name": g["name"]}
    return None
