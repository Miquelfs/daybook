"""
Import Full.csv (previous airline operational export) into the flights table.

Crew-role derivation:
  - All flights before 2024-09-01: crew_role = 'first_officer', pic_seconds = 0
  - From 2024-09-01 onward:
      FARMIQ in Take Off OR Landing → crew_role = 'pic', pic_seconds = block_seconds
      Otherwise                     → crew_role = 'first_officer', pic_seconds = 0

Personal takeoffs/landings:
  - takeoffs_day/night: +1 when FARMIQ in 'Take Off' column (day/night from actual takeoff UTC)
  - landings_day/night: +1 when FARMIQ in 'Landing' column (day/night from actual landing UTC)

Night split: computed via astral using departure airport coordinates.

Usage:
    python -m domains.aviation.importers.full_csv_importer [--force]
"""

import argparse
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).parents[3]
CSV_PATH = ROOT / "data" / "raw" / "aviation" / "Full.csv"
FLEET_CSV = ROOT / "data" / "raw" / "aviation" / "ryanair_fleet.csv"

from domains.aviation.aviation_config import PILOT_CODE, PIC_START_DATE, DEFAULT_OPERATOR
from domains.aviation.compute import great_circle_nm, night_seconds, is_night_moment, hhmm_to_seconds
from infrastructure.db.connection import get_connection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _load_fleet() -> dict[str, str]:
    """Return {registration: aircraft_type} from ryanair_fleet.csv."""
    fleet: dict[str, str] = {}
    if not FLEET_CSV.exists():
        return fleet
    with open(FLEET_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            reg = (row.get("Registration") or "").strip()
            typ = (row.get("Aircraft Type") or "").strip()
            if reg and typ:
                fleet[reg] = typ
    return fleet


def _local_to_utc(date_str: str, time_hhmm: str, tz_name: str) -> datetime | None:
    """Convert a local date+HH:MM to a UTC datetime. Returns None on failure."""
    if not time_hhmm or ":" not in time_hhmm:
        return None
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception):
        tz = timezone.utc
    try:
        h, m = time_hhmm.strip().split(":")
        dt_local = datetime(
            int(date_str[:4]),
            int(date_str[5:7]),
            int(date_str[8:10]),
            int(h),
            int(m),
            tzinfo=tz,
        )
        return dt_local.astimezone(timezone.utc)
    except Exception:
        return None


def _is_night_time(dt_utc: datetime | None, lat: float | None, lon: float | None) -> bool:
    """Return True if the given UTC time is at night at the given coordinates."""
    if dt_utc is None or lat is None or lon is None:
        return False
    return is_night_moment(lat, lon, dt_utc)


