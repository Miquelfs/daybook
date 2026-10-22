"""
Small track geometry helpers shared by route matching and road coverage:
Google polylines, flat-earth distances (fine at ride scale), resampling at a
fixed spacing and a metre grid for fast "is there a point near here?" lookups.
"""

from __future__ import annotations

import json
import math
import sqlite3

Pt = tuple[float, float]


def decode(poly: str) -> list[Pt]:
    out, idx, lat, lng = [], 0, 0, 0
    while idx < len(poly):
        for k in range(2):
            shift = result = 0
            while True:
                b = ord(poly[idx]) - 63
                idx += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if k == 0:
                lat += d
            else:
                lng += d
        out.append((lat / 1e5, lng / 1e5))
    return out


def encode(pts) -> str:
    out, plat, plng = [], 0, 0
    for lat, lng in pts:
        ilat, ilng = round(lat * 1e5), round(lng * 1e5)
        for d in (ilat - plat, ilng - plng):
            v = ~(d << 1) if d < 0 else d << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plng = ilat, ilng
    return "".join(out)


def dist_m(a: Pt, b: Pt) -> float:
    dx = (b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2)) * 111_320
    dy = (b[0] - a[0]) * 110_540
    return math.hypot(dx, dy)


def length_m(line) -> float:
    return sum(dist_m(a, b) for a, b in zip(line, line[1:]))


def sample(line, every: float) -> list[Pt]:
    """Points every `every` metres along a line (first and last included)."""
    if not line:
        return []
    out = [line[0]]
    carry = 0.0
    for a, b in zip(line, line[1:]):
        seg = dist_m(a, b)
        if seg <= 0:
            continue
        d = every - carry
        while d <= seg:
            t = d / seg
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            d += every
        carry = (carry + seg) % every
    if out[-1] != tuple(line[-1]):
        out.append(tuple(line[-1]))
    return out


class Grid:
    """Points bucketed into ~`size_m` cells; `near(p)` checks the 3×3 neighbourhood (≈ size_m…2·size_m)."""

    def __init__(self, size_m: float, lat0: float = 39.6):
        self.sy = size_m / 110_540
        self.sx = size_m / (111_320 * math.cos(math.radians(lat0)))
        self.cells: dict[tuple[int, int], object] = {}

    def key(self, p: Pt) -> tuple[int, int]:
        return int(p[0] // self.sy), int(p[1] // self.sx)

    def add(self, p: Pt, value: object = True) -> None:
        self.cells.setdefault(self.key(p), value)

    def near(self, p: Pt):
        y, x = self.key(p)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                v = self.cells.get((y + dy, x + dx))
                if v is not None:
                    return v
        return None


def activity_track(conn: sqlite3.Connection, activity_id: str, polyline: str | None) -> list[Pt]:
    """Full-resolution GPS from the streams when synced, else the (simplified) summary polyline."""
    try:
        rows = dict(conn.execute(
            "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=? "
            "AND stream_type IN ('directlatitude','directlongitude')", (activity_id,)).fetchall())
        if len(rows) == 2:
            lat, lng = json.loads(rows["directlatitude"]), json.loads(rows["directlongitude"])
            pts = [(a, b) for a, b in zip(lat, lng) if a is not None and b is not None and (a or b)]
            if len(pts) > 10:
                return pts
    except (sqlite3.OperationalError, ValueError, TypeError):
        pass
    return decode(polyline) if polyline else []
