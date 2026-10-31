"""
What a single ride/run explored: kilometres on roads you had never been on before, and the
villages it passed — which of them for the first time.

  - New road: this track resampled every 50 m; a sample is "new" when no earlier outdoor
    activity of the same sport came within ~50–100 m of it (earlier tracks from their
    summary polylines — good enough at this tolerance, and cheap). New stretches are
    returned as polylines so the map can paint them.
  - Villages (Mallorca reference, see mallorca/coverage): passed when the track comes
    within ~400 m of the village node; first visit when no earlier track did.

Cached per activity in `activity_explore`, keyed by how many earlier tracks there were.
"""

from __future__ import annotations

import json
import sqlite3

from domains.health.activity_analysis import is_indoor, sport_of
from domains.health.geo import Grid, activity_track, decode, encode, sample

STEP_M = 50
NEAR_M = 50
VILLAGE_M = 200
MIN_NEW_RUN_M = 300          # shorter "new" bits are GPS wobble / a different lane


def ensure_table(conn) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS activity_explore (activity_id TEXT PRIMARY KEY, signature TEXT, "
                 "result_json TEXT, computed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))")


def _earlier(conn, act, sport) -> list:
    rows = conn.execute(
        """SELECT id, date, activity_type, polyline FROM activities
           WHERE polyline IS NOT NULL AND polyline != '' AND id != ?
             AND (date < ? OR (date = ? AND COALESCE(start_time, '') < COALESCE(?, '')))
           ORDER BY date""", (act["id"], act["date"], act["date"], act["start_time"])).fetchall()
    return [r for r in rows if sport_of(r["activity_type"]) == sport and not is_indoor(r["activity_type"])]


def get(conn: sqlite3.Connection, activity_id: str) -> dict | None:
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if act is None or not act["polyline"] or is_indoor(act["activity_type"]):
        return None
    sport = sport_of(act["activity_type"])
    if sport not in ("ride", "run", "hike"):
        return None
    ensure_table(conn)
    earlier = _earlier(conn, act, sport)
    sig = f"{len(earlier)}|{earlier[-1]['id'] if earlier else '-'}"
    row = conn.execute("SELECT signature, result_json FROM activity_explore WHERE activity_id=?",
                       (activity_id,)).fetchone()
    if row and row[0] == sig:
        return json.loads(row[1]) if row[1] else None
    result = compute(conn, act, earlier)
    conn.execute("INSERT OR REPLACE INTO activity_explore (activity_id, signature, result_json) VALUES (?,?,?)",
                 (activity_id, sig, json.dumps(result) if result else None))
    conn.commit()
    return result


def compute(conn, act, earlier) -> dict | None:
    track = activity_track(conn, act["id"], act["polyline"])
    pts = sample(track, STEP_M)
    if len(pts) < 10:
        return None
    lat0 = pts[0][0]
    seen, seen_v = Grid(NEAR_M, lat0), Grid(VILLAGE_M, lat0)
    for r in earlier:
        for p in sample(decode(r["polyline"]), STEP_M / 2):
            seen.add(p)
            seen_v.add(p, r["date"])

    # new road: runs of consecutive unseen samples, kept when ≥ MIN_NEW_RUN_M
    new_lines, run = [], []
    for p in pts + [None]:
        if p is not None and not seen.near(p):
            run.append(p)
            continue
        if len(run) * STEP_M >= MIN_NEW_RUN_M:
            new_lines.append(run)
        run = []
    new_m = sum(len(l) * STEP_M for l in new_lines)
    total_m = len(pts) * STEP_M

    villages = []
    try:
        from domains.locations.mallorca.coverage import BOX, reference
        if any(BOX[0] <= p[0] <= BOX[2] and BOX[1] <= p[1] <= BOX[3] for p in pts[:: max(1, len(pts) // 40)]):
            mine = Grid(VILLAGE_M, lat0)
            for p in pts:
                mine.add(p)
            for name, lat, lng, place, _muni in reference()["villages"]:
                if mine.near((lat, lng)):
                    first = seen_v.near((lat, lng))
                    villages.append({"name": name, "place": place, "new": first is None, "first_date": first})
    except Exception:
        villages = []
    villages.sort(key=lambda v: (not v["new"], v["name"]))

    return {
        "sport": sport_of(act["activity_type"]), "earlier": len(earlier),
        "total_km": round(total_m / 1000, 1), "new_km": round(new_m / 1000, 1),
        "new_pct": round(new_m / total_m * 100) if total_m else 0,
        "new_lines": [encode(l) for l in new_lines],
        "villages": villages, "new_villages": sum(1 for v in villages if v["new"]),
    }