def _parse_row(row: dict, date_iso: str, fleet: dict[str, str]) -> dict:
    """Map one Full.csv row to a canonical flights dict."""
    dep_tz = (row.get("Region_x") or "UTC").strip() or "UTC"
    arr_tz = (row.get("Region_y") or "UTC").strip() or "UTC"

    try:
        dep_lat = float(row["Latitude_x"]) if row.get("Latitude_x") else None
        dep_lon = float(row["Longitude_x"]) if row.get("Longitude_x") else None
        arr_lat = float(row["Latitude_y"]) if row.get("Latitude_y") else None
        arr_lon = float(row["Longitude_y"]) if row.get("Longitude_y") else None
    except (ValueError, KeyError):
        dep_lat = dep_lon = arr_lat = arr_lon = None

    dep_icao = (row.get("ICAO Code Origin") or row.get("ICAO Code_x") or "").strip() or None
    arr_icao = (row.get("ICAO Code Destination") or row.get("ICAO Code_y") or "").strip() or None
    dep_iata = (row.get("Origin") or "").strip() or None
    arr_iata = (row.get("Destination") or "").strip() or None
    flight_number = (row.get("FlightNumber") or "").strip() or None
    aircraft_reg = (row.get("Registration") or "").strip() or None

    off_block_utc = _local_to_utc(date_iso, row.get("Off Block"), dep_tz)
    on_block_utc = _local_to_utc(date_iso, row.get("On Block"), arr_tz)
    # Airborne = actual takeoff time (HH:MM local dep)
    takeoff_utc = _local_to_utc(date_iso, row.get("Airborne"), dep_tz)
    # Landed = actual landing time (HH:MM local arr)
    landing_utc = _local_to_utc(date_iso, row.get("Landed"), arr_tz)

    block_seconds = hhmm_to_seconds(row.get("Total Block"))
    airborne_seconds = hhmm_to_seconds(row.get("Total flight"))

    # Crew codes for the manoeuvres
    takeoff_crew = (row.get("Take Off") or "").strip() or None
    landing_crew = (row.get("Landing") or "").strip() or None

    # Crew role derivation
    pic_start = PIC_START_DATE  # "2024-09-01"
    farmiq_handled = (
        (takeoff_crew or "").upper() == PILOT_CODE.upper()
        or (landing_crew or "").upper() == PILOT_CODE.upper()
    )
    if date_iso < pic_start:
        crew_role = "first_officer"
        pic_seconds = 0
        sic_seconds = block_seconds or 0
    elif farmiq_handled:
        crew_role = "pic"
        pic_seconds = block_seconds or 0
        sic_seconds = 0
    else:
        crew_role = "first_officer"
        pic_seconds = 0
        sic_seconds = block_seconds or 0

    # Personal takeoffs
    farmiq_took_off = (takeoff_crew or "").upper() == PILOT_CODE.upper()
    farmiq_landed = (landing_crew or "").upper() == PILOT_CODE.upper()
    # Takeoff darkness checked at departure airport; landing darkness at arrival airport
    tof_night = _is_night_time(takeoff_utc, dep_lat, dep_lon) if farmiq_took_off else False
    ldg_night = _is_night_time(landing_utc, arr_lat, arr_lon) if farmiq_landed else False

    takeoffs_day = 1 if farmiq_took_off and not tof_night else 0
    takeoffs_night = 1 if farmiq_took_off and tof_night else 0
    landings_day = 1 if farmiq_landed and not ldg_night else 0
    landings_night = 1 if farmiq_landed and ldg_night else 0

    # Night seconds for the flight leg — use both dep and arr coords for accuracy
    ngt_secs = 0
    if takeoff_utc and landing_utc and dep_lat is not None and dep_lon is not None:
        ngt_secs = night_seconds(dep_lat, dep_lon, takeoff_utc, landing_utc, arr_lat, arr_lon)

    # Distance
    dist_nm = None
    if dep_lat is not None and arr_lat is not None:
        try:
            dist_nm = round(great_circle_nm(dep_lat, dep_lon, arr_lat, arr_lon), 1)
        except Exception:
            pass

    # Aircraft type from fleet lookup
    aircraft_type = fleet.get(aircraft_reg or "", None) or None

    # Fuel
    def _kg(key: str) -> float | None:
        v = row.get(key, "").strip()
        try:
            return float(v) if v else None
        except ValueError:
            return None

    # Delay
    delay_min: int | None = None
    delay_raw = (row.get("Delay Time 1") or "").strip()
    if delay_raw and ":" in delay_raw:
        try:
            dh, dm = delay_raw.split(":")
            delay_min = int(dh) * 60 + int(dm)
        except Exception:
            pass
    delay_code = (row.get("Delay Code 1") or "").strip() or None
    delay_reason = None  # "Reason For Extra Fuel" column is not a delay reason

    # Pax
    def _int(key: str) -> int | None:
        v = row.get(key, "").strip()
        try:
            return int(float(v)) if v else None
        except ValueError:
            return None

    flight_id = f"full_csv_{date_iso}_{flight_number}_{dep_icao}_{arr_icao}"

    return {
        "id": flight_id,
        "date": date_iso,
        "source": "full_csv",
        "raw_payload": json.dumps(dict(row), ensure_ascii=False),
        "dep_icao": dep_icao,
        "arr_icao": arr_icao,
        "dep_iata": dep_iata,
        "arr_iata": arr_iata,
        "off_block_utc": off_block_utc.isoformat() if off_block_utc else None,
        "takeoff_utc": takeoff_utc.isoformat() if takeoff_utc else None,
        "landing_utc": landing_utc.isoformat() if landing_utc else None,
        "on_block_utc": on_block_utc.isoformat() if on_block_utc else None,
        "block_seconds": block_seconds,
        "airborne_seconds": airborne_seconds,
        "flight_number": flight_number,
        "aircraft_reg": aircraft_reg,
        "aircraft_type": aircraft_type,
        "operator": DEFAULT_OPERATOR,
        "crew_role": crew_role,
        "takeoff_crew": takeoff_crew,
        "landing_crew": landing_crew,
        "is_sim": 0,
        "sim_type": None,
        "pic_seconds": pic_seconds,
        "sic_seconds": sic_seconds,
        "night_seconds": ngt_secs,
        "ifr_seconds": block_seconds or 0,  # all commercial ops are IFR
        "distance_nm": dist_nm,
        "pax_total": _int("Actual Pax"),
        "pax_adult": _int("Adult"),
        "pax_child": _int("Child"),
        "pax_infant": _int("Infant"),
        "freight_kg": _kg("Freight"),
        "fuel_block_kg": _kg("Block"),
        "fuel_trip_kg": _kg("Trip+Taxi"),
        "fuel_reserves_kg": _kg("Reserves"),
        "fuel_uplift_kg": _kg("Uplift"),
        "fuel_burn_kg": _kg("Burn Off"),
        "fuel_burn_diff_kg": _kg("Burn Diff"),
        "delay_minutes": delay_min,
        "delay_code": delay_code,
        "delay_reason": delay_reason,
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
    conn.execute(
        "INSERT OR IGNORE INTO days (date) VALUES (?)",
        (date_str,),
    )


def run(force: bool = False, csv_path: Path = CSV_PATH) -> int:
    fleet = _load_fleet()
    conn = get_connection()
    inserted = skipped = errors = 0

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_date = (row.get("Date") or "").strip()
            if not raw_date:
                continue
            # Normalise YYYY/MM/DD → YYYY-MM-DD
            date_iso = raw_date.replace("/", "-")

            try:
                record = _parse_row(row, date_iso, fleet)
            except Exception as e:
                log.warning("Parse error on %s: %s", raw_date, e)
                errors += 1
                continue

            _ensure_day(conn, date_iso)

            if not force:
                exists = conn.execute(
                    "SELECT 1 FROM flights WHERE id = ?", (record["id"],)
                ).fetchone()
                if exists:
                    skipped += 1
                    continue

            try:
                conn.execute(
                    INSERT_SQL if not force else INSERT_SQL.replace("INSERT INTO", "INSERT OR REPLACE INTO"),
                    record,
                )
                inserted += 1
            except Exception as e:
                log.warning("Insert error on %s: %s", record["id"], e)
                errors += 1

    conn.commit()
    conn.close()
    log.info("Done: %d inserted, %d skipped, %d errors", inserted, skipped, errors)
    return inserted


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import Full.csv into flights table")
    parser.add_argument("--force", action="store_true", help="Overwrite existing rows")
    parser.add_argument("--csv", default=str(CSV_PATH), help="Path to Full.csv")
    args = parser.parse_args()
    run(force=args.force, csv_path=Path(args.csv))
