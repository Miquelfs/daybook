"""
Mallorca road coverage: which bikeable roads and villages your rides have touched.

Reference roads/villages come from osm_mallorca.json.gz (see build_osm). Every
outdoor ride inside the island's box is resampled every 20 m (full GPS streams
when synced, else the summary polyline) into a 25 m grid. A road piece (~500 m)
is sampled every 50 m; a sample counts as ridden when a track point sits within
~25–50 m. A piece is "ridden" when ≥ 60 % of it is. Villages count as visited
when a track passes within ~400 m of the village node.

The result is cached in `mallorca_coverage` keyed by the set of rides, so it is
recomputed only after a new ride.
"""

from __future__ import annotations

import gzip
import json
import sqlite3
from functools import lru_cache
from pathlib import Path

from domains.health.activity_analysis import is_indoor, sport_of
from domains.health.geo import Grid, activity_track, decode, dist_m, encode, sample

REF = Path(__file__).with_name("osm_mallorca.json.gz")
BOX = (39.25, 2.30, 39.97, 3.49)               # lat_min, lng_min, lat_max, lng_max
TRACK_STEP_M, ROAD_STEP_M = 20, 50
NEAR_M = 25                                     # grid cell → ~25–50 m tolerance
VILLAGE_M = 200                                 # coarse cell → ~200–400 m
RIDDEN_FRAC = 0.6
CLASS_LABEL = {"primary": "Main roads", "secondary": "Secondary roads", "tertiary": "Local roads",
               "unclassified": "Country lanes", "cycleway": "Bike paths"}


@lru_cache(maxsize=1)
def reference() -> dict:
    with gzip.open(REF, "rt", encoding="utf-8") as f:
        return json.load(f)


def _in_box(p) -> bool:
    return BOX[0] <= p[0] <= BOX[2] and BOX[1] <= p[1] <= BOX[3]


def _rides(conn) -> list:
    rows = conn.execute(
        """SELECT id, date, activity_type, polyline FROM activities
           WHERE polyline IS NOT NULL AND polyline != '' ORDER BY date""").fetchall()
    return [r for r in rows if sport_of(r["activity_type"]) == "ride" and not is_indoor(r["activity_type"])]


def _signature(conn, rides) -> str:
    return f"{reference()['built']}|{len(rides)}|{rides[-1]['id'] if rides else ''}"


def ensure_table(conn) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS mallorca_coverage (id INTEGER PRIMARY KEY CHECK (id = 1), "
                 "signature TEXT, result_json TEXT, computed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))")


def compute(conn: sqlite3.Connection, rides: list | None = None) -> dict:
    ref = reference()
    rides = _rides(conn) if rides is None else rides
    near = Grid(NEAR_M)
    coarse = Grid(VILLAGE_M)                    # value = first date a track passed
    starts = []
    n_rides = 0
    for r in rides:
        # cheap reject: summary polyline never enters the island box
        poly = decode(r["polyline"])
        if not any(_in_box(p) for p in poly[:: max(1, len(poly) // 50)]):
            continue
        n_rides += 1
        track = activity_track(conn, r["id"], r["polyline"])
        if track:
            starts.append(track[0])
        for p in sample(track, TRACK_STEP_M):
            if _in_box(p):
                near.add(p)
                coarse.add(p, r["date"])

    by_class: dict[str, list[float]] = {c: [0.0, 0.0] for c in ref["classes"]}
    gaps: dict[str, float] = {}
    ridden_lines, missing_lines = [], []
    for cls_i, name_i, length, enc in ref["pieces"]:
        line = decode(enc)
        smp = sample(line, ROAD_STEP_M)
        frac = sum(1 for p in smp if near.near(p)) / len(smp)
        cls = ref["classes"][cls_i]
        by_class[cls][0] += length
        by_class[cls][1] += length * frac
        if frac >= RIDDEN_FRAC:
            ridden_lines.append(line)
        else:
            missing_lines.append(line)
            name = ref["names"][name_i]
            if name:
                gaps[name] = gaps.get(name, 0.0) + length * (1 - frac)

    home = (sorted(p[0] for p in starts)[len(starts) // 2], sorted(p[1] for p in starts)[len(starts) // 2]) \
        if starts else (39.5696, 2.6502)
    villages = []
    for name, lat, lng, place, muni in ref["villages"]:
        first = coarse.near((lat, lng))
        villages.append({"name": name, "lat": lat, "lng": lng, "place": place, "municipality": muni or None,
                         "visited": first is not None, "first_date": first,
                         "km_from_home": round(dist_m(home, (lat, lng)) / 1000, 1)})
    villages.sort(key=lambda v: (v["visited"], v["km_from_home"]))

    total = sum(v[0] for v in by_class.values())
    ridden = sum(v[1] for v in by_class.values())
    return {
        "built": ref["built"], "source": ref["source"], "rides": n_rides,
        "roads": {"total_km": round(total / 1000), "ridden_km": round(ridden / 1000),
                  "pct": round(ridden / total * 100, 1) if total else 0,
                  "classes": [{"key": c, "label": CLASS_LABEL.get(c, c), "total_km": round(v[0] / 1000),
                               "ridden_km": round(v[1] / 1000), "pct": round(v[1] / v[0] * 100) if v[0] else 0}
                              for c, v in by_class.items()]},
        "villages": villages,
        "villages_visited": sum(1 for v in villages if v["visited"]),
        "gaps": [{"name": n, "missing_km": round(m / 1000, 1)}
                 for n, m in sorted(gaps.items(), key=lambda x: -x[1])[:12] if m >= 2000],
        "ridden": [encode(l) for l in _merge(ridden_lines)],
        "missing": [encode(l) for l in _merge(missing_lines)],
    }


def _merge(lines: list[list]) -> list[list]:
    """Join pieces that continue each other (same way, consecutive) — fewer, longer lines to draw."""
    out: list[list] = []
    for l in lines:
        if out and out[-1][-1] == l[0]:
            out[-1].extend(l[1:])
        else:
            out.append(list(l))
    return out


def get(conn: sqlite3.Connection) -> dict:
    ensure_table(conn)
    rides = _rides(conn)
    sig = _signature(conn, rides)
    row = conn.execute("SELECT signature, result_json FROM mallorca_coverage WHERE id=1").fetchone()
    if row and row[0] == sig:
        return json.loads(row[1])
    result = compute(conn, rides)
    conn.execute("INSERT OR REPLACE INTO mallorca_coverage (id, signature, result_json) VALUES (1, ?, ?)",
                 (sig, json.dumps(result)))
    conn.commit()
    return result
