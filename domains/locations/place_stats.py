"""
Place statistics from the location history: per day and per month, how many places / cities /
countries you were in and which of them were new (never seen before that date).

Two sources, merged: Google timeline visits (place_names: name, city, country — until 2026-05)
and Overland tracks (geocoded segment: name, city, country — since). A "place" is the geocoded
name in its city (often a street or venue); countries are normalised to English.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date

from domains.locations.country_names import to_english


def _rows(con: sqlite3.Connection):
    """(date, place, city, country) for every visit and named track segment, oldest first."""
    q = """
        SELECT substr(v.date, 1, 10) AS d, p.name AS place, p.city AS city, p.country AS country
        FROM visits v JOIN place_names p ON p.place_id = v.place_id
        WHERE v.date IS NOT NULL
        UNION ALL
        SELECT substr(t.date, 1, 10), t.geocode_name, t.geocode_city, t.geocode_country
        FROM tracks t WHERE t.date IS NOT NULL AND (t.geocode_name IS NOT NULL OR t.geocode_city IS NOT NULL)
        ORDER BY 1"""
    try:
        for d, place, city, country in con.execute(q):
            yield d, place, city, to_english(country) if country else None
    except sqlite3.OperationalError:
        return


_CACHE: dict = {}


def _first_seen(con):
    """First date of each place / city / country, plus everything seen per day — cached until the
    location data changes (a full scan takes seconds on the Pi)."""
    try:
        sig = tuple(con.execute("SELECT (SELECT COUNT(*) FROM visits), (SELECT COUNT(*) FROM tracks), "
                                "(SELECT MAX(date) FROM tracks)").fetchone())
    except sqlite3.OperationalError:
        sig = None
    if sig is not None and _CACHE.get("sig") == sig:
        return _CACHE["data"]
    data = _scan(con)
    if sig is not None:
        _CACHE.update(sig=sig, data=data)
    return data


def _scan(con):
    first_p, first_c, first_k = {}, {}, {}
    by_day: dict[str, dict[str, set]] = defaultdict(lambda: {"places": set(), "cities": set(), "countries": set()})
    for d, place, city, country in _rows(con):
        if place:
            key = (place, city)
            first_p.setdefault(key, d)
            by_day[d]["places"].add(key)
        if city:
            first_c.setdefault((city, country), d)
            by_day[d]["cities"].add((city, country))
        if country:
            first_k.setdefault(country, d)
            by_day[d]["countries"].add(country)
    return first_p, first_c, first_k, by_day


def day(con: sqlite3.Connection, d: str) -> dict:
    first_p, first_c, first_k, by_day = _first_seen(con)
    seen = by_day.get(d) or {"places": set(), "cities": set(), "countries": set()}
    new_p = sorted(p for p in seen["places"] if first_p.get(p) == d)
    new_c = sorted(c for c in seen["cities"] if first_c.get(c) == d)
    return {
        "date": d, "places": len(seen["places"]), "cities": sorted(c for c, _ in seen["cities"]),
        "countries": sorted(seen["countries"]),
        "new_places": [{"name": p, "city": c} for p, c in new_p],
        "new_cities": [{"city": c, "country": k} for c, k in new_c],
        "new_countries": sorted(k for k in seen["countries"] if first_k.get(k) == d),
        "first_ever": min(by_day) if by_day else None,
    }


def months(con: sqlite3.Connection, year: int | None = None, last: int = 12) -> dict:
    """Per month: distinct places / cities / countries and the new ones. A year, or the last N months."""
    first_p, first_c, first_k, by_day = _first_seen(con)
    agg: dict[str, dict[str, set]] = defaultdict(lambda: {"places": set(), "cities": set(), "countries": set()})
    for d, s in by_day.items():
        m = d[:7]
        for k in ("places", "cities", "countries"):
            agg[m][k] |= s[k]
    new_by_month: dict[str, dict[str, list]] = defaultdict(lambda: {"places": [], "cities": [], "countries": []})
    for key, d in first_p.items():
        new_by_month[d[:7]]["places"].append(key)
    for key, d in first_c.items():
        new_by_month[d[:7]]["cities"].append(key)
    for key, d in first_k.items():
        new_by_month[d[:7]]["countries"].append(key)

    if year:
        keys = [f"{year}-{m:02d}" for m in range(1, 13)]
    else:
        t = date.today()
        keys = []
        y, m = t.year, t.month
        for _ in range(last):
            keys.append(f"{y}-{m:02d}")
            y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        keys.reverse()
    out = []
    for k in keys:
        a, n = agg.get(k), new_by_month.get(k)
        out.append({
            "month": k,
            "places": len(a["places"]) if a else 0, "cities": len(a["cities"]) if a else 0,
            "countries": len(a["countries"]) if a else 0,
            "new_places": len(n["places"]) if n else 0, "new_cities": len(n["cities"]) if n else 0,
            "new_city_names": sorted(c for c, _ in n["cities"])[:12] if n else [],
            "new_countries": sorted(n["countries"]) if n else [],
        })
    return {"months": out, "totals": {"places": len(first_p), "cities": len(first_c), "countries": len(first_k)}}
