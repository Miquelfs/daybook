"""
Import a Notion passenger-flight export into the passenger_flights table.

Expected CSV columns (Notion "Untitled …_all.csv" export):
    Name, Acompanyant, Aircraft, Airline, Commuting, Date, Destination,
    Duration, Origin, Paid, Seat

- Date is DD/MM/YYYY → stored as YYYY-MM-DD.
- Paid like "€48.99" → 48.99 (EUR assumed).
- Acompanyant "None" → NULL.  Commuting "Yes"/"No" → 1/0.
- Idempotent: a row with the same (date, flight_number, origin, destination)
  is skipped, so re-running never duplicates.
- Each imported day is tagged 'traveling' (if that tag exists).

Usage on the Pi (inside the venv):
    .venv/bin/python -m infrastructure.db.import_passenger_flights --csv /path/to/export.csv
"""

import argparse
import csv
import re
import sys

from infrastructure.db.connection import get_connection
from infrastructure.api.routers.passenger_flights import ensure_traveling_tag
from domains.travel.flight_geo import geo_for, normalize_aircraft


def _parse_date(raw: str) -> str | None:
    raw = (raw or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", raw)
    if m:
        d, mth, y = m.groups()
        return f"{y}-{int(mth):02d}-{int(d):02d}"
    # Already ISO?
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw
    return None


def _parse_price(raw: str) -> float | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    cleaned = re.sub(r"[^0-9.,-]", "", raw).replace(",", "")
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _parse_float(raw: str) -> float | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _clean(raw: str | None) -> str | None:
    raw = (raw or "").strip()
    if not raw or raw.lower() == "none":
        return None
    return raw


def import_csv(conn, path: str) -> tuple[int, int]:
    inserted = skipped = 0
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            date = _parse_date(r.get("Date", ""))
            if not date:
                skipped += 1
                continue
            flight_number = _clean(r.get("Name"))
            origin = _clean(r.get("Origin"))
            destination = _clean(r.get("Destination"))

            dup = conn.execute(
                """SELECT 1 FROM passenger_flights
                   WHERE date=? AND IFNULL(flight_number,'')=IFNULL(?,'')
                     AND IFNULL(origin,'')=IFNULL(?,'') AND IFNULL(destination,'')=IFNULL(?,'')""",
                (date, flight_number, origin, destination),
            ).fetchone()
            if dup:
                skipped += 1
                continue

            commuting = 1 if (r.get("Commuting", "").strip().lower() == "yes") else 0
            aircraft = _clean(r.get("Aircraft"))
            geo = geo_for(conn, origin, destination)
            conn.execute(
                """INSERT INTO passenger_flights
                   (date, flight_number, origin, destination, dep_icao, arr_icao,
                    airline, aircraft, aircraft_code, price_paid, reason, commuting,
                    companion, seat, duration_hours, distance_km)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    date, flight_number, origin, destination, geo["dep_icao"], geo["arr_icao"],
                    _clean(r.get("Airline")), aircraft, normalize_aircraft(aircraft),
                    _parse_price(r.get("Paid", "")),
                    "Commuting" if commuting else None,
                    commuting,
                    _clean(r.get("Acompanyant")), _clean(r.get("Seat")),
                    _parse_float(r.get("Duration", "")), geo["distance_km"],
                ),
            )
            ensure_traveling_tag(conn, date)
            inserted += 1
    conn.commit()
    return inserted, skipped


def main() -> None:
    ap = argparse.ArgumentParser(description="Import Notion passenger-flight CSV")
    ap.add_argument("--csv", required=True, help="Path to the Notion CSV export")
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
