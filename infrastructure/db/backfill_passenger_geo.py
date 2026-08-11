"""
Backfill dep_icao / arr_icao / distance_km / aircraft_code on passenger_flights
rows imported before those columns existed (the first Notion batch).

Idempotent — only touches rows missing resolved geo. Run once on the Pi (venv):
    .venv/bin/python -m infrastructure.db.backfill_passenger_geo
"""

import sys

from infrastructure.db.connection import get_connection
from domains.travel.flight_geo import geo_for, normalize_aircraft


def main() -> None:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, origin, destination, aircraft, aircraft_code, dep_icao, distance_km "
        "FROM passenger_flights"
    ).fetchall()
    updated = 0
    for r in rows:
        needs = r["dep_icao"] is None or r["distance_km"] is None or (r["aircraft"] and not r["aircraft_code"])
        if not needs:
            continue
        geo = geo_for(conn, r["origin"], r["destination"])
        conn.execute(
            "UPDATE passenger_flights SET dep_icao=?, arr_icao=?, distance_km=?, aircraft_code=? WHERE id=?",
            (geo["dep_icao"], geo["arr_icao"], geo["distance_km"],
             r["aircraft_code"] or normalize_aircraft(r["aircraft"]), r["id"]),
        )
        updated += 1
    conn.commit()
    conn.close()
    print(f"Backfilled geo on {updated} flight(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
