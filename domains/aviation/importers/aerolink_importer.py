"""
Import Aerolink.xls (Flylogs export, pre-2024) into the flights table.

The XLS is a BIFF8 file. Columns follow the EASA Part-FCL.050 format exactly.
Times are stored as HH:MM strings. Dates are ISO strings (YYYY-MM-DD).

The file covers training (DA-20 SE, 2018–2022) and simulator sessions.
No original airline source data — crew role is read directly from the PIC/SIC/Dual columns.

Usage:
    python -m domains.aviation.importers.aerolink_importer [--force]
"""

import argparse
import json
import logging
from pathlib import Path

ROOT = Path(__file__).parents[3]
XLS_PATH = ROOT / "data" / "raw" / "aviation" / "Aerolink.xls"

from infrastructure.db.connection import get_connection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# Column indices (0-based)
COL_DATE       = 0
COL_DEP        = 1
COL_DEP_TIME   = 2
COL_ARR        = 3
COL_ARR_TIME   = 4
COL_ACFT_TYPE  = 5
COL_ACFT_REG   = 6
COL_SP_SE      = 7
COL_SP_ME      = 8
COL_MP         = 9
COL_TOTAL      = 10
COL_FLIGHT     = 11
COL_NAME_PIC   = 12
COL_NAME_SIC   = 13
COL_LANDINGS   = 14
COL_NIGHT      = 15
COL_IFR        = 16
COL_SIM        = 17
COL_FUNC_PIC   = 18
COL_FUNC_SIC   = 19
COL_FUNC_DUAL  = 20
COL_FUNC_FI    = 21
COL_REMARKS    = 23


def _hhmm_to_sec(val) -> int:
    """Convert 'HH:MM' string or empty to seconds."""
    if not val or not isinstance(val, str) or ":" not in val:
        return 0
    try:
        parts = val.strip().split(":")
        return int(parts[0]) * 3600 + int(parts[1]) * 60
    except (ValueError, IndexError):
        return 0


