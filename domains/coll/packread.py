"""
Read a .coll course pack the way the device does (firmware Course::loadPack; format in
coursepack/pack.py). Used for the course map (turn and waypoint positions), by the device
emulator to check what it downloaded, and by the tests.
"""

from __future__ import annotations

import math
import struct
from bisect import bisect_right

WAYPOINT_KINDS = ("poi", "feed", "summit", "hazard")


def read(b: bytes, roads: bool = True) -> dict:
    if b[:4] != b"COL1":
        raise ValueError(f"not a COL1 course pack (magic {b[:4]!r})")
    o = 4

    def u(fmt):
        nonlocal o
        v = struct.unpack_from("<" + fmt, b, o)
        o += struct.calcsize("<" + fmt)
        return v

    def s(wide=False):
        nonlocal o
        (n,) = u("H" if wide else "B")
        v = b[o:o + n].decode()
        o += n
        return v

    name = s(True)
    (n,) = u("I")
    pts = [u("iii") for _ in range(n)]
    (n,) = u("H")
    wps = [(*u("Bii"), s()) for _ in range(n)]
    (n,) = u("H")
    turns = [(*u("fhBB"), s()) for _ in range(n)]
    out = {"name": name, "points": pts, "waypoints": wps, "turns": turns}
    if roads:
        (n,) = u("I")
        rd = []
        for _ in range(n):
            cls, cnt, x, y = u("BHii")
            rd.append((cls, [u("hh") for _ in range(cnt - 1)]))
        if o != len(b):
            raise ValueError("trailing bytes after the map roads")
        out["roads"] = rd
    return out


def _m(a, b) -> float:
    """Metres between two (lat·1e7, lon·1e7) points — the device's flat-earth distance."""
    la, lb = a[0] / 1e7, b[0] / 1e7
    dy = (lb - la) * 111_320
    dx = (b[1] - a[1]) / 1e7 * 111_320 * math.cos(math.radians((la + lb) / 2))
    return math.hypot(dx, dy)


def geometry(b: bytes) -> dict:
    """Where each turn prompt and waypoint is: {turns: [{at, lat, lon}], waypoints: [{kind, lat, lon, name}]}."""
    p = read(b, roads=False)
    pts = p["points"]
    cum = [0.0]
    for a, c in zip(pts, pts[1:]):
        cum.append(cum[-1] + _m(a, c))
    turns = []
    for at, *_ in p["turns"]:                      # same order as the build's turn list
        i = max(0, min(len(cum) - 2, bisect_right(cum, at) - 1))
        seg = cum[i + 1] - cum[i] if len(cum) > 1 else 0
        f = min(1.0, max(0.0, (at - cum[i]) / seg)) if seg else 0.0
        a, c = pts[i], pts[min(i + 1, len(pts) - 1)]
        turns.append({"at": round(at, 1), "lat": round((a[0] + (c[0] - a[0]) * f) / 1e7, 6),
                      "lon": round((a[1] + (c[1] - a[1]) * f) / 1e7, 6)})
    wps = [{"kind": WAYPOINT_KINDS[k] if k < len(WAYPOINT_KINDS) else "poi",
            "lat": lat / 1e7, "lon": lon / 1e7, "name": name} for k, lat, lon, name in p["waypoints"]]
    return {"turns": turns, "waypoints": wps, "km": round(cum[-1] / 1000, 1)}
