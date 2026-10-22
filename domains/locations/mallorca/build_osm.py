"""
Build the Mallorca road + village reference file from OpenStreetMap.

Run on the Mac (the Pi is too small to chew through ~12 MB of Overpass JSON):

    python -m domains.locations.mallorca.build_osm

Writes domains/locations/mallorca/osm_mallorca.json.gz, which ships with the
code. Roads change rarely — rebuild a couple of times a year.

Kept: paved, bikeable primary/secondary/tertiary/unclassified roads and
cycleways. Dropped: bicycle=no / use_sidepath, private or no access, motor
roads, unpaved surfaces. Dual carriageways and overlapping ways are counted
once (a piece whose samples all sit on an already-kept piece is a duplicate).
"""

from __future__ import annotations

import gzip
import json
import math
import sys
from datetime import date
from pathlib import Path

from domains.health.geo import dist_m, encode, sample
from domains.locations import overpass

OUT = Path(__file__).with_name("osm_mallorca.json.gz")
BBOX = "39.25,2.30,39.97,3.49"          # Mallorca only (Cabrera, Menorca outside)
CLASSES = ["primary", "secondary", "tertiary", "unclassified", "cycleway"]
UNPAVED = {"unpaved", "gravel", "dirt", "ground", "compacted", "fine_gravel", "sand", "grass", "earth", "mud", "pebblestone"}
PIECE_M = 500           # coverage granularity
DEDUP_M = 25            # a sample this close to a kept piece is "the same road"


def _overpass(q: str) -> dict:
    return overpass.query(q)


_m = dist_m


def _split(geom: list[tuple[float, float]], step: float) -> list[list[tuple[float, float]]]:
    pieces, cur, acc = [], [geom[0]], 0.0
    for a, b in zip(geom, geom[1:]):
        cur.append(b)
        acc += _m(a, b)
        if acc >= step:
            pieces.append(cur)
            cur, acc = [b], 0.0
    if len(cur) > 1:
        if pieces and acc < step / 3:
            pieces[-1].extend(cur[1:])       # fold a short tail into the previous piece
        else:
            pieces.append(cur)
    return pieces


def _cell(p, size_m: float) -> tuple[int, int]:
    return int(p[0] * 110_540 // size_m), int(p[1] * 111_320 * math.cos(math.radians(39.6)) // size_m)


def keep_way(t: dict) -> bool:
    if t.get("bicycle") in ("no", "use_sidepath", "dismount") or t.get("access") in ("private", "no"):
        return False
    if t.get("motorroad") == "yes" or t.get("area") == "yes":
        return False
    return t.get("surface") not in UNPAVED


def build() -> dict:
    roads = _overpass(f'[out:json][timeout:240][bbox:{BBOX}];'
                      f'way["highway"~"^({"|".join(CLASSES)})$"];out tags geom;')
    places = _overpass(f'[out:json][timeout:60][bbox:{BBOX}];node["place"~"^(town|village)$"]["name"];out;')

    ways = [w for w in roads["elements"] if w.get("geometry") and keep_way(w.get("tags", {}))]
    ways.sort(key=lambda w: CLASSES.index(w["tags"]["highway"]))          # main roads win the dedupe
    names: list[str] = []
    name_ix: dict[str, int] = {}
    taken: set[tuple[int, int]] = set()
    pieces = []
    for w in ways:
        t = w["tags"]
        label = " · ".join(x for x in (t.get("ref"), t.get("name")) if x) or ""
        if label not in name_ix:
            name_ix[label] = len(names)
            names.append(label)
        geom = [(g["lat"], g["lon"]) for g in w["geometry"]]
        for piece in _split(geom, PIECE_M):
            smp = sample(piece, DEDUP_M)
            cells = [_cell(p, DEDUP_M) for p in smp]
            if sum(1 for c in cells if c in taken) >= 0.8 * len(cells):
                continue                                   # the other carriageway / an overlapping way
            taken.update(cells)
            length = sum(_m(a, b) for a, b in zip(piece, piece[1:]))
            pieces.append([CLASSES.index(t["highway"]), name_ix[label], round(length), encode(piece)])

    villages = []
    for n in places["elements"]:
        t = n["tags"]
        villages.append([t["name"], round(n["lat"], 5), round(n["lon"], 5), t["place"],
                         t.get("is_in:municipality") or t.get("addr:municipality") or ""])
    villages.sort(key=lambda v: v[0])
    return {"built": date.today().isoformat(), "source": "© OpenStreetMap contributors (ODbL)",
            "classes": CLASSES, "names": names, "pieces": pieces, "villages": villages}


def main() -> None:
    data = build()
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    km = sum(p[2] for p in data["pieces"]) / 1000
    print(f"{len(data['pieces'])} road pieces · {km:.0f} km · {len(data['villages'])} villages → {OUT} "
          f"({OUT.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
