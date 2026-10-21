"""
Regions inside a country that get their own flag — Catalonia, for now.

Places only carry a country, so the region comes from coordinates: a
simplified outline of Catalonia's border, tested with ray casting. One GPS
point per Spanish city is enough to know which cities are Catalan.
"""

from __future__ import annotations

import json
import math
import sqlite3
import time

SPAIN = {"Spain", "España"}

# (lng, lat), clockwise from the Ebre delta along the Valencia / Aragón /
# Pyrenees borders and back down the coast. ~5 km accuracy — enough for cities.
CATALONIA = [
    (0.52, 40.52), (0.26, 40.63), (0.17, 40.73), (0.27, 41.00), (0.39, 41.25), (0.44, 41.55),
    (0.35, 41.79), (0.62, 42.00), (0.70, 42.30), (0.66, 42.69), (0.70, 42.86), (1.00, 42.80),
    (1.45, 42.60), (1.72, 42.50), (1.98, 42.49), (2.10, 42.42), (2.50, 42.35), (3.18, 42.43), (3.35, 42.32),
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


_CACHE: dict[str, tuple[float, dict]] = {}
_TTL_S = 6 * 3600


def city_points(con: sqlite3.Connection) -> dict[str, tuple[float, float]]:
    """City → (lng, lat) for Spanish cities: one GPS point per city on Overland
    tracks, the average visit position on Google history. Cached 6 h."""
    hit = _CACHE.get("pts")
    if hit and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    out: dict[str, tuple[float, float]] = {}
    try:
        for city, lng, lat in con.execute("""
                SELECT p.city, AVG(v.lng), AVG(v.lat) FROM visits v JOIN place_names p ON p.place_id = v.place_id
                WHERE p.city IS NOT NULL AND p.country IN ('Spain', 'España')
                  AND v.lat IS NOT NULL AND v.lat != 0 GROUP BY p.city"""):
            out[city] = (float(lng), float(lat))
    except sqlite3.Error:
        pass
    try:
        for city, pj in con.execute("""
                SELECT geocode_city, points_json FROM tracks WHERE id IN (
                    SELECT MIN(id) FROM tracks
                    WHERE geocode_city IS NOT NULL AND geocode_country IN ('Spain', 'España')
                    GROUP BY geocode_city)"""):
            try:
                p = json.loads(pj)[0]
                out[city] = (float(p["lng"]), float(p["lat"]))
            except (ValueError, KeyError, IndexError, TypeError):
                continue
    except sqlite3.Error:
        pass
    _CACHE["pts"] = (time.monotonic(), out)
    return out


def catalan_cities(con: sqlite3.Connection) -> set[str]:
    """Spanish city names that lie in Catalonia."""
    return {c for c, (lng, lat) in city_points(con).items() if in_catalonia(lng, lat)}


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lng, lat) points."""
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def region_for(country: str | None, cities: list[str], catalan: set[str]) -> str | None:
    """'Catalonia' when every one of the cities is in Catalonia."""
    if country not in SPAIN or not cities:
        return None
    return "Catalonia" if all(c in catalan for c in cities) else None


HOME_RADIUS_KM = 80     # the home island / area — Palma while in Mallorca, Tenerife before


def trip_region(country: str | None, cities: list[str], catalan: set[str],
                points: dict[str, tuple[float, float]], home: tuple[float, float] | None) -> str | None:
    """A trip is Catalan when every city it went to *away from home* is. The home
    end (flying out of Palma) doesn't count; without a known home, most cities must be."""
    if country not in SPAIN or not cities:
        return None
    if home is None:
        n = sum(1 for c in cities if c in catalan)
        return "Catalonia" if n * 2 > len(cities) else None
    away = [c for c in cities if c not in points or km(points[c], home) > HOME_RADIUS_KM]
    return region_for(country, away, catalan)
