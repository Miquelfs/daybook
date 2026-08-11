"""Airport resolution + great-circle distance for the passenger-flight logbook.

Pure helpers (no FastAPI) so the API router and the CSV importers can share them.
They lean on the existing `airports` table (7k+ rows, iata/icao + lat/lon) that
already powers the pilot logbook.
"""

import re
import sqlite3
from math import asin, cos, radians, sin, sqrt
from typing import Optional

# Long marketing names → ICAO type codes, so the "top aircraft" chart groups
# cleanly across sources (Notion writes "B737-800", FR24 writes "B738").
_AIRCRAFT_CODE = {
    "B737-800": "B738",
    "B737-8200": "B38M",
    "B737 MAX 8200": "B38M",
    "A320-200": "A320",
    "A321-200": "A321",
    "A319-100": "A319",
    "A330-200": "A332",
    "A330-300": "A333",
    "B777-200": "B772",
    "B767-300ER": "B763",
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return round(2 * r * asin(sqrt(a)), 1)


def parse_airport_token(raw: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Extract (iata, icao) from a token.

    Handles bare codes ("BCN", "LEBL") and the FR24 form
    "Barcelona / El Prat (BCN/LEBL)".
    """
    if not raw:
        return None, None
    raw = raw.strip()
    m = re.search(r"\(([A-Z0-9]{3})/([A-Z0-9]{4})\)", raw)
    if m:
        return m.group(1), m.group(2)
    code = raw.upper()
    if len(code) == 4 and code.isalnum():
        return None, code       # looks like ICAO
    if len(code) == 3 and code.isalnum():
        return code, None       # looks like IATA
    return None, None


def resolve_airport(conn: sqlite3.Connection, iata: Optional[str], icao: Optional[str]) -> Optional[sqlite3.Row]:
    if icao:
        row = conn.execute("SELECT * FROM airports WHERE icao=?", (icao.upper(),)).fetchone()
        if row:
            return row
    if iata:
        row = conn.execute("SELECT * FROM airports WHERE iata=?", (iata.upper(),)).fetchone()
        if row:
            return row
    return None


def normalize_aircraft(raw: Optional[str]) -> Optional[str]:
    """Return an ICAO-ish type code. FR24 already parenthesises it; Notion uses
    long names we map, and anything unknown passes through unchanged."""
    if not raw:
        return None
    raw = raw.strip()
    m = re.search(r"\(([A-Z0-9]{2,4})\)", raw)   # "Airbus A320 (A320)"
    if m:
        return m.group(1)
    return _AIRCRAFT_CODE.get(raw, raw)


def geo_for(conn: sqlite3.Connection, origin: Optional[str], destination: Optional[str]) -> dict:
    """Resolve dep/arr airports from IATA/ICAO tokens and compute distance.

    Returns {dep_icao, arr_icao, distance_km} (values may be None)."""
    d_iata, d_icao = parse_airport_token(origin)
    a_iata, a_icao = parse_airport_token(destination)
    dep = resolve_airport(conn, d_iata, d_icao)
    arr = resolve_airport(conn, a_iata, a_icao)
    dist = None
    if dep and arr and dep["latitude"] is not None and arr["latitude"] is not None:
        dist = haversine_km(dep["latitude"], dep["longitude"], arr["latitude"], arr["longitude"])
    return {
        "dep_icao": dep["icao"] if dep else d_icao,
        "arr_icao": arr["icao"] if arr else a_icao,
        "distance_km": dist,
    }
