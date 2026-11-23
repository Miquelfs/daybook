"""
Where each vehicle went, from the GPS.

1. Legs. A day's Overland track segments that move at vehicle speed and aren't a Garmin activity
   are joined into legs (a few minutes apart = one leg) and cached in money.db → vehicle_legs.
   Read: every day carrying a vehicle's day tag (all history), and every day of the last
   SCAN_DAYS whatever its tags — so a ride you forgot to tag still shows up. The last few days are
   read again (Overland uploads late).
2. Who drove it (cheap, redone on every refresh):
     your pick (vehicle_leg_picks; 0 = not mine)          → 'pick' / 'not_mine'
     else exactly one vehicle's tag on the day             → 'tag'
     else two vehicles' tags (Scooter ride + Car drive)    → 'both'      — waits for your pick
     else no tag                                           → 'untagged'  — waits for your pick
   Picking a vehicle for a leg on an untagged day also puts its tag on the day (tags stay the
   source of truth for "what I did that day").

    python -m domains.vehicles.routes [--all]
"""

from __future__ import annotations

import json
import logging
import math
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger(__name__)
DAYBOOK_DB = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"
MIN_KMH, MAX_KMH = 12.0, 150.0        # slower is walking/traffic noise, faster is a train or a plane
MIN_LEG_KM = 0.4
JOIN_GAP_MIN = 12                     # segments this close are one leg (a red light, a GPS pause)
ON_FOOT = {"walking", "running"}            # both ends of a step say so → not a drive (speed rules out the rest)
MAX_POINTS = 250                      # per leg, after thinning
RECENT_DAYS = 3
SCAN_DAYS = 45                        # untagged days read for drives you didn't tag
INBOX_DAYS = 30                       # untagged drives older than this aren't asked about
PICK_MATCH_MIN = 15
READER = 2                            # bump when legs_from_segments changes: every day is read again


