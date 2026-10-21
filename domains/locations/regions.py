"""
Regions inside a country that get their own flag — Catalonia, for now.

Places only carry a country, so the region comes from coordinates: a
simplified outline of Catalonia's border, tested with ray casting. One GPS
point per Spanish city is enough to know which cities are Catalan.
"""

from __future__ import annotations

import json
import sqlite3
import time

SPAIN = {"Spain", "España"}

# (lng, lat), clockwise from the Ebre delta along the Valencia / Aragón /
# Pyrenees borders and back down the coast. ~5 km accuracy — enough for cities.
CATALONIA = [
    (0.52, 40.52), (0.26, 40.63), (0.17, 40.73), (0.27, 41.00), (0.39, 41.25), (0.44, 41.55),
    (0.35, 41.79), (0.62, 42.00), (0.70, 42.30), (0.66, 42.69), (0.70, 42.86), (1.00, 42.80),
    (1.45, 42.60), (1.72, 42.50), (2.10, 42.42), (2.50, 42.35), (3.18, 42.43), (3.35, 42.32),
    (3.25, 41.95), (2.80, 41.65), (2.20, 41.30), (1.60, 41.18), (0.97, 41.03), (0.85, 40.75),
]


def in_catalonia(lng: float, lat: float) -> bool:
    inside = False
    pts = CATALONIA
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


_CACHE: dict[str, tuple[float, set[str]]] = {}
_TTL_S = 6 * 3600


def catalan_cities(con: sqlite3.Connection) -> set[str]:
    """City names (as geocoded on tracks) that lie in Catalonia. Cached 6 h."""
    hit = _CACHE.get("cat")
    if hit and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    out: set[str] = set()
    try:
        rows = con.execute("""
            SELECT geocode_city, points_json FROM tracks WHERE id IN (
                SELECT MIN(id) FROM tracks
                WHERE geocode_city IS NOT NULL AND geocode_country IN ('Spain', 'España')
                GROUP BY geocode_city)""").fetchall()
    except sqlite3.Error:
        rows = []
    for city, pj in rows:
        try:
            p = json.loads(pj)[0]
            if in_catalonia(float(p["lng"]), float(p["lat"])):
                out.add(city)
        except (ValueError, KeyError, IndexError, TypeError):
            continue
    _CACHE["cat"] = (time.monotonic(), out)
    return out


def region_for(country: str | None, cities: list[str], catalan: set[str]) -> str | None:
    """'Catalonia' when the place (or every city of a trip) is in Catalonia."""
    if country not in SPAIN or not cities:
        return None
    return "Catalonia" if all(c in catalan for c in cities) else None
