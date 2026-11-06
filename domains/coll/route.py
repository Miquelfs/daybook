"""
A route as a line you can measure along: every GPX point with its distance from the start,
where you are at km X, which way the road goes there, and how long the touring model says each
500 m takes. Shared by the ride review (where along the route each moment of a ride was) and
the weather (when you'll be where, which way you're facing the wind).

Cached per GPX in this process; a 312 km GPX is ~30 k points.
"""

from __future__ import annotations

import bisect
import math

from domains.health.geo import dist_m

_lines: dict[str, "Line"] = {}
SEG_KM = 0.5                              # the brief's profile step


class Line:
    def __init__(self, pts: list[tuple[float, float]], eles: list[float | None]):
        self.pts = pts
        self.eles = eles
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + dist_m(a, b))
        self.cum = cum
        self.length_m = cum[-1]

    def at(self, m: float) -> tuple[float, float]:
        """(lat, lon) m metres along."""
        m = max(0.0, min(self.length_m, m))
        i = max(1, bisect.bisect_left(self.cum, m))
        if i >= len(self.cum):
            return self.pts[-1]
        a, b = self.pts[i - 1], self.pts[i]
        span = self.cum[i] - self.cum[i - 1]
        k = (m - self.cum[i - 1]) / span if span else 0.0
        return a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k

    def bearing(self, m0: float, m1: float) -> float:
        """Direction of travel from m0 to m1, degrees from north."""
        a, b = self.at(m0), self.at(m1)
        y = math.sin(math.radians(b[1] - a[1])) * math.cos(math.radians(b[0]))
        x = (math.cos(math.radians(a[0])) * math.sin(math.radians(b[0]))
             - math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(math.radians(b[1] - a[1])))
        return (math.degrees(math.atan2(y, x)) + 360) % 360


def line(gpx_sha1: str, gpx: str) -> Line | None:
    if gpx_sha1 not in _lines:
        from domains.coll.coursepack import gpx as G
        try:
            g = G.parse(gpx)
            pts = [(p[0], p[1]) for p in g["points"]]
            eles = [p[2] if len(p) > 2 else None for p in g["points"]]
        except Exception:                                       # noqa: BLE001 — an odd GPX: no line
            pts, eles = [], []
        _lines[gpx_sha1] = Line(pts, eles) if len(pts) >= 2 else None
    return _lines[gpx_sha1]


def segments(profile: list, flat_kmh: float, model_flat_kmh: float) -> list[dict]:
    """Each 500 m of the brief's profile: {km0, km1, grade_pct, s} — riding seconds at your pace
    (gpx_course's speed by gradient, scaled from its flat speed to yours)."""
    from domains.training.gpx_course import _speed
    scale = model_flat_kmh / flat_kmh if flat_kmh else 1.0
    out = []
    for (k0, e0), (k1, e1) in zip(profile, profile[1:]):
        d = (k1 - k0) * 1000
        if d <= 0:
            continue
        g = (e1 - e0) / d * 100
        out.append({"km0": k0, "km1": k1, "grade_pct": g, "s": d / (_speed(g) / 3.6) * scale})
    return out
