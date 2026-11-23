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
NOT_VEHICLE = {"walking", "running", "stationary"}
MAX_POINTS = 250                      # per leg, after thinning
RECENT_DAYS = 3
SCAN_DAYS = 45                        # untagged days read for drives you didn't tag
INBOX_DAYS = 30                       # untagged drives older than this aren't asked about
PICK_MATCH_MIN = 15


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


def legs_from_segments(segments: list[dict]) -> list[dict]:
    """tracks_for_date() output → vehicle legs: [{start, end, km, minutes, start_place, end_place, points}]."""
    keep = []
    for s in segments:
        if s.get("activity_type") or (s.get("motion") in NOT_VEHICLE):
            continue
        pts = [(c[1], c[0]) for c in s.get("coordinates") or []]
        if len(pts) < 2:
            continue
        km = path_km(pts)
        try:
            hours = max((_ts(s["segment_end"]) - _ts(s["segment_start"])).total_seconds(), 30) / 3600
        except (KeyError, ValueError, TypeError):
            continue
        if km < 0.2 or not (MIN_KMH <= km / hours <= MAX_KMH):
            continue
        keep.append({"start": s["segment_start"], "end": s["segment_end"], "km": km, "hours": hours,
                     "place": s.get("place_name") or s.get("city"), "points": pts})
    legs: list[dict] = []
    for s in sorted(keep, key=lambda x: x["start"]):
        if legs and (_ts(s["start"]) - _ts(legs[-1]["end"])).total_seconds() <= JOIN_GAP_MIN * 60:
            l = legs[-1]
            l.update(end=s["end"], km=l["km"] + s["km"], hours=l["hours"] + s["hours"],
                     end_place=s["place"] or l["end_place"], points=l["points"] + s["points"])
        else:
            legs.append({"start": s["start"], "end": s["end"], "km": s["km"], "hours": s["hours"],
                         "start_place": s["place"], "end_place": s["place"], "points": s["points"]})
    return [l for l in legs if l["km"] >= MIN_LEG_KM]


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
    try:
        legs = legs_from_segments(tracks_for_date(day))
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
    conn.execute("INSERT OR REPLACE INTO vehicle_scan (date, legs, scanned_at) VALUES (?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                 (day, len(legs)))
    return len(legs)


def _pick_for(picks: list[sqlite3.Row], start: str) -> int | None:
    t = _ts(start)
    best = None
    for p in picks:
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
    for p in conn.execute("SELECT date, start, vehicle_id FROM vehicle_leg_picks"):
        picks.setdefault(p["date"], []).append(p)
    live = {r[0] for r in conn.execute("SELECT id FROM vehicles")}
    for leg in conn.execute("SELECT date, start FROM vehicle_legs").fetchall():
        d = leg["date"]
        pick = _pick_for(picks.get(d, []), leg["start"])
        if pick == 0:
            vid, how = None, "not_mine"
        elif pick in live:
            vid, how = pick, "pick"
        else:
            owners = sorted({v for slug in tags.get(d, ()) for v in by_tag.get(slug, [])})
            vid, how = (owners[0], "tag") if len(owners) == 1 else (None, "both" if owners else "untagged")
        conn.execute("UPDATE vehicle_legs SET vehicle_id=?, how=? WHERE date=? AND start=?", (vid, how, d, leg["start"]))


def pick(conn: sqlite3.Connection, day: str, start: str, vehicle_id: int) -> None:
    """You say who drove a leg (0 = not mine). On an untagged day the vehicle's tag goes on the day."""
    conn.execute("INSERT OR REPLACE INTO vehicle_leg_picks (date, start, vehicle_id) VALUES (?,?,?)", (day, start, vehicle_id))
    if vehicle_id:
        v = conn.execute("SELECT day_tag FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
        by_tag = _vehicle_tags(conn)
        on_day = day_tags(set(by_tag), since=day).get(day, set())
        if v and v["day_tag"] and not on_day:
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
    done = {r[0] for r in conn.execute("SELECT date FROM vehicle_scan")}
    n = 0
    for d in sorted(wanted):
        if everything or d not in done or d >= recent:
            scan_day(conn, d)
            n += 1
    assign(conn)
    conn.commit()
    return n


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
