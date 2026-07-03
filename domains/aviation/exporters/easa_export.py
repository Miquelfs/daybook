"""
EASA Part-FCL.050 logbook CSV export.

Column order is defined by regulation. All times in HH:MM format.
B737 commercial airline operations → MP (multi-pilot) column.
"""

import csv
import io
import sqlite3

from domains.aviation.aviation_config import EASA_COLUMNS


def _sec_to_hhmm(seconds: int | None) -> str:
    if not seconds:
        return ""
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h}:{m:02d}"


def _extract_hhmm(value: str | None) -> str:
    """Extract HH:MM from either 'HH:MM' or ISO 'YYYY-MM-DDTHH:MM[:SS]'."""
    if not value:
        return ""
    # ISO datetime: take characters 11-16
    if len(value) > 5:
        return value[11:16]
    return value


def _format_pic_name(raw: str | None, is_pic: bool) -> str:
    """
    PIC name column: always the captain/commander.
    - If pic_name is set → format it (crew code kept as-is; full name → F.SURNAME)
    - Solo school flights (no pic_name, is_pic) → 'SELF'
    """
    if raw:
        s = raw.strip()
        # 6-letter airline crew code → keep as-is
        if len(s) == 6 and s.isalpha():
            return s.upper()
        parts = s.split()
        if len(parts) == 1:
            return parts[0].upper()
        return f"{parts[0][0].upper()}.{' '.join(parts[1:]).upper()}"
    if is_pic:
        return "SELF"
    return ""


def generate_easa_csv(conn: sqlite3.Connection) -> str:
    rows = conn.execute("""
        SELECT f.*,
               a1.name AS dep_name, a1.iata AS dep_iata_a,
               a2.name AS arr_name, a2.iata AS arr_iata_a
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.is_sim = 0
        ORDER BY f.date, f.off_block_utc
    """).fetchall()

    sim_rows = conn.execute("""
        SELECT * FROM flights WHERE is_sim = 1 ORDER BY date
    """).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(EASA_COLUMNS)

    for r in rows:
        # Departure/arrival time — stored as ISO datetime or plain HH:MM
        dep_time = _extract_hhmm(r["off_block_utc"])
        arr_time = _extract_hhmm(r["on_block_utc"])

        dep_place = r["dep_icao"] or r["dep_iata"] or ""
        arr_place = r["arr_icao"] or r["arr_iata"] or ""

        # Aircraft model — strip to type designation
        model = r["aircraft_type"] or ""
        reg = r["aircraft_reg"] or ""

        # Time columns
        total_time = _sec_to_hhmm(r["block_seconds"])
        mp_time = _sec_to_hhmm(r["block_seconds"])  # airline = always MP
        pic_time = _sec_to_hhmm(r["pic_seconds"])
        sic_time = _sec_to_hhmm(r["sic_seconds"])
        night_time = _sec_to_hhmm(r["night_seconds"])
        # For multi-pilot ops (airline), IFR time = block time (always IFR-rated operations)
        ifr_time = total_time if mp_time else _sec_to_hhmm(r["ifr_seconds"])

        name_of_pic = _format_pic_name(r["pic_name"], r["crew_role"] == "pic")

        writer.writerow([
            r["date"],              # Date
            dep_place,              # Departure Place
            dep_time,               # Departure Time
            arr_place,              # Arrival Place
            arr_time,               # Arrival Time
            model,                  # Aircraft Model
            reg,                    # Registration
            "",                     # SP SE
            "",                     # SP ME
            mp_time,                # MP
            total_time,             # Total Time
            name_of_pic,            # Name of PIC
            r["takeoffs_day"] or 0, # T/O Day
            r["takeoffs_night"] or 0, # T/O Night
            r["landings_day"] or 0, # Ldg Day
            r["landings_night"] or 0, # Ldg Night
            night_time,             # Night
            ifr_time,               # IFR
            pic_time,               # PIC
            sic_time,               # CoPilot
            "",                     # Dual
            "",                     # Instructor
            "",                     # FSTD Date
            "",                     # FSTD Type
            "",                     # FSTD Total
            r["remarks"] if "remarks" in r.keys() and r["remarks"] else (r["notes"] or ""),  # Remarks
        ])

    # FSTD / Simulator rows
    for r in sim_rows:
        writer.writerow([
            r["date"], "", "", "", "", "", "",
            "", "", "", "",
            "",
            0, 0, 0, 0, "", "",
            "", "", "", "",
            r["date"],                          # FSTD Date
            r["sim_type"] or "",                # FSTD Type
            _sec_to_hhmm(r["block_seconds"]),   # FSTD Total
            r["notes"] or "",
        ])

    return buf.getvalue()
