"""
A ride's elevation profile with what it went past, placed along the distance — the
same stage-sheet strip the planned tour days have, for rides that happened.

  profile   [km, m] every 250–500 m, from the recorded track (streams)
  markers   cols, named climbs (start → top) and villages, each at the km where the
            track came closest; first visits flagged

Only rides with GPS + elevation streams get one. Nothing is stored: it's built from
the streams and the cols / climbs / villages already matched to the activity.
"""

from __future__ import annotations

import sqlite3

from domains.health.geo import dist_m

STEP_M = 100
NEAR = {"col": 400, "climb": 600, "village": 400}       # metres from the track to count as "on it"


def _km_at(track: list[tuple[float, float, float]], p: tuple[float, float], near_m: float) -> float | None:
    """km along the track where it passes closest to p, if within near_m."""
    best, at = near_m, None
    for i, q in enumerate(track):
        d = dist_m(q[:2], p)
        if d < best:
            best, at = d, i
    return round(at * STEP_M / 1000, 1) if at is not None else None


def profile(conn: sqlite3.Connection, activity_id: str) -> dict | None:
    from domains.locations.climbs import resample, ride_points
    try:
        pts = ride_points(conn, activity_id)
    except sqlite3.OperationalError:
        return None
    if len(pts) < 20:
        return None
    track = [p[:3] for p in resample(pts, STEP_M)]
    km = (len(track) - 1) * STEP_M / 1000
    every = 5 if km > 30 else 2 if km > 8 else 1                 # profile point every 500 / 200 / 100 m
    prof = [[round(i * STEP_M / 1000, 1), round(track[i][2])] for i in range(0, len(track), every)]
    if prof[-1][0] < round(km, 1):
        prof.append([round(km, 1), round(track[-1][2])])

    markers: list[dict] = []
    try:
        from domains.locations.cols import for_activity as cols_for
        coords = {r["osm_id"]: (r["lat"], r["lng"]) for r in conn.execute(
            "SELECT c.osm_id, c.lat, c.lng FROM col_visits v JOIN cols c ON c.osm_id = v.osm_id WHERE v.activity_id=?",
            (activity_id,))}
        for c in cols_for(conn, activity_id):
            at = _km_at(track, coords[c["osm_id"]], NEAR["col"]) if c["osm_id"] in coords else None
            if at is not None:
                markers.append({"kind": "col", "km": at, "name": c["name"], "ele": c["ele"], "first": c["first_time"]})
    except (sqlite3.OperationalError, KeyError):
        pass
    try:
        from domains.locations.climbs import for_activity as climbs_for
        coords = {r["key"]: (r["lat"], r["lng"]) for r in conn.execute(
            "SELECT c.key, c.lat, c.lng FROM climb_visits v JOIN climbs c ON c.key = v.climb_key WHERE v.activity_id=?",
            (activity_id,))}
        for c in climbs_for(conn, activity_id):
            top = _km_at(track, coords[c["key"]], NEAR["climb"]) if c["key"] in coords else None
            if top is not None:
                markers.append({"kind": "climb", "km": top, "from_km": round(max(0.0, top - (c["length_km"] or 0)), 1),
                                "name": c["name"], "ele": c["top_ele"], "first": c["first_time"],
                                "gain_m": c["gain_m"], "avg_pct": c["avg_pct"], "length_km": c["length_km"]})
    except (sqlite3.OperationalError, KeyError):
        pass
    try:
        from domains.locations import ride_explore
        from domains.locations.mallorca.coverage import reference
        story = ride_explore.get(conn, activity_id) or {}
        if story.get("villages"):
            where = {name: (lat, lng) for name, lat, lng, _place, _muni in reference()["villages"]}
            for v in story["villages"]:
                at = _km_at(track, where[v["name"]], NEAR["village"]) if v["name"] in where else None
                if at is not None:
                    markers.append({"kind": "village", "km": at, "name": v["name"], "ele": None, "first": v["new"]})
    except Exception:                               # reference data missing / not a Mallorca ride
        pass
    # a climb that tops out at a col shows once: the col, carrying the climb's numbers
    for col in [m for m in markers if m["kind"] == "col"]:
        climb = next((m for m in markers if m["kind"] == "climb" and abs(m["km"] - col["km"]) < 0.5), None)
        if climb:
            col.update({k: climb[k] for k in ("from_km", "gain_m", "avg_pct", "length_km")})
            markers.remove(climb)
    markers.sort(key=lambda m: m["km"])
    return {"km": round(km, 1), "profile": prof, "markers": markers}
