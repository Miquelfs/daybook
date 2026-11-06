"""
What Coll says it holds. At the end of every sync Coll reports the packs on its flash (id + sha1),
its firmware, free space, battery and rides still waiting to upload (POST /coll/device). Daybook
then knows a route is really on Coll — not just offered to it — and the Coll tab can show each
route's path: imported → converted for Coll → on Coll → ridden.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone


def report(conn: sqlite3.Connection, body: dict) -> dict:
    have = []
    for h in body.get("have") or []:
        try:
            have.append({"id": int(h["id"]), "pack_sha1": str(h["pack_sha1"])})
        except (KeyError, TypeError, ValueError):
            raise ValueError("have: a list of {id, pack_sha1}")
    num = lambda k: int(body[k]) if body.get(k) is not None else None   # noqa: E731
    conn.execute(
        """INSERT INTO coll_device (id, seen_at, firmware, free_kb, battery_pct, rides_waiting, have_json)
           VALUES (1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at, firmware=excluded.firmware,
             free_kb=excluded.free_kb, battery_pct=excluded.battery_pct, rides_waiting=excluded.rides_waiting,
             have_json=excluded.have_json""",
        (datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), (body.get("firmware") or None),
         num("free_kb"), num("battery_pct"), num("rides_waiting"), json.dumps(have)))
    conn.commit()
    return state(conn)


def state(conn: sqlite3.Connection) -> dict | None:
    try:
        r = conn.execute("SELECT * FROM coll_device WHERE id=1").fetchone()
    except sqlite3.OperationalError:
        return None
    if r is None:
        return None
    d = dict(r)
    d.pop("id")
    d["have"] = json.loads(d.pop("have_json") or "[]")
    return d


def steps(conn: sqlite3.Connection, course: dict, listed: set[int], dev: dict | None) -> dict:
    """The route's path, for the Coll tab.
    on_coll: 'yes' (Coll reported this exact pack) · 'next sync' (offered, Coll hasn't taken it yet) ·
             'old version' (Coll has an earlier build) · 'no' (off, or outside the three-week window)."""
    have = {h["id"]: h["pack_sha1"] for h in (dev or {}).get("have", [])}
    cid = course["id"]
    if cid in have and have[cid] == course.get("pack_sha1"):
        on = "yes"
    elif cid in listed:
        on = "old version" if cid in have else "next sync"
    else:
        on = "no"
    rides = [dict(r) for r in conn.execute(
        """SELECT r.id, r.activity_id, r.status, a.date AS date FROM coll_rides r
           LEFT JOIN activities a ON a.id = r.activity_id WHERE r.course_id=? ORDER BY r.start_utc DESC""", (cid,))]
    return {"on_coll": on, "rides": rides}


# ── the sync log: every device request, for debugging the first weeks with the hardware ─────

LOG_KEEP = 1000
SESSION_GAP_S = 600                 # requests further apart than this are separate syncs


def log(conn: sqlite3.Connection, kind: str, status: int, detail: str | None = None, nbytes: int | None = None) -> None:
    try:
        conn.execute("INSERT INTO coll_sync_log (kind, status, detail, bytes) VALUES (?,?,?,?)",
                     (kind, int(status), (detail or None) and str(detail)[:300], nbytes))
        conn.execute("DELETE FROM coll_sync_log WHERE id <= (SELECT MAX(id) FROM coll_sync_log) - ?", (LOG_KEEP,))
        conn.commit()
    except sqlite3.Error:
        pass                         # the log never breaks a sync


def history(conn: sqlite3.Connection, limit: int = 300) -> list[dict]:
    """The log grouped into syncs, newest first: each a run of requests around one /coll/sync
    (a refused token just before it belongs to it; one after a finished sync starts the next)."""
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM coll_sync_log ORDER BY id DESC LIMIT ?", (limit,))]
    except sqlite3.OperationalError:
        return []
    rows.reverse()
    out: list[dict] = []
    ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()   # noqa: E731
    for r in rows:
        cur = out[-1] if out else None
        has_sync = cur is not None and any(x["kind"] == "sync" for x in cur["steps"])
        if cur is None or ts(r["at"]) - ts(cur["ended"]) > SESSION_GAP_S or (r["kind"] in ("sync", "auth") and has_sync):
            cur = {"started": r["at"], "ended": r["at"], "steps": [], "errors": 0, "down_bytes": 0, "up_bytes": 0}
            out.append(cur)
        cur["ended"] = r["at"]
        cur["steps"].append({k: r[k] for k in ("at", "kind", "status", "detail", "bytes")})
        if r["status"] >= 400:
            cur["errors"] += 1
        if r["bytes"]:
            cur["up_bytes" if r["kind"] == "ride" else "down_bytes"] += r["bytes"]
    out.reverse()
    return out
