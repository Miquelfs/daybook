"""
Passing through vs being somewhere.

Overland pings often, and every moving ping becomes its own one-point track segment, which used to be
reverse-geocoded like a stop. So a drive on the motorway at 120 km/h left a trail of "places"
(and first visits) you never set foot in. A segment is *passing* when you were moving through it:

  - it lasted less than DWELL_MIN_MINUTES (a stop is a few minutes in one spot), and
  - you arrived faster than walking pace and left faster than walking pace (a single ping at a
    restaurant is still a place: you leave it slowly, or an hour later), and
  - it isn't at one of your homes.

tracks.passing stores it (NULL = not worked out yet; backfill() fills old days in the background).
Passing segments still draw the route; they are not places, first visits, top places or markers.
New ones are not geocoded either, except a city-level look every CITY_EVERY_KM so a drive through
another city or country still counts as being there.

thin_fast() drops most pings of a fast stretch before they become segments: at vehicle speed a
ping is kept only after FAST_KEEP_S seconds, FAST_KEEP_M metres, or a turn — enough to draw the road.
"""

from __future__ import annotations

import json
import logging
import math
import sqlite3
from datetime import datetime

log = logging.getLogger(__name__)

DWELL_MIN_MINUTES = 3
WALK_MS = 2.0                 # m/s — faster than this both ways = moving through
FAST_MS = 8.0                 # ~29 km/h: a car, a scooter, a train (walking and most cycling stay whole)
FAST_KEEP_S = 60
FAST_KEEP_M = 1000
FAST_TURN_DEG = 25
CITY_EVERY_KM = 5


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "+00:00").replace(" ", "T"))


def _m(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dla, dlo = la2 - la1, math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dlo = math.radians(b[1] - a[1])
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return math.degrees(math.atan2(y, x)) % 360


def _speed(p_time, p_pt, q_time, q_pt) -> float | None:
    secs = (q_time - p_time).total_seconds()
    return _m(p_pt, q_pt) / secs if secs > 0 else None


def flags(segs: list[dict], homes=()) -> list[bool]:
    """segs: [{start, end, points: [(lat, lng)]}] in time order → passing per segment."""
    out = []
    for i, s in enumerate(segs):
        if not s["points"]:
            out.append(False)
            continue
        try:
            t0, t1 = _ts(s["start"]), _ts(s["end"])
        except (TypeError, ValueError):
            out.append(False)
            continue
        if (t1 - t0).total_seconds() >= DWELL_MIN_MINUTES * 60:
            out.append(False)
            continue
        first, last = s["points"][0], s["points"][-1]
        if any(_m(first, (hl, hg)) <= r * 1000 for _, hl, hg, r in homes):
            out.append(False)
            continue

        def side(j, mine_t, mine_pt, theirs_first: bool):
            if not (0 <= j < len(segs)) or not segs[j]["points"]:
                return None
            o = segs[j]
            try:
                ot = _ts(o["start"] if theirs_first else o["end"])
            except (TypeError, ValueError):
                return None
            opt = o["points"][0] if theirs_first else o["points"][-1]
            return _speed(ot, opt, mine_t, mine_pt) if not theirs_first else _speed(mine_t, mine_pt, ot, opt)

        v_in = side(i - 1, t0, first, theirs_first=False)
        v_out = side(i + 1, t1, last, theirs_first=True)
        # the first / last ping of the day only needs the side it has
        fast_in = v_in is None or v_in > WALK_MS
        fast_out = v_out is None or v_out > WALK_MS
        out.append(fast_in and fast_out and (v_in is not None or v_out is not None))
    return out


def ensure_column(con: sqlite3.Connection) -> None:
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(tracks)")}
    except sqlite3.OperationalError:
        return
    if cols and "passing" not in cols:
        con.execute("ALTER TABLE tracks ADD COLUMN passing INTEGER")
        con.commit()


def _homes():
    try:
        from domains.locations.locations_query import _home_places
        return _home_places()
    except Exception:
        return ()


def mark_day(con: sqlite3.Connection, date: str) -> int:
    """Work out passing for one day's segments. Returns how many are passing."""
    rows = con.execute("SELECT id, segment_start, segment_end, points_json FROM tracks WHERE date=? ORDER BY segment_start",
                       (date,)).fetchall()
    segs = []
    for r in rows:
        try:
            pts = [(p["lat"], p["lng"]) for p in json.loads(r["points_json"] or "[]") if "lat" in p]
        except (ValueError, TypeError):
            pts = []
        segs.append({"start": r["segment_start"], "end": r["segment_end"], "points": pts})
    f = flags(segs, _homes())
    con.executemany("UPDATE tracks SET passing=? WHERE id=?", [(int(x), r["id"]) for x, r in zip(f, rows)])
    con.commit()
    return sum(f)


def backfill(con: sqlite3.Connection) -> int:
    """Every day with segments not worked out yet. Returns days done."""
    ensure_column(con)
    days = [r[0] for r in con.execute("SELECT DISTINCT date FROM tracks WHERE passing IS NULL AND date IS NOT NULL")]
    for d in days:
        mark_day(con, d)
    return len(days)


def backfill_in_background() -> None:
    from domains.locations.overland_process import _conn
    con = _conn()
    try:
        n = backfill(con)
        if n:
            log.info("passing: worked out %d days", n)
    except Exception:
        log.exception("passing backfill failed")
    finally:
        con.close()


def thin_fast(points: list[dict]) -> list[dict]:
    """Overland points (recorded_at, lat, lng) in order → the same, with most pings of fast stretches
    dropped: a ping going faster than FAST_MS from the last kept one is kept only after FAST_KEEP_S,
    FAST_KEEP_M, or a turn of FAST_TURN_DEG; the last ping before slowing down is always kept."""
    if len(points) < 3:
        return points
    t = lambda p: _ts(p["recorded_at"])
    pt = lambda p: (p["lat"], p["lng"])
    kept = [points[0]]
    for i in range(1, len(points) - 1):
        p, prev, nxt = points[i], points[i - 1], points[i + 1]
        v_in = _speed(t(prev), pt(prev), t(p), pt(p))
        v_out = _speed(t(p), pt(p), t(nxt), pt(nxt))
        if not (v_in and v_out and v_in >= FAST_MS and v_out >= FAST_MS):
            kept.append(p)                              # slow, stopping, or the edge of a fast stretch
            continue
        k = kept[-1]
        if (t(p) - t(k)).total_seconds() >= FAST_KEEP_S or _m(pt(k), pt(p)) >= FAST_KEEP_M:
            kept.append(p)
            continue
        if _m(pt(k), pt(p)) > 30 and _m(pt(p), pt(nxt)) > 30:       # the road bends here: keep the corner
            turn = abs((_bearing(pt(p), pt(nxt)) - _bearing(pt(k), pt(p)) + 180) % 360 - 180)
            if turn >= FAST_TURN_DEG:
                kept.append(p)
    kept.append(points[-1])
    return kept
