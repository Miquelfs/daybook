"""
Coll courses: a GPX in, a .coll course pack out (ciclocomputer/docs/DAYBOOK.md §3).

Building takes minutes to an hour (OpenStreetMap roads from the public Overpass servers)
and peaks at ~150 MB, so it never runs in the API process: `kick()` starts
`python -m domains.coll.worker`, which builds pending courses one at a time.

Before building, the GPX elevations are replaced by Daybook's tunnel-corrected profile
(gpx_course._detunnel), so Coll's climb view doesn't show the hill above the Sóller tunnel.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from domains.coll.coursepack import gpx as G
from domains.health.geo import dist_m, encode

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "coll"
CACHE = ROOT / "data" / "coursepack-cache"
PACK_FORMAT = "COL1"                     # coursepack/pack.py magic; a new one rebuilds everything
STATUSES = ("pending", "building", "ready", "failed")
LIST_COLS = ("id, name, goal_id, session_id, auto, status, error, progress, pack_sha1, on_device, cutoffs, fuel_plan, "
             "summary_json, created_at, built_at, "
             "(SELECT session_date FROM plan_sessions p WHERE p.id = coll_courses.session_id) AS session_date")
# Planned-session courses ride along from the day before (a ride past midnight) to three weeks out;
# races and uploads stay until switched off. ~200 KB a pack, so this stays far inside Coll's flash.
DEVICE_DAYS_BEFORE, DEVICE_DAYS_AHEAD = 1, 21


def sha1(b: bytes | str) -> str:
    return hashlib.sha1(b.encode() if isinstance(b, str) else b).hexdigest()


# ── building ────────────────────────────────────────────────────────────────

def corrected_elevations(points: list[tuple[float, float, float]]) -> tuple[list[float] | None, list[dict]]:
    """Tunnel-corrected elevation per course point, or (None, []) when the GPX has none."""
    from domains.training.gpx_course import _detunnel
    eles = [p[2] for p in points]
    if not any(eles):
        return None, []
    cum = [0.0]
    for a, b in zip(points, points[1:]):
        cum.append(cum[-1] + dist_m(a[:2], b[:2]))
    fixed, tunnels = _detunnel(cum, eles)
    return fixed, tunnels


def _thin_polyline(points, every_m: float = 25) -> str:
    out, last, run = [points[0][:2]], points[0][:2], 0.0
    for p in points[1:]:
        run += dist_m(last, p[:2])
        last = p[:2]
        if run >= every_m:
            out.append(p[:2])
            run = 0.0
    if out[-1] != points[-1][:2]:
        out.append(points[-1][:2])
    return encode(out)


def build_pack(gpx_text: str, cache_dir: str | None = None, log=print) -> dict:
    """GPX → {pack, summary, turns, polyline}. Network unless the Overpass cache has it."""
    from domains.coll.coursepack.build import build
    g = G.parse(gpx_text)
    if len(g["points"]) < 2:
        raise ValueError("no track or route points in the GPX")
    eles, tunnels = corrected_elevations(g["points"])
    data, summary, turns = build(gpx_text, cache_dir, log=log, elevations=eles)
    kinds = {"poi": 0, "feed": 0, "summit": 0, "hazard": 0}
    names = ("poi", "feed", "summit", "hazard")
    for *_, kind, _name in g["waypoints"]:
        kinds[names[kind]] += 1
    summary = {**summary, "tunnels": tunnels, "waypoint_kinds": kinds,
               "waypoint_names": [w[3] for w in g["waypoints"] if w[3]][:200],
               "has_elevation": eles is not None}
    return {"pack": data, "summary": summary, "turns": turns, "polyline": _thin_polyline(g["points"])}


def build_next(conn: sqlite3.Connection, cache_dir: str | None = None, log=print) -> int | None:
    """Claim the oldest pending course, build it, store the result. Returns its id (None: nothing to do)."""
    row = conn.execute("SELECT id, gpx, gpx_sha1 FROM coll_courses WHERE status='pending' ORDER BY id LIMIT 1").fetchone()
    if not row:
        return None
    cid = row["id"]
    if _copy_twin(conn, cid, row["gpx_sha1"]):       # built already for another day: no new build
        conn.commit()
        return cid
    if conn.execute("UPDATE coll_courses SET status='building', error=NULL, progress=NULL "
                    "WHERE id=? AND status='pending'", (cid,)).rowcount == 0:
        conn.commit()
        return cid                                   # someone else took it; look again
    conn.commit()

    def progress(msg: str) -> None:
        log(msg)
        conn.execute("UPDATE coll_courses SET progress=? WHERE id=?", (str(msg)[:200], cid))
        conn.commit()

    try:
        out = build_pack(row["gpx"], cache_dir, log=progress)
    except Exception as e:                           # a bad GPX or Overpass down: say so, keep going
        conn.execute("UPDATE coll_courses SET status='failed', error=?, progress=NULL WHERE id=?",
                     (f"{type(e).__name__}: {e}"[:500], cid))
        conn.commit()
        return cid
    conn.execute(
        """UPDATE coll_courses SET status='ready', error=NULL, progress=NULL, pack=?, pack_sha1=?, pack_format=?,
               summary_json=?, turns_json=?, polyline=?, built_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE id=?""",
        (out["pack"], sha1(out["pack"]), out["pack"][:4].decode(), json.dumps(out["summary"]),
         json.dumps(out["turns"]), out["polyline"], cid))
    conn.commit()
    return cid


def recover(conn: sqlite3.Connection) -> int:
    """Only the worker holding the build lock calls this: a 'building' row then belongs to a dead
    worker (power cut, restart). Courses built with an older pack format are rebuilt too."""
    n = conn.execute("UPDATE coll_courses SET status='pending', progress=NULL WHERE status='building'").rowcount
    n += conn.execute("UPDATE coll_courses SET status='pending' WHERE status='ready' AND pack_format IS NOT ?",
                      (PACK_FORMAT,)).rowcount
    conn.execute("DELETE FROM coll_courses WHERE auto=1 AND session_id IS NULL")   # its session was deleted
    conn.commit()
    return n


def kick() -> None:
    """Start a build worker in its own process. It waits for the build lock, so starting one
    while another runs is harmless: the later one builds whatever is still pending."""
    DATA.mkdir(parents=True, exist_ok=True)
    log = open(DATA / "build.log", "ab")
    subprocess.Popen([sys.executable, "-m", "domains.coll.worker"], cwd=str(ROOT), stdout=log, stderr=log,
                     stdin=subprocess.DEVNULL, start_new_session=True, env={**os.environ, "PYTHONUNBUFFERED": "1"})
    log.close()


def needs_build(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM coll_courses WHERE status IN ('pending','building') "
                        "OR (status='ready' AND pack_format IS NOT ?) LIMIT 1", (PACK_FORMAT,)).fetchone() is not None


# ── storage ─────────────────────────────────────────────────────────────────

def _out(row: sqlite3.Row, detail: bool = False) -> dict:
    d = dict(row)
    s = json.loads(d.pop("summary_json") or "null") or {}
    d["on_device"] = bool(d["on_device"])
    d["auto"] = bool(d.get("auto"))
    for k in ("km", "turns", "keeps", "roundabouts", "matched_pct", "bytes", "waypoints"):
        d[k] = s.get(k)
    if detail:
        d["summary"] = s
        d["turns"] = json.loads(d.pop("turns_json") or "[]")
    return d


def create(conn: sqlite3.Connection, name: str | None, gpx: str, goal_id: int | None = None,
           session_id: int | None = None) -> tuple[dict, bool]:
    """(course, created). The same GPX again returns the existing course."""
    g = G.parse(gpx)                                 # raises on unreadable XML
    if len(g["points"]) < 2:
        raise ValueError("no track or route points in the GPX")
    h = sha1(gpx)
    old = conn.execute("SELECT id FROM coll_courses WHERE gpx_sha1=? AND auto=0", (h,)).fetchone()
    if old:
        return get(conn, old["id"]), False
    cur = conn.execute("INSERT INTO coll_courses (name, goal_id, session_id, gpx, gpx_sha1) VALUES (?,?,?,?,?)",
                       ((name or g["name"] or "Course").strip()[:120], goal_id, session_id, gpx, h))
    conn.commit()
    return get(conn, cur.lastrowid), True


def _copy_twin(conn, cid: int, gpx_sha1: str) -> bool:
    """A course already built from the same GPX (a loop planned twice): reuse its pack."""
    t = conn.execute("SELECT pack, pack_sha1, pack_format, summary_json, turns_json, polyline, built_at FROM coll_courses "
                     "WHERE gpx_sha1=? AND status='ready' AND pack_format=? AND id!=? LIMIT 1",
                     (gpx_sha1, PACK_FORMAT, cid)).fetchone()
    if not t:
        return False
    conn.execute("""UPDATE coll_courses SET status='ready', error=NULL, pack=?, pack_sha1=?, pack_format=?, summary_json=?,
                        turns_json=?, polyline=?, built_at=? WHERE id=?""", (*tuple(t), cid))
    return True


def attach_session(conn: sqlite3.Connection, session_id: int, gpx: str, name: str | None = None) -> int | None:
    """A planned session got a GPX course (a tour day, a new route for it): give Coll the same course.
    Called inside the caller's transaction (no commit). Returns the course id, None if the GPX is unusable.
    The caller's request should end with kick_if_needed()."""
    try:
        g = G.parse(gpx)
    except Exception:
        return None
    if len(g["points"]) < 2:
        return None
    h = sha1(gpx)
    goal = conn.execute("SELECT goal_id FROM plan_sessions WHERE id=?", (session_id,)).fetchone()
    is_race = conn.execute("SELECT 1 FROM plan_sessions WHERE id=? AND lower(session_type)='race day'",
                           (session_id,)).fetchone() is not None
    name = (name or g["name"] or "Planned ride").strip()[:120]
    old = conn.execute("SELECT id, gpx_sha1 FROM coll_courses WHERE session_id=? AND auto=1", (session_id,)).fetchone()
    if old and old["gpx_sha1"] == h:
        return old["id"]
    if old:
        cid = old["id"]
        conn.execute("""UPDATE coll_courses SET name=?, gpx=?, gpx_sha1=?, status='pending', error=NULL, pack=NULL,
                            pack_sha1=NULL, summary_json=NULL, turns_json=NULL, polyline=NULL WHERE id=?""",
                     (name, gpx, h, cid))
    else:
        cid = conn.execute("INSERT INTO coll_courses (name, session_id, goal_id, gpx, gpx_sha1, auto) VALUES (?,?,?,?,?,1)",
                           (name, session_id, goal["goal_id"] if (goal and is_race) else None, gpx, h)).lastrowid
    _copy_twin(conn, cid, h)
    return cid