def _parse_row(row: list, row_index: int) -> dict | None:
    date_val = str(row[COL_DATE] or "").strip()
    if not date_val or date_val == "GENERIC STAT" or not date_val[0].isdigit():
        return None

    dep_icao = str(row[COL_DEP] or "").strip().upper() or None
    arr_icao = str(row[COL_ARR] or "").strip().upper() or None

    total_sec  = _hhmm_to_sec(row[COL_TOTAL])
    flight_sec = _hhmm_to_sec(row[COL_FLIGHT])
    night_sec  = _hhmm_to_sec(row[COL_NIGHT])
    ifr_sec    = _hhmm_to_sec(row[COL_IFR])
    pic_sec    = _hhmm_to_sec(row[COL_FUNC_PIC])
    sic_sec    = _hhmm_to_sec(row[COL_FUNC_SIC])
    dual_sec   = _hhmm_to_sec(row[COL_FUNC_DUAL])

    acft_type = str(row[COL_ACFT_TYPE] or "").strip() or None
    acft_reg  = str(row[COL_ACFT_REG]  or "").strip() or None

    name_pic_raw = str(row[COL_NAME_PIC] or "").strip() or None

    # Determine is_sim and crew_role
    sim_type_raw = str(row[COL_SIM] or "").strip()
    # Aircraft like "ELITE SIMULATION" with empty times are sim sessions
    is_sim = bool(sim_type_raw) or (acft_type and "SIMULAT" in acft_type.upper())
    sim_type = sim_type_raw or (acft_type if is_sim else None)

    if pic_sec > 0:
        crew_role = "pic"
    elif sic_sec > 0:
        crew_role = "first_officer"
    elif dual_sec > 0:
        crew_role = "first_officer"  # under dual instruction = right seat student
    else:
        crew_role = None

    # Landings
    try:
        ldg_total = int(float(row[COL_LANDINGS] or 0))
    except (ValueError, TypeError):
        ldg_total = 0

    # Night landings approximation: if night time > 0 and has landings, attribute all to night
    # (Aerolink doesn't split day/night landings)
    ldg_day = ldg_total if night_sec == 0 else 0
    ldg_night = ldg_total if night_sec > 0 else 0

    dep_time = str(row[COL_DEP_TIME] or "").strip() or None
    arr_time = str(row[COL_ARR_TIME] or "").strip() or None

    # Build off_block_utc from date + time (stored as local, no timezone info)
    off_block_utc = f"{date_val}T{dep_time}:00Z" if dep_time and ":" in dep_time else None
    on_block_utc  = f"{date_val}T{arr_time}:00Z" if arr_time and ":" in arr_time else None

    flight_id = f"aerolink_{date_val}_{dep_icao}_{arr_icao}_{row_index}"

    remarks = str(row[COL_REMARKS] or "").strip() or None

    raw = {
        "date": date_val, "dep": dep_icao, "arr": arr_icao,
        "total": str(row[COL_TOTAL]), "pic": str(row[COL_FUNC_PIC]),
        "sic": str(row[COL_FUNC_SIC]), "dual": str(row[COL_FUNC_DUAL]),
        "acft": acft_type, "reg": acft_reg,
    }

    return {
        "id": flight_id,
        "date": date_val,
        "source": "aerolink",
        "raw_payload": json.dumps(raw),
        "dep_icao": dep_icao,
        "arr_icao": arr_icao,
        "dep_iata": None,
        "arr_iata": None,
        "off_block_utc": off_block_utc,
        "takeoff_utc": off_block_utc,
        "landing_utc": on_block_utc,
        "on_block_utc": on_block_utc,
        "block_seconds": total_sec,
        "airborne_seconds": flight_sec or total_sec,
        "flight_number": None,
        "aircraft_reg": acft_reg,
        "aircraft_type": acft_type,
        "operator": None,
        "crew_role": crew_role,
        "takeoff_crew": None,
        "landing_crew": None,
        "is_sim": int(is_sim),
        "sim_type": sim_type if is_sim else None,
        "pic_seconds": pic_sec,
        "sic_seconds": sic_sec,
        "night_seconds": night_sec,
        "ifr_seconds": ifr_sec,
        "distance_nm": None,
        "pax_total": None,
        "pax_adult": None,
        "pax_child": None,
        "pax_infant": None,
        "freight_kg": None,
        "fuel_block_kg": None,
        "fuel_trip_kg": None,
        "fuel_reserves_kg": None,
        "fuel_uplift_kg": None,
        "fuel_burn_kg": None,
        "fuel_burn_diff_kg": None,
        "delay_minutes": None,
        "delay_code": None,
        "delay_reason": None,
        "takeoffs_day": ldg_day,   # Aerolink doesn't record T/O separately — use landings
        "takeoffs_night": ldg_night,
        "landings_day": ldg_day,
        "landings_night": ldg_night,
        "notes": remarks,
        # pic_name: the instructor/PIC when we are not the PIC (skip when Miquel is PIC)
        "pic_name": None if (pic_sec > 0 or not name_pic_raw or "farre" in name_pic_raw.lower()) else name_pic_raw,
    }


INSERT_SQL = """
INSERT OR IGNORE INTO flights (
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


def run(force: bool = False, xls_path: Path = XLS_PATH) -> int:
    try:
        import xlrd
    except ImportError:
        log.error("xlrd is required: pip install xlrd")
        return 0

    wb = xlrd.open_workbook(str(xls_path))
    ws = wb.sheet_by_index(0)
    conn = get_connection()
    inserted = skipped = errors = 0

    for i in range(1, ws.nrows):
        row_vals = ws.row_values(i)
        try:
            record = _parse_row(row_vals, i)
        except Exception as e:
            log.warning("Parse error on row %d: %s", i, e)
            errors += 1
            continue

        if record is None:
            continue

        conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (record["date"],))

        if not force:
            exists = conn.execute("SELECT 1 FROM flights WHERE id=?", (record["id"],)).fetchone()
            if exists:
                skipped += 1
                continue

        if force:
            conn.execute("DELETE FROM flights WHERE id=?", (record["id"],))

        try:
            conn.execute(INSERT_SQL, record)
            inserted += 1
        except Exception as e:
            log.warning("Insert error on row %d: %s", i, e)
            errors += 1

    conn.commit()
    conn.close()
    log.info("Done: %d inserted, %d skipped, %d errors", inserted, skipped, errors)
    return inserted


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import Aerolink.xls into flights table")
    parser.add_argument("--force", action="store_true", help="Overwrite existing rows")
    args = parser.parse_args()
    run(force=args.force)
