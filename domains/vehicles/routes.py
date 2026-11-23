"""
Where each vehicle went, from the GPS.

A day tagged with the vehicle's day tag (Scooter ride → `motorcycle`, Car drive → `car_drive`)
is read from Overland: the track segments that move at vehicle speed and aren't a Garmin
activity are that vehicle's legs (segments a few minutes apart are joined into one leg).
The result is cached per vehicle per day in money.db → vehicle_days; the nightly step fills
new tagged days and recomputes the last few (Overland uploads late).

    python -m domains.vehicles.routes [--all]
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

DAYBOOK_DB = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"
MIN_KMH, MAX_KMH = 12.0, 150.0        # slower is walking/traffic noise, faster is a train or a plane
MIN_LEG_KM = 0.4
JOIN_GAP_MIN = 12                     # segments this close are one leg (a red light, a GPS pause)
NOT_VEHICLE = {"walking", "running", "stationary"}
MAX_POINTS = 400                      # per day, after thinning
RECENT_DAYS = 3


def _km(a, b) -> float:
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dla, dlo = la2 - la1, math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


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


def _thin(legs: list[dict]) -> list[list[list[float]]]:
    total = sum(len(l["points"]) for l in legs)
    step = max(1, math.ceil(total / MAX_POINTS))
    out = []
    for l in legs:
        p = l["points"]
        kept = p[::step] + ([p[-1]] if (len(p) - 1) % step else [])
        out.append([[round(a, 5), round(b, 5)] for a, b in kept])
    return out


def tagged_days(tag: str) -> list[str]:
    if not tag or not DAYBOOK_DB.exists():
        return []
    con = sqlite3.connect(DAYBOOK_DB)
    try:
        return [r[0] for r in con.execute(
            "SELECT dt.date FROM day_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.slug = ? ORDER BY dt.date", (tag,))]
    except sqlite3.OperationalError:
        return []
    finally:
        con.close()


def compute_day(conn: sqlite3.Connection, vehicle_id: int, day: str) -> dict:
    from domains.locations.locations_query import tracks_for_date
    try:
        legs = legs_from_segments(tracks_for_date(day))
    except sqlite3.OperationalError:
        legs = []
    row = {
        "km": round(sum(l["km"] for l in legs), 1),
        "minutes": round(sum(l["hours"] for l in legs) * 60),
        "legs": len(legs),
        "start_place": legs[0]["start_place"] if legs else None,
        "end_place": legs[-1]["end_place"] if legs else None,
        "route": json.dumps(_thin(legs)) if legs else None,
    }
    conn.execute(
        """INSERT INTO vehicle_days (vehicle_id, date, km, minutes, legs, start_place, end_place, route, computed_at)
           VALUES (?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
           ON CONFLICT(vehicle_id, date) DO UPDATE SET km=excluded.km, minutes=excluded.minutes, legs=excluded.legs,
             start_place=excluded.start_place, end_place=excluded.end_place, route=excluded.route,
             computed_at=excluded.computed_at""",
        (vehicle_id, day, row["km"], row["minutes"], row["legs"], row["start_place"], row["end_place"], row["route"]),
    )
    return row


def refresh(conn: sqlite3.Connection, vehicle_id: int | None = None, everything: bool = False) -> int:
    """Fill vehicle_days for tagged days not done yet (and the last few days again). Returns days computed."""
    q = "SELECT id, day_tag FROM vehicles WHERE day_tag IS NOT NULL AND day_tag != ''"
    vehicles = conn.execute(q + (" AND id = ?" if vehicle_id else ""), ((vehicle_id,) if vehicle_id else ())).fetchall()
    recent = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    n = 0
    for vid, tag in vehicles:
        days = tagged_days(tag)
        done = {r[0] for r in conn.execute("SELECT date FROM vehicle_days WHERE vehicle_id=?", (vid,))}
        # a tag you removed takes its day with it
        gone = done - set(days)
        for d in gone:
            conn.execute("DELETE FROM vehicle_days WHERE vehicle_id=? AND date=?", (vid, d))
        for d in days:
            if everything or d not in done or d >= recent:
                compute_day(conn, vid, d)
                n += 1
    conn.commit()
    return n


def main() -> None:
    from infrastructure.db.money_connection import get_money_connection
    conn = get_money_connection()
    try:
        n = refresh(conn, everything="--all" in sys.argv)
    finally:
        conn.close()
    print(f"vehicle_routes: {n} day(s) computed")


if __name__ == "__main__":
    main()
