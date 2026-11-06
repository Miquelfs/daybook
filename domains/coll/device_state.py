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