def detach_session(conn: sqlite3.Connection, session_id: int) -> None:
    """The session is gone (tour deleted): its course goes too. Uploads linked to it stay."""
    conn.execute("DELETE FROM coll_courses WHERE session_id=? AND auto=1", (session_id,))


def kick_if_needed(conn: sqlite3.Connection) -> None:
    if needs_build(conn):
        kick()


def list_courses(conn: sqlite3.Connection) -> list[dict]:
    return [_out(r) for r in conn.execute(f"SELECT {LIST_COLS} FROM coll_courses ORDER BY id DESC")]


def get(conn: sqlite3.Connection, cid: int) -> dict | None:
    r = conn.execute(f"SELECT {LIST_COLS}, turns_json, polyline FROM coll_courses WHERE id=?", (cid,)).fetchone()
    return _out(r, detail=True) if r else None


def pack(conn: sqlite3.Connection, cid: int) -> tuple[bytes, str] | None:
    r = conn.execute("SELECT pack, pack_sha1 FROM coll_courses WHERE id=? AND status='ready'", (cid,)).fetchone()
    return (bytes(r["pack"]), r["pack_sha1"]) if r and r["pack"] is not None else None


EDITABLE = ("name", "on_device", "goal_id", "session_id", "cutoffs", "fuel_plan")


