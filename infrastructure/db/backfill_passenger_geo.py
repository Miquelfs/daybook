"""
Backfill / normalise passenger_flights rows imported before the richer columns
existed, and unify airline names across import sources.

For every row it:
  - resolves dep_icao / arr_icao + great-circle distance_km (when missing),
  - fills aircraft_code from the aircraft name,
  - canonicalises airline + airline_code (so "Vueling" and "Vueling Airlines"
    collapse to one airline in the stats).

Idempotent. Run once on the Pi (venv):
    .venv/bin/python -m infrastructure.db.backfill_passenger_geo
"""

import sys

from infrastructure.db.connection import get_connection
from domains.travel.flight_geo import geo_for, normalize_aircraft, normalize_airline


def main() -> None:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, origin, destination, aircraft, aircraft_code, airline, airline_code, "
        "dep_icao, distance_km FROM passenger_flights"
    ).fetchall()
    updated = 0
    for r in rows:
        geo = geo_for(conn, r["origin"], r["destination"]) if (
            r["dep_icao"] is None or r["distance_km"] is None) else {
            "dep_icao": r["dep_icao"], "arr_icao": None, "distance_km": r["distance_km"]}
        # keep existing arr_icao if we didn't recompute
        if r["dep_icao"] is not None and r["distance_km"] is not None:
            geo["arr_icao"] = conn.execute(
                "SELECT arr_icao FROM passenger_flights WHERE id=?", (r["id"],)).fetchone()["arr_icao"]

        airline_name, airline_code = normalize_airline(r["airline"], r["airline_code"])
        aircraft_code = r["aircraft_code"] or normalize_aircraft(r["aircraft"])

        changed = (
            geo["dep_icao"] != r["dep_icao"] or geo["distance_km"] != r["distance_km"]
            or airline_name != r["airline"] or airline_code != r["airline_code"]
            or aircraft_code != r["aircraft_code"]
        )
        if not changed:
            continue
        conn.execute(
            "UPDATE passenger_flights SET dep_icao=?, arr_icao=?, distance_km=?, "
            "aircraft_code=?, airline=?, airline_code=? WHERE id=?",
            (geo["dep_icao"], geo["arr_icao"], geo["distance_km"],
             aircraft_code, airline_name, airline_code, r["id"]),
        )
        updated += 1
    conn.commit()
    conn.close()
    print(f"Normalised {updated} flight(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
