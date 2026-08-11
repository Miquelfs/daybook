"""
Import a MyFlightRadar24 export into the passenger_flights table.

FR24 columns:
    Date, Flight number, From, To, Dep time, Arr time, Duration, Airline,
    Aircraft, Registration, Seat number, Seat type, Flight class, Flight reason,
    Note, Dep_id, Arr_id, Airline_id, Aircraft_id

- From/To carry both codes: "Barcelona / El Prat (BCN/LEBL)" → IATA + ICAO,
  resolved against the airports table (also gives the great-circle distance).
- Duration "HH:MM:SS" → hours.  Seat/class/reason are numeric enums, decoded below.
- Idempotent on (date, flight_number, origin, destination), which also guarantees
  no overlap with the Notion import already in the table.
- Each imported day is tagged 'traveling' (if that tag exists).

Usage on the Pi (venv):
    .venv/bin/python -m infrastructure.db.import_flightradar --csv /path/to/flightdiary.csv
"""

import argparse
import csv
import re
import sys

from infrastructure.db.connection import get_connection
from infrastructure.api.routers.passenger_flights import ensure_traveling_tag
from domains.travel.flight_geo import geo_for, normalize_aircraft, normalize_airline, parse_airport_token

SEAT_TYPE = {"1": "Window", "2": "Middle", "3": "Aisle"}
FLIGHT_CLASS = {"1": "Economy", "2": "Economy+", "3": "Business", "4": "First"}
FLIGHT_REASON = {"1": "Leisure", "2": "Business", "3": "Crew"}


def _clean(raw):
    raw = (raw or "").strip()
    return raw or None


def _hhmmss_to_hours(raw: str):
    raw = (raw or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", raw)
    if not m:
        return None
    h, mn, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    total = h + mn / 60 + s / 3600
    return round(total, 2) if total > 0 else None


def _hhmm(raw: str):
    raw = (raw or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})", raw)
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def _airline(raw: str):
    """'Vueling Airlines (VY/VLG)' → ('Vueling Airlines', 'VY')."""
    raw = (raw or "").strip()
    m = re.match(r"^(.*?)\s*\(([A-Z0-9]+)/[A-Z0-9]+\)\s*$", raw)
    if m:
        return m.group(1).strip() or None, m.group(2)
    return (raw or None), None


def import_csv(conn, path: str) -> tuple[int, int]:
    inserted = skipped = 0
    with open(path, encoding="utf-8-sig", newline="") as f:
        # FR24 exports can carry a leading blank line — skip any so the real
        # header row is used (otherwise every row looks "dateless" & is skipped).
        pos = f.tell()
        while f.readline().strip() == "":
            pos = f.tell()
        f.seek(pos)
        reader = csv.DictReader(f)
        if reader.fieldnames:
            reader.fieldnames = [(fn or "").strip() for fn in reader.fieldnames]
        for r in reader:
            date = _clean(r.get("Date"))
            if not date or not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                skipped += 1
                continue

            o_iata, _ = parse_airport_token(r.get("From"))
            d_iata, _ = parse_airport_token(r.get("To"))
            origin = o_iata or _clean(r.get("From"))
            destination = d_iata or _clean(r.get("To"))
            flight_number = _clean(r.get("Flight number"))

            dup = conn.execute(
                """SELECT 1 FROM passenger_flights
                   WHERE date=? AND IFNULL(flight_number,'')=IFNULL(?,'')
                     AND IFNULL(origin,'')=IFNULL(?,'') AND IFNULL(destination,'')=IFNULL(?,'')""",
                (date, flight_number, origin, destination),
            ).fetchone()
            if dup:
                skipped += 1
                continue

            airline_name, airline_code = _airline(r.get("Airline"))
            airline_name, airline_code = normalize_airline(airline_name, airline_code)
            aircraft_name = _clean(r.get("Aircraft"))
            aircraft_code = normalize_aircraft(aircraft_name)
            geo = geo_for(conn, r.get("From"), r.get("To"))

            conn.execute(
                """INSERT INTO passenger_flights
                   (date, flight_number, origin, destination, dep_icao, arr_icao,
                    airline, airline_code, aircraft, aircraft_code, registration,
                    reason, commuting, seat, seat_type, flight_class,
                    dep_time, arr_time, duration_hours, distance_km, notes)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    date, flight_number, origin, destination, geo["dep_icao"], geo["arr_icao"],
                    airline_name, airline_code, aircraft_name, aircraft_code, _clean(r.get("Registration")),
                    FLIGHT_REASON.get((r.get("Flight reason") or "").strip()),
                    0,
                    _clean(r.get("Seat number")),
                    SEAT_TYPE.get((r.get("Seat type") or "").strip()),
                    FLIGHT_CLASS.get((r.get("Flight class") or "").strip()),
                    _hhmm(r.get("Dep time")), _hhmm(r.get("Arr time")),
                    _hhmmss_to_hours(r.get("Duration")), geo["distance_km"],
                    _clean(r.get("Note")),
                ),
            )
            ensure_traveling_tag(conn, date)
            inserted += 1
    conn.commit()
    return inserted, skipped


def main() -> None:
    ap = argparse.ArgumentParser(description="Import MyFlightRadar24 CSV export")
    ap.add_argument("--csv", required=True, help="Path to the FR24 flightdiary CSV")
    args = ap.parse_args()
    conn = get_connection()
    try:
        inserted, skipped = import_csv(conn, args.csv)
    finally:
        conn.close()
    print(f"Imported {inserted} flight(s); skipped {skipped} (duplicate or dateless).",
          file=sys.stderr)


if __name__ == "__main__":
    main()