def update(conn: sqlite3.Connection, cid: int, fields: dict) -> dict | None:
    sets = {k: v for k, v in fields.items() if k in EDITABLE}
    if "on_device" in sets:
        sets["on_device"] = 1 if sets["on_device"] else 0
    for k in ("cutoffs", "fuel_plan"):
        if k in sets:
            sets[k] = (sets[k] or "").strip() or None
    if sets:
        conn.execute(f"UPDATE coll_courses SET {', '.join(f'{k}=?' for k in sets)} WHERE id=?", (*sets.values(), cid))
        conn.commit()
    return get(conn, cid)


def rebuild(conn: sqlite3.Connection, cid: int) -> bool:
    n = conn.execute("UPDATE coll_courses SET status='pending', error=NULL WHERE id=? AND status!='building'",
                     (cid,)).rowcount
    conn.commit()
    return n > 0


def delete(conn: sqlite3.Connection, cid: int) -> bool:
    n = conn.execute("DELETE FROM coll_courses WHERE id=?", (cid,)).rowcount
    conn.commit()
    return n > 0


def device_courses(conn: sqlite3.Connection, today: date | None = None, default_fuel: str | None = None) -> list[dict]:
    """What Coll keeps on its flash: ready courses switched on — uploads and races always, planned
    sessions from yesterday to three weeks out — each with its own fuel plan and cut-offs."""
    from domains.coll import fuel
    today = today or date.today()
    lo, hi = (today - timedelta(days=DEVICE_DAYS_BEFORE)).isoformat(), (today + timedelta(days=DEVICE_DAYS_AHEAD)).isoformat()
    rows = conn.execute(
        """SELECT c.id, c.name, c.goal_id, c.session_id, c.auto, c.pack_sha1, c.summary_json, c.cutoffs, c.fuel_plan,
                  length(c.pack) AS bytes, g.name AS goal, g.race_date, p.session_date
           FROM coll_courses c LEFT JOIN race_goals g ON g.id = c.goal_id
                               LEFT JOIN plan_sessions p ON p.id = c.session_id
           WHERE c.status='ready' AND c.on_device=1
             AND NOT (c.auto=1 AND c.session_id IS NULL)
             AND (c.goal_id IS NULL OR g.race_date IS NULL OR g.race_date >= ?)
             AND (c.session_id IS NULL OR c.goal_id IS NOT NULL OR p.session_date BETWEEN ? AND ?)
           ORDER BY COALESCE(p.session_date, g.race_date, '9999'), c.id""", (lo, lo, hi)).fetchall()
    out = []
    for r in rows:
        s = json.loads(r["summary_json"] or "{}")
        f = fuel.for_course(conn, {**dict(r), "km": s.get("km")}, default_fuel)
        out.append({"id": r["id"], "name": r["name"], "km": s.get("km"), "pack_sha1": r["pack_sha1"],
                    "bytes": r["bytes"], "date": r["session_date"] or r["race_date"], "goal": r["goal"],
                    "race_date": r["race_date"], "cutoffs": r["cutoffs"],
                    "fuel_plan": f["fuel_plan"], "fuel_source": f["source"], "fuel_note": f["note"]})
    return out
