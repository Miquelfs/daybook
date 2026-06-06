"""
Import Norwegian Air Shuttle flight log CSV into the flights table.

CSV format (flight_log_merged.csv):
  - Timestamps in UTC as "DD/MM/YYYY HH:MM:SS"
  - Flight Date as "DD/MM/YY"
  - DEP/ARR are IATA codes — resolved to ICAO via airports table
  - PF/PM are internal employee IDs; PILOT_ID = 107873 (Miquel)
  - PF is the Pilot Flying (handled T/O and landing unless overridden by column)
  - All flights are SIC regardless of PF/PM status
  - T/O and landings credited to PILOT_ID only when they are PF

Usage:
    python -m domains.aviation.importers.norwegian_importer [--force] [--csv PATH]
"""

import argparse
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parents[3]
DEFAULT_CSV = ROOT / "data" / "raw" / "aviation" / "flight_log_merged.csv"

from domains.aviation.compute import great_circle_nm, night_seconds, is_night_moment
from infrastructure.db.connection import get_connection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

PILOT_ID = "107873"
OPERATOR = "Norwegian"
SOURCE = "norwegian"

# Norwegian AC type codes → human-readable
AC_TYPE_MAP = {
    "7M8": "Boeing 737 MAX 8",
    "73H": "Boeing 737-800",
    "73W": "Boeing 737-700",
    "738": "Boeing 737-800",
    "73G": "Boeing 737-700",
    "7M9": "Boeing 737 MAX 9",
}


def _parse_utc(s: str) -> datetime | None:
    """Parse 'DD/MM/YYYY HH:MM:SS' as UTC datetime."""
    if not s or s.strip() == "":
        return None
    s = s.strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _hhmm_to_seconds(s: str) -> int | None:
    """Parse 'HH:MM:SS' or 'HH:MM' to total seconds."""
    if not s or s.strip() == "":
        return None
    parts = s.strip().split(":")
    try:
        h, m = int(parts[0]), int(parts[1])
        sc = int(parts[2]) if len(parts) > 2 else 0
        return h * 3600 + m * 60 + sc
    except (ValueError, IndexError):
        return None


def _icao_from_iata(conn, iata: str) -> str | None:
    """Lookup ICAO code from airports table by IATA."""
    if not iata:
        return None
    row = conn.execute(
        "SELECT icao FROM airports WHERE iata = ? LIMIT 1", (iata.upper(),)
    ).fetchone()
    return row["icao"] if row else None


def _airport_coords(conn, icao: str) -> tuple[float | None, float | None]:
    if not icao:
        return None, None
    row = conn.execute(
        "SELECT latitude, longitude FROM airports WHERE icao = ? LIMIT 1", (icao,)
    ).fetchone()
    if row:
        return row["latitude"], row["longitude"]
    return None, None