def _km(a, b) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dla, dlo = la2 - la1, math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _ts(s: str) -> datetime:
    """Always timezone-aware (a time without an offset is UTC), so any two can be subtracted."""
    t = datetime.fromisoformat(str(s).strip().replace(" ", "T").replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def path_km(pts: list[tuple[float, float]]) -> float:
    return sum(_km(a, b) for a, b in zip(pts, pts[1:]) if _km(a, b) < 5)   # a 5 km hop between pings is a jump


def _overlaps(a0: str, a1: str, b0: str, b1: str) -> bool:
    """Closed time windows [a0, a1] and [b0, b1] share a moment."""
    try:
        return _ts(a0) <= _ts(b1) and _ts(b0) <= _ts(a1)
    except (ValueError, TypeError):
        return False


def _points(segments: list[dict]) -> list[dict]:
    """Every GPS point of the day in order, with a time and what its segment says.

    Overland stores a drive as a run of one-point segments (each moving ping is its own), and a
    stop as one segment of many jittery points — so a drive only shows up between consecutive
    points, the way the day map draws it. Points inside one segment get times spread evenly
    from its start to its end."""
    out = []
    for s in segments:
        coords = s.get("coordinates") or []
        try:
            t0, t1 = _ts(s["segment_start"]), _ts(s["segment_end"])
        except (KeyError, ValueError, TypeError):
            continue
        n = len(coords)
        for i, c in enumerate(coords):
            out.append({"t": t0 + (t1 - t0) * (i / (n - 1) if n > 1 else 0), "pt": (c[1], c[0]),
                        "iso": s["segment_start"] if i == 0 else s["segment_end"],
                        "exercise": bool(s.get("activity_type")), "motion": s.get("motion"),
                        "place": s.get("place_name") or s.get("city")})
    out.sort(key=lambda p: p["t"])
    return out


def legs_from_segments(segments: list[dict], forced: list[tuple[str, str]] = ()) -> list[dict]:
    """tracks_for_date() output → vehicle legs: [{start, end, km, hours, start_place, end_place, points}].

    A step between two consecutive points is a drive at vehicle speed, unless a logged workout
    covers it or both ends say walking/running. `forced`: windows you picked a vehicle for on
    the day map — a step touching one is a drive whatever the speed / motion said (a slow scooter
    ride the phone took for walking). Drive steps less than JOIN_GAP_MIN apart are one leg."""
    win = [(_ts(a), _ts(b)) for a, b in forced]
    pts = _points(segments)
    legs: list[dict] = []
    for p, q in zip(pts, pts[1:]):
        secs = (q["t"] - p["t"]).total_seconds()
        km = _km(p["pt"], q["pt"])
        force = any(p["t"] <= b and a <= q["t"] for a, b in win) and km > 0
        if not force:
            if secs <= 0 or p["exercise"] or q["exercise"]:
                continue
            if p["motion"] in ON_FOOT and q["motion"] in ON_FOOT:
                continue
            if not (MIN_KMH <= km / (secs / 3600) <= MAX_KMH):
                continue
        hours = max(secs, 0) / 3600
        if legs and (p["t"] - legs[-1]["_end"]).total_seconds() <= JOIN_GAP_MIN * 60:
            l = legs[-1]
            if l["points"][-1] != p["pt"]:
                l["points"].append(p["pt"])
            l["points"].append(q["pt"])
            l.update(end=q["iso"], _end=q["t"], km=l["km"] + km, hours=l["hours"] + hours,
                     end_place=q["place"] or l["end_place"], forced=l["forced"] or force)
        else:
            legs.append({"start": p["iso"], "end": q["iso"], "_end": q["t"], "km": km, "hours": hours, "forced": force,
                         "start_place": p["place"], "end_place": q["place"], "points": [p["pt"], q["pt"]]})
    for l in legs:
        l.pop("_end")
    return [l for l in legs if l["km"] >= MIN_LEG_KM or l["forced"]]


def _thin(points: list[tuple[float, float]]) -> list[list[float]]:
    step = max(1, math.ceil(len(points) / MAX_POINTS))
    kept = points[::step] + ([points[-1]] if (len(points) - 1) % step else [])
    return [[round(a, 5), round(b, 5)] for a, b in kept]


def _daybook():
    con = sqlite3.connect(DAYBOOK_DB)
    con.row_factory = sqlite3.Row
    return con


def day_tags(slugs: set[str], since: str | None = None) -> dict[str, set[str]]:
    """date → the vehicle tag slugs on it."""
    if not slugs or not DAYBOOK_DB.exists():
        return {}
    con = _daybook()
    try:
        q = ",".join("?" * len(slugs))
        rows = con.execute(
            f"SELECT dt.date, t.slug FROM day_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.slug IN ({q})"
            + (" AND dt.date >= ?" if since else ""), [*slugs, *([since] if since else [])]).fetchall()
    except sqlite3.OperationalError:
        return {}
    finally:
        con.close()
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(r["date"], set()).add(r["slug"])
    return out


def add_day_tag(day: str, slug: str) -> None:
    if not DAYBOOK_DB.exists():
        return
    con = _daybook()
    try:
        t = con.execute("SELECT id FROM tags WHERE slug=?", (slug,)).fetchone()
        if t:
            con.execute("INSERT OR IGNORE INTO day_tags (date, tag_id) VALUES (?,?)", (day, t["id"]))
            con.commit()
    except sqlite3.OperationalError:
        pass
    finally:
        con.close()


def _vehicle_tags(conn: sqlite3.Connection) -> dict[str, list[int]]:
    """tag slug → vehicles using it (only ones not sold)."""
    out: dict[str, list[int]] = {}
    for vid, tag in conn.execute("SELECT id, day_tag FROM vehicles WHERE day_tag IS NOT NULL AND day_tag != ''"):
        out.setdefault(tag, []).append(vid)
    return out


def scan_day(conn: sqlite3.Connection, day: str) -> int:
    """Read one day's GPS into vehicle_legs (keeps the assignment columns for assign())."""
    from domains.locations.locations_query import tracks_for_date
    forced = [(p["start"], p["end"]) for p in conn.execute(
        "SELECT start, end FROM vehicle_leg_picks WHERE date=? AND vehicle_id != 0 AND end IS NOT NULL", (day,))]
    try:
        legs = legs_from_segments(tracks_for_date(day), forced)
    except sqlite3.OperationalError:
        legs = []
    except Exception:                                   # one odd day never stops the others
        log.exception("vehicle legs: couldn't read %s", day)
        return 0
    conn.execute("DELETE FROM vehicle_legs WHERE date=?", (day,))
    for l in legs:
        conn.execute(
            """INSERT OR REPLACE INTO vehicle_legs (date, start, end, km, minutes, start_place, end_place, route)
               VALUES (?,?,?,?,?,?,?,?)""",
            (day, l["start"], l["end"], round(l["km"], 2), round(l["hours"] * 60, 1), l["start_place"], l["end_place"],
             json.dumps(_thin(l["points"]))))
    conn.execute("INSERT OR REPLACE INTO vehicle_scan (date, legs, reader, scanned_at) "
                 "VALUES (?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))", (day, len(legs), READER))
    return len(legs)


def _pick_for(picks: list[sqlite3.Row], start: str, end: str | None = None) -> int | None:
    """Your pick for a leg: one made on the day map whose stretch touches it (the latest wins),
    else one from the inbox that started within PICK_MATCH_MIN of it."""
    for p in reversed(picks):
        if p["end"] and end and _overlaps(p["start"], p["end"], start, end):
            return p["vehicle_id"]
    t = _ts(start)
    best = None
    for p in picks:
        if p["end"]:
            continue
        try:
            gap = abs((_ts(p["start"]) - t).total_seconds())
        except (ValueError, TypeError):
            continue
        if gap <= PICK_MATCH_MIN * 60 and (best is None or gap < best[0]):
            best = (gap, p["vehicle_id"])
    return best[1] if best else None


def assign(conn: sqlite3.Connection) -> None:
    """Decide who drove every cached leg (picks, then tags)."""
    by_tag = _vehicle_tags(conn)
    tags = day_tags(set(by_tag))
    picks: dict[str, list] = {}
    for p in conn.execute("SELECT date, start, end, vehicle_id FROM vehicle_leg_picks ORDER BY rowid"):
        picks.setdefault(p["date"], []).append(p)
    live = {r[0] for r in conn.execute("SELECT id FROM vehicles")}
    for leg in conn.execute("SELECT date, start, end FROM vehicle_legs").fetchall():
        d = leg["date"]
        pick = _pick_for(picks.get(d, []), leg["start"], leg["end"])
        if pick == 0:
            vid, how = None, "not_mine"
        elif pick in live:
            vid, how = pick, "pick"
        else:
            owners = sorted({v for slug in tags.get(d, ()) for v in by_tag.get(slug, [])})
            vid, how = (owners[0], "tag") if len(owners) == 1 else (None, "both" if owners else "untagged")
        conn.execute("UPDATE vehicle_legs SET vehicle_id=?, how=? WHERE date=? AND start=?", (vid, how, d, leg["start"]))


def pick(conn: sqlite3.Connection, day: str, start: str, vehicle_id: int, end: str | None = None) -> None:
    """You say who drove a leg (0 = not mine). The vehicle's day tag goes on the day (Scooter ride / Car drive).

    With `end` (picked on the day map) it's a stretch of time: whichever drive touches it is this
    vehicle's — and if the GPS read none there (too slow, taken for walking), it becomes one."""
    if end:
        # an earlier pick on the same stretch is replaced, not outvoted
        touching = [l for l in conn.execute("SELECT start, end FROM vehicle_legs WHERE date=?", (day,))
                    if _overlaps(l["start"], l["end"], start, end)]
        for p in conn.execute("SELECT start, end FROM vehicle_leg_picks WHERE date=?", (day,)).fetchall():
            p_end = p["end"] or p["start"]
            if _overlaps(p["start"], p_end, start, end) or any(
                    _overlaps(l["start"], l["end"], p["start"], p_end) for l in touching):
                conn.execute("DELETE FROM vehicle_leg_picks WHERE date=? AND start=?", (day, p["start"]))
        conn.execute("INSERT OR REPLACE INTO vehicle_leg_picks (date, start, end, vehicle_id) VALUES (?,?,?,?)",
                     (day, start, end, vehicle_id))
        if vehicle_id:
            scan_day(conn, day)                  # the stretch may not have been a drive by speed alone
    else:
        conn.execute("INSERT OR REPLACE INTO vehicle_leg_picks (date, start, vehicle_id) VALUES (?,?,?)", (day, start, vehicle_id))
    if vehicle_id:                               # you rode it that day → its tag goes on the day
        v = conn.execute("SELECT day_tag FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
        if v and v["day_tag"]:
            add_day_tag(day, v["day_tag"])
    assign(conn)
    conn.commit()


def refresh_in_background() -> None:
    """For API calls that change what's assigned (a new vehicle, a new day tag): own connection,
    never raises — the request already answered."""
    from infrastructure.db.money_connection import get_money_connection
    conn = get_money_connection()
    try:
        refresh(conn)
    except Exception:
        log.exception("vehicle routes refresh failed")
    finally:
        conn.close()


def refresh(conn: sqlite3.Connection, everything: bool = False) -> int:
    """Read tagged days not read yet, every recent day, the last few again; then assign. Returns days read."""
    if not conn.execute("SELECT 1 FROM vehicles LIMIT 1").fetchone():
        return 0
    by_tag = _vehicle_tags(conn)
    today = date.today()
    recent = (today - timedelta(days=RECENT_DAYS)).isoformat()
    window = [(today - timedelta(days=i)).isoformat() for i in range(SCAN_DAYS + 1)]
    wanted = set(day_tags(set(by_tag))) | set(window)
    done = {r[0] for r in conn.execute("SELECT date FROM vehicle_scan WHERE reader >= ?", (READER,))}
    n = 0
    for d in sorted(wanted):
        if everything or d not in done or d >= recent:
            scan_day(conn, d)
            n += 1
    assign(conn)
    conn.commit()
    return n


def on_day(conn: sqlite3.Connection, day: str) -> dict:
    """The day map's view: your vehicles, and who drove each of that day's drives."""
    if not conn.execute("SELECT 1 FROM vehicle_scan WHERE date=? AND reader >= ?", (day, READER)).fetchone() and \
            conn.execute("SELECT 1 FROM vehicles LIMIT 1").fetchone():
        scan_day(conn, day)
        assign(conn)
        conn.commit()
    vehicles = [dict(r) for r in conn.execute(
        "SELECT id, name, kind FROM vehicles WHERE sold_on IS NULL OR sold_on >= ? ORDER BY id", (day,))]
    legs = [dict(r) for r in conn.execute(
        "SELECT start, end, km, vehicle_id, how FROM vehicle_legs WHERE date=? ORDER BY start", (day,))]
    return {"vehicles": vehicles, "legs": legs}


def inbox(conn: sqlite3.Connection, limit: int = 60) -> list[dict]:
    """Legs waiting for your pick: both tags on the day (any date), or no tag (last INBOX_DAYS)."""
    since = (date.today() - timedelta(days=INBOX_DAYS)).isoformat()
    rows = conn.execute(
        """SELECT date, start, end, km, minutes, start_place, end_place, how FROM vehicle_legs
           WHERE vehicle_id IS NULL AND (how='both' OR (how='untagged' AND date >= ?))
           ORDER BY date DESC, start DESC LIMIT ?""", (since, limit)).fetchall()
    return [dict(r) for r in rows]


def main() -> None:
    from infrastructure.db.money_connection import get_money_connection
    conn = get_money_connection()
    try:
        n = refresh(conn, everything="--all" in sys.argv)
    finally:
        conn.close()
    print(f"vehicle_routes: {n} day(s) read")


if __name__ == "__main__":
    main()
