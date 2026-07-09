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
from collections import defaultdict
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


def _captain_from_verified(verified: str) -> str | None:
    """Extract 6-letter captain crew code from 'CAPTCP , CP , YYYY/MM/DD HH:MM'."""
    v = (verified or "").strip()
    if not v or v.upper() == "NOT VERIFIED":
        return None
    code = v.split(",")[0].strip()
    if len(code) == 6 and code.isalpha() and code.upper() != PILOT_CODE.upper():
        return code.upper()
    return None


def _build_captain_index(rows: list[dict]) -> dict[tuple, str]:
    """
    Build a mapping of (date, registration) → captain crew code.

    Resolution order:
    1. Verified By on same date+registration rows
    2. Non-FARMIQ crew code in Take Off / Landing on same date+registration rows
    3. Verified By anywhere on same date (split operations: FARMIQ on different aircraft)
    4. Non-FARMIQ crew code anywhere on same date
    """
    by_day_reg: dict[tuple, list[dict]] = defaultdict(list)
    by_date: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        date = row["Date"].strip()
        reg = (row.get("Registration") or "").strip()
        by_day_reg[(date, reg)].append(row)
        by_date[date].append(row)

    def _resolve(group: list[dict]) -> str | None:
        # Verified By first
        for row in group:
            cap = _captain_from_verified(row.get("Verified By", ""))
            if cap:
                return cap
        # Non-FARMIQ crew code
        for row in group:
            for col in ("Take Off", "Landing"):
                c = (row.get(col) or "").strip().upper()
                if c and c != PILOT_CODE.upper() and len(c) == 6 and c.isalpha():
                    return c
        return None

    index: dict[tuple, str] = {}
    # First pass: same date+reg
    for key, group in by_day_reg.items():
        cap = _resolve(group)
        if cap:
            index[key] = cap

    # Second pass: date-level fallback for FARMIQ rows still missing a captain
    # (split ops: FARMIQ and captain on different aircraft same day)
    for row in rows:
        date = row["Date"].strip()
        reg = (row.get("Registration") or "").strip()
        key = (date, reg)
        if key in index:
            continue
        to_ = (row.get("Take Off") or "").strip().upper()
        ldg = (row.get("Landing") or "").strip().upper()
        if PILOT_CODE.upper() not in (to_, ldg):
            continue  # not a FARMIQ row, skip
        cap = _resolve(by_date[date])
        if cap:
            index[key] = cap

    return index


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


def _roll_midnight(*times: datetime | None) -> list[datetime | None]:
    """
    Given event times in chronological order (some may be None), add +1 day to
    any event that is earlier than the latest event before it (midnight crossing).
    """
    from datetime import timedelta

    result: list[datetime | None] = []
    latest: datetime | None = None
    for t in times:
        if t is not None:
            if latest is not None:
                while t < latest:
                    t += timedelta(days=1)
            latest = t
        result.append(t)
    return result


def _is_night_time(dt_utc: datetime | None, lat: float | None, lon: float | None) -> bool:
    """Return True if the given UTC time is at night at the given coordinates."""
    if dt_utc is None or lat is None or lon is None:
        return False
    return is_night_moment(lat, lon, dt_utc)


def _parse_row(row: dict, date_iso: str, fleet: dict[str, str], captain_index: dict | None = None,
               iata_lookup: dict[str, tuple] | None = None) -> dict:
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

    # Some source rows carry only the IATA code (e.g. Berlin "BER") with a blank
    # ICAO column and no coords. Resolve ICAO + coords from the airports table so
    # night time and distance can still be computed.
    if iata_lookup:
        if dep_icao is None and dep_iata and dep_iata in iata_lookup:
            dep_icao, la, lo = iata_lookup[dep_iata]
            if dep_lat is None:
                dep_lat, dep_lon = la, lo
        if arr_icao is None and arr_iata and arr_iata in iata_lookup:
            arr_icao, la, lo = iata_lookup[arr_iata]
            if arr_lat is None:
                arr_lat, arr_lon = la, lo
    flight_number = (row.get("FlightNumber") or "").strip() or None
    aircraft_reg = (row.get("Registration") or "").strip() or None

    off_block_utc = _local_to_utc(date_iso, row.get("Off Block"), dep_tz)
    on_block_utc = _local_to_utc(date_iso, row.get("On Block"), arr_tz)
    # Airborne = actual takeoff time (HH:MM local dep)
    takeoff_utc = _local_to_utc(date_iso, row.get("Airborne"), dep_tz)
    # Landed = actual landing time (HH:MM local arr)
    landing_utc = _local_to_utc(date_iso, row.get("Landed"), arr_tz)

    # All times come from the same calendar date, so a flight crossing midnight
    # UTC ends up with landing/on-block *before* takeoff. Roll each event
    # forward a day until the sequence off_block → takeoff → landing → on_block
    # is chronological.
    off_block_utc, takeoff_utc, landing_utc, on_block_utc = _roll_midnight(
        off_block_utc, takeoff_utc, landing_utc, on_block_utc
    )

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

    # Captain crew code — always the non-FARMIQ pilot (signs the tech log)
    raw_date = row.get("Date", "").strip()
    reg = (row.get("Registration") or "").strip()
    captain_code = None
    if captain_index is not None:
        captain_code = captain_index.get((raw_date, reg))
    if not captain_code:
        captain_code = _captain_from_verified(row.get("Verified By", ""))

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
        "pic_name": captain_code,
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
    crew_role, takeoff_crew, landing_crew, pic_name, is_sim, sim_type,
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
    :crew_role, :takeoff_crew, :landing_crew, :pic_name, :is_sim, :sim_type,
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

    # IATA → (ICAO, lat, lon) for rows that carry only the IATA code
    iata_lookup: dict[str, tuple] = {
        r["iata"]: (r["icao"], r["latitude"], r["longitude"])
        for r in conn.execute(
            "SELECT icao, iata, latitude, longitude FROM airports WHERE iata IS NOT NULL AND iata != ''"
        ).fetchall()
    }

    # Pre-load all rows to build the captain index (needs full day context)
    with open(csv_path, newline="", encoding="utf-8") as f:
        all_rows = list(csv.DictReader(f))
    captain_index = _build_captain_index(all_rows)
    log.info("Captain index built: %d day/reg combinations", len(captain_index))

    for row in all_rows:
        raw_date = (row.get("Date") or "").strip()
        if not raw_date:
            continue
        # Normalise YYYY/MM/DD → YYYY-MM-DD
        date_iso = raw_date.replace("/", "-")

        try:
            record = _parse_row(row, date_iso, fleet, captain_index, iata_lookup)
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