def _parse_row(row: dict, conn) -> dict | None:
    """Map one Norwegian CSV row to a canonical flights dict."""
    raw_date = (row.get("Flight Date") or "").strip()
    if not raw_date:
        return None

    # Parse DD/MM/YY → YYYY-MM-DD
    try:
        dt = datetime.strptime(raw_date, "%d/%m/%y")
        date_iso = dt.strftime("%Y-%m-%d")
    except ValueError:
        log.warning("Bad date: %s", raw_date)
        return None

    dep_iata = (row.get("DEP") or "").strip().upper() or None
    arr_iata = (row.get("ARR") or "").strip().upper() or None
    flight_number = (row.get("Flight Number") or "").strip() or None
    _reg_raw = (row.get("AC registration") or "").strip()
    # Normalise registrations without hyphen (e.g. SERPU → SE-RPU, LNNGK → LN-NGK)
    if _reg_raw and "-" not in _reg_raw and len(_reg_raw) >= 4:
        aircraft_reg = _reg_raw[:2] + "-" + _reg_raw[2:]
    else:
        aircraft_reg = _reg_raw or None
    ac_type_raw = (row.get("AC type") or "").strip()
    aircraft_type = AC_TYPE_MAP.get(ac_type_raw, ac_type_raw or None)

    dep_icao = _icao_from_iata(conn, dep_iata) if dep_iata else None
    arr_icao = _icao_from_iata(conn, arr_iata) if arr_iata else None

    off_block_utc = _parse_utc(row.get("Actual Off Block") or row.get("Off Block") or "")
    on_block_utc = _parse_utc(row.get("Actual On Block") or row.get("On Block") or "")

    block_secs = _hhmm_to_seconds(row.get("Block Duration") or row.get("Block Time (HH:mm)") or "")
    airborne_secs = _hhmm_to_seconds(row.get("Airborne Duration") or "")

    # PF identification — PF column holds employee ID
    pf_id = (row.get("PF") or "").strip()
    is_pf = pf_id == PILOT_ID

    # Takeoff = off_block time as proxy (Norwegian CSV has no separate Airborne col with same semantics)
    # Use off_block as takeoff, on_block as landing for night/TO/LDG computation
    takeoff_utc = off_block_utc  # best available proxy for Norwegian data
    landing_utc = on_block_utc

    # Coords
    dep_lat, dep_lon = _airport_coords(conn, dep_icao) if dep_icao else (None, None)
    arr_lat, arr_lon = _airport_coords(conn, arr_icao) if arr_icao else (None, None)

    # Night seconds
    ngt_secs = 0
    if takeoff_utc and landing_utc and dep_lat is not None and dep_lon is not None:
        ngt_secs = night_seconds(dep_lat, dep_lon, takeoff_utc, landing_utc, arr_lat, arr_lon)

    # All Norwegian flights are SIC regardless of PF
    crew_role = "first_officer"
    pic_seconds = 0
    sic_seconds = block_secs or 0

    # Personal T/O and landings only if PF
    tof_night = is_night_moment(dep_lat, dep_lon, takeoff_utc) if (is_pf and dep_lat and takeoff_utc) else False
    ldg_night = is_night_moment(arr_lat, arr_lon, landing_utc) if (is_pf and arr_lat and landing_utc) else False
    takeoffs_day = 1 if is_pf and not tof_night else 0
    takeoffs_night = 1 if is_pf and tof_night else 0
    landings_day = 1 if is_pf and not ldg_night else 0
    landings_night = 1 if is_pf and ldg_night else 0

    # Distance
    dist_nm = None
    if dep_lat and arr_lat:
        try:
            dist_nm = round(great_circle_nm(dep_lat, dep_lon, arr_lat, arr_lon), 1)
        except Exception:
            pass

    # Fuel — Norwegian provides kg values
    def _kg(key: str) -> float | None:
        v = (row.get(key) or "").strip()
        try:
            return float(v) if v else None
        except ValueError:
            return None

    fuel_burn_kg = _kg("Fuel Burn (kgs)")
    fuel_trip_kg = _kg("Actual Trip Fuel")
    fuel_uplift_kg = _kg("Fuel Uplift (kgs)")

    # Takeoff crew label
    pm_name = (row.get("PM Last Name") or "").strip()
    pf_name = (row.get("PF Last Name") or "").strip()
    takeoff_crew_label = pf_name or pf_id or None
    landing_crew_label = pf_name or pf_id or None

    flight_id = f"norwegian_{date_iso}_{flight_number}_{dep_iata}_{arr_iata}"

    return {
        "id": flight_id,
        "date": date_iso,
        "source": SOURCE,
        "raw_payload": json.dumps(dict(row), ensure_ascii=False),
        "dep_icao": dep_icao,
        "arr_icao": arr_icao,
        "dep_iata": dep_iata,
        "arr_iata": arr_iata,
        "off_block_utc": off_block_utc.isoformat() if off_block_utc else None,
        "takeoff_utc": takeoff_utc.isoformat() if takeoff_utc else None,
        "landing_utc": landing_utc.isoformat() if landing_utc else None,
        "on_block_utc": on_block_utc.isoformat() if on_block_utc else None,
        "block_seconds": block_secs,
        "airborne_seconds": airborne_secs,
        "flight_number": flight_number,
        "aircraft_reg": aircraft_reg,
        "aircraft_type": aircraft_type,
        "operator": OPERATOR,
        "crew_role": crew_role,
        "takeoff_crew": takeoff_crew_label,
        "landing_crew": landing_crew_label,
        "is_sim": 0,
        "sim_type": None,
        "pic_seconds": pic_seconds,
        "sic_seconds": sic_seconds,
        "night_seconds": ngt_secs,
        "ifr_seconds": block_secs or 0,  # commercial ops, all IFR
        "distance_nm": dist_nm,
        "pax_total": None,
        "pax_adult": None,
        "pax_child": None,
        "pax_infant": None,
        "freight_kg": None,
        "fuel_block_kg": None,
        "fuel_trip_kg": fuel_trip_kg,
        "fuel_reserves_kg": None,
        "fuel_uplift_kg": fuel_uplift_kg,
        "fuel_burn_kg": fuel_burn_kg,
        "fuel_burn_diff_kg": None,
        "delay_minutes": None,
        "delay_code": None,
        "delay_reason": None,
        "takeoffs_day": takeoffs_day,
        "takeoffs_night": takeoffs_night,
        "landings_day": landings_day,
        "landings_night": landings_night,
        "notes": None,
    }


INSERT_SQL = """
INSERT INTO flights (
    id, date, source, raw_payload,
    dep_icao, arr_icao, dep_iata, arr_iata,
    off_block_utc, takeoff_utc, landing_utc, on_block_utc,
    block_seconds, airborne_seconds,
    flight_number, aircraft_reg, aircraft_type, operator,
    crew_role, takeoff_crew, landing_crew, is_sim, sim_type,
    pic_seconds, sic_seconds, night_seconds, ifr_seconds, distance_nm,
    pax_total, pax_adult, pax_child, pax_infant, freight_kg,
    fuel_block_kg, fuel_trip_kg, fuel_reserves_kg, fuel_uplift_kg, fuel_burn_kg, fuel_burn_diff_kg,
    delay_minutes, delay_code, delay_reason,
    takeoffs_day, takeoffs_night, landings_day, landings_night,
    notes
) VALUES (
    :id, :date, :source, :raw_payload,
    :dep_icao, :arr_icao, :dep_iata, :arr_iata,
    :off_block_utc, :takeoff_utc, :landing_utc, :on_block_utc,
    :block_seconds, :airborne_seconds,
    :flight_number, :aircraft_reg, :aircraft_type, :operator,
    :crew_role, :takeoff_crew, :landing_crew, :is_sim, :sim_type,
    :pic_seconds, :sic_seconds, :night_seconds, :ifr_seconds, :distance_nm,
    :pax_total, :pax_adult, :pax_child, :pax_infant, :freight_kg,
    :fuel_block_kg, :fuel_trip_kg, :fuel_reserves_kg, :fuel_uplift_kg, :fuel_burn_kg, :fuel_burn_diff_kg,
    :delay_minutes, :delay_code, :delay_reason,
    :takeoffs_day, :takeoffs_night, :landings_day, :landings_night,
    :notes
)
"""


def _ensure_day(conn, date_str: str):
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))


def run(force: bool = False, csv_path: Path = DEFAULT_CSV) -> int:
    if not csv_path.exists():
        log.error("CSV not found: %s", csv_path)
        return 0

    conn = get_connection()
    inserted = skipped = errors = 0

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                record = _parse_row(row, conn)
            except Exception as e:
                log.warning("Parse error: %s", e)
                errors += 1
                continue

            if record is None:
                continue

            _ensure_day(conn, record["date"])

            if not force:
                exists = conn.execute(
                    "SELECT 1 FROM flights WHERE id = ?", (record["id"],)
                ).fetchone()
                if exists:
                    skipped += 1
                    continue

            sql = INSERT_SQL.replace("INSERT INTO", "INSERT OR REPLACE INTO") if force else INSERT_SQL
            try:
                conn.execute(sql, record)
                inserted += 1
            except Exception as e:
                log.warning("Insert error %s: %s", record["id"], e)
                errors += 1

    conn.commit()
    conn.close()
    log.info("Norwegian import done: %d inserted, %d skipped, %d errors", inserted, skipped, errors)
    return inserted


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-import all rows (upsert)")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to CSV")
    args = parser.parse_args()
    run(force=args.force, csv_path=args.csv)
