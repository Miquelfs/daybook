"""
Roster API — PDF upload and monthly/daily views.

POST /roster/upload          multipart PDF → parse + upsert
GET  /roster                 ?month=YYYY-MM → list of RosterDay rows
GET  /roster/months          → list of distinct YYYY-MM periods available
GET  /roster/day/{date}      → full day detail (roster row + legs with crew)
GET  /roster/day/{date}/brief → lightweight duty summary (or null)
GET  /roster/pay-estimate    ?month=YYYY-MM&category=FO&level=4 → CLA pay breakdown
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

from typing import Literal, Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, HTTPException, UploadFile, File, Query


class RosterEntryIn(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    duty_type: Literal["FLT", "SBY", "OFF", "LVO", "GRD", "TRN", "VAC", "SICK", "OTHER"]
    report_time: Optional[str] = None   # "HH:MM"
    end_time: Optional[str] = None      # "HH:MM"
    raw_code: Optional[str] = None


class RosterEntryPatch(BaseModel):
    duty_type: Optional[Literal["FLT", "SBY", "OFF", "LVO", "GRD", "TRN", "VAC", "SICK", "OTHER"]] = None
    report_time: Optional[str] = None
    end_time: Optional[str] = None
    raw_code: Optional[str] = None

from infrastructure.db.connection import DB_PATH, get_connection

router = APIRouter(prefix="/roster", tags=["roster"])


def _get_conn() -> sqlite3.Connection:
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    return conn


@router.post("/upload")
async def upload_roster(file: UploadFile = File(...)):
    """Accept a PDF duty plan, parse it, upsert into DB."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "File must be a PDF")

    contents = await file.read()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        from domains.aviation.roster_importer import parse_pdf, upsert_roster
        period, days, legs = parse_pdf(tmp_path)
        count = upsert_roster(days, legs, DB_PATH)
    except Exception as e:
        raise HTTPException(422, f"Parse error: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"period": period, "imported": count, "legs": len(legs) if 'legs' in dir() else 0}


@router.get("/months")
def get_roster_months():
    """Return list of YYYY-MM strings that have roster data."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT DISTINCT strftime('%Y-%m', date) AS month FROM roster ORDER BY month"
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()

    return [r["month"] for r in rows]


@router.get("/day/{date}/brief")
def get_roster_day_brief(date: str):
    """Return lightweight duty summary for a date, or null if no roster."""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT duty_type, report_time, end_time, raw_code FROM roster WHERE date = ?",
            (date,),
        ).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()

    if not row:
        return None
    return dict(row)


@router.get("/day/{date}")
def get_roster_day(date: str):
    """Return full day detail: roster row + legs with crew."""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT date, duty_type, report_time, end_time, raw_code FROM roster WHERE date = ?",
            (date,),
        ).fetchone()

        if not row:
            raise HTTPException(404, f"No roster for {date}")

        result = dict(row)

        try:
            leg_rows = conn.execute(
                """
                SELECT flight_number, dep_iata, arr_iata, dep_time, arr_time,
                       aircraft_type, cockpit_crew, cabin_crew, leg_order
                FROM roster_legs
                WHERE date = ?
                ORDER BY leg_order
                """,
                (date,),
            ).fetchall()
        except sqlite3.OperationalError:
            leg_rows = []

        result["legs"] = [
            {
                "flight_number": lr["flight_number"],
                "dep_iata": lr["dep_iata"],
                "arr_iata": lr["arr_iata"],
                "dep_time": lr["dep_time"],
                "arr_time": lr["arr_time"],
                "aircraft_type": lr["aircraft_type"],
                "cockpit_crew": json.loads(lr["cockpit_crew"] or "[]"),
                "cabin_crew": json.loads(lr["cabin_crew"] or "[]"),
                "leg_order": lr["leg_order"],
            }
            for lr in leg_rows
        ]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        conn.close()

    return result


@router.get("")
def get_roster(month: str = Query(..., description="YYYY-MM")):
    """Return all roster rows for a given month."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT date, duty_type, report_time, end_time, raw_code, imported_at "
            "FROM roster WHERE strftime('%Y-%m', date) = ? ORDER BY date",
            (month,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()

    return [dict(r) for r in rows]


@router.post("", status_code=201)
def create_roster_entry(body: RosterEntryIn):
    """Manually add or overwrite a single roster entry."""
    conn = _get_conn()
    try:
        conn.execute(
            """INSERT INTO roster (date, duty_type, report_time, end_time, raw_code, imported_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(date) DO UPDATE SET
                 duty_type   = excluded.duty_type,
                 report_time = excluded.report_time,
                 end_time    = excluded.end_time,
                 raw_code    = excluded.raw_code,
                 imported_at = excluded.imported_at""",
            (body.date, body.duty_type, body.report_time, body.end_time, body.raw_code),
        )
        conn.commit()
        row = conn.execute(
            "SELECT date, duty_type, report_time, end_time, raw_code FROM roster WHERE date=?",
            (body.date,),
        ).fetchone()
    finally:
        conn.close()
    return dict(row)


@router.patch("/{date}")
def patch_roster_entry(date: str, body: RosterEntryPatch):
    """Update fields on an existing roster entry."""
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM roster WHERE date=?", (date,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No roster entry for that date")
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if updates:
            set_clause = ", ".join(f"{k}=?" for k in updates)
            conn.execute(f"UPDATE roster SET {set_clause} WHERE date=?", [*updates.values(), date])
            conn.commit()
        row = conn.execute(
            "SELECT date, duty_type, report_time, end_time, raw_code FROM roster WHERE date=?",
            (date,),
        ).fetchone()
    finally:
        conn.close()
    return dict(row)


@router.delete("/{date}", status_code=204)
def delete_roster_entry(date: str):
    """Delete a manually-added roster entry."""
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM roster WHERE date=?", (date,))
        conn.commit()
    finally:
        conn.close()


# ── CLA pay tables (Norwegian Spain, 2025) ────────────────────────────────────
# Source: Appendix C, Table C.1

_BASE_SALARY_2025 = {
    # (category, level) → monthly gross base salary (€)
    ("CPT", 10): 11529.58, ("CPT", 9): 11195.75, ("CPT", 8): 10845.45,
    ("CPT", 7): 10530.78,  ("CPT", 6): 10225.28,  ("CPT", 5): 9928.67,
    ("CPT", 4): 9640.71,   ("CPT", 3): 9319.31,   ("CPT", 2): 9047.87,
    ("CPT", 1): 8784.34,
    ("FO",  10): 5631.08,  ("FO",  9): 5522.00,  ("FO",  8): 5388.88,
    ("FO",  7): 5284.04,   ("FO",  6): 5181.25,  ("FO",  5): 5080.48,
    ("FO",  4): 4981.68,   ("FO",  3): 3716.31,  ("FO",  2): 3642.44,
    ("FO",  1): 3570.65,
}

_FIXED_2025 = {
    "FO":  {"phone": 21.42, "connectivity": 21.42, "uniform": 17.00, "parking": 0.0},
    "CPT": {"phone": 42.84, "connectivity": 42.84, "uniform": 17.00, "parking": 0.0},
}

_VAR_2025 = {
    "FO": {
        "blh": 9.91,        # per block hour
        "blhp": 14.87,      # per block hour over 60h threshold
        "sby": 39.66,       # per standby day
        "bdo": 510.00,      # bought day off (OVT landing after midnight)
        "hdb": 255.00,      # half day bought (HDB — Art.2.09)
        # Positioning / deadhead per diems (carried as pax, not operating)
        "dh_int": 39.66,    # DH international positioning
        "dh_dom": 19.83,    # DH domestic positioning
        # Worked per diems (operating crew) — CLA "dietas" table
        "int_no_overnight": 66.11,   # international WITHOUT overnight stay
        "int_int_overnight": 91.35,  # international WITH international overnight
        "int_nat_overnight": 66.11,  # international WITH national (Spain) overnight
        "nat_no_overnight": 50.00,   # national without overnight stay
        "nat_nat_overnight": 60.00,  # national with national overnight stay
        "simulator": 39.66, # per sim day
        "var_soc": 39.66,   # SOC/VAC supplement per vacation/leave day
    },
    "CPT": {
        "blh": 21.05,       # per block hour  (was mistakenly 82.56 — the STBY/DH rate)
        "blhp": 31.58,
        "sby": 84.21,
        "bdo": 1021.00,
        "hdb": 510.00,
        "dh_int": 84.21,    # DH international positioning (was 39.66 — the FO rate)
        "dh_dom": 42.11,    # DH domestic positioning (was 19.83 — the FO rate)
        "int_no_overnight": 66.11,   # same dieta for CPT & FO
        "int_int_overnight": 91.35,
        "int_nat_overnight": 66.11,
        "nat_no_overnight": 50.00,
        "nat_nat_overnight": 60.00,
        "simulator": 84.21,
        "var_soc": 84.21,
    },
}

# Home base — PMI / LEPA
_HOME_BASE_ICAO = "LEPA"
_SPAIN_ICAO_PREFIX = "LE"


def _is_spain(icao: str | None) -> bool:
    return bool(icao and icao.upper().startswith(_SPAIN_ICAO_PREFIX))


def _net_estimate(gross: float, irpf_rate: float = 0.24) -> float:
    """Net estimate applying a fixed IRPF withholding rate + 6.35% SS employee contribution."""
    ss = gross * 0.0635   # Spanish employee SS contribution (contingencias comunes)
    return round((gross - ss) * (1 - irpf_rate), 2)


def _analyse_per_diems(conn: sqlite3.Connection, month: str) -> dict:
    """
    Infer per diems from logged flights for the given month.

    Logic:
    - Base = LEPA. Norwegian Spain does not operate domestic Spain flights,
      so every flight counts as international.
    - Per diem type per duty day:
        * If the crew starts the day at home (dep_icao == LEPA) and
          the last flight of the day returns to LEPA → international without overnight.
        * If the last flight of the day does NOT return to LEPA, OR
          the first flight of the next duty day departs from non-LEPA →
          international overnight.
    - OVT/BDO: any day where the last on_block_utc is after 00:01 UTC of the
      following calendar day → count as a BDO (bought day off per Art.2.07/2.08).
      If the excess is only minor (landing 00:01–04:00) → count as HDB (Art.2.09).
    """
    try:
        # All non-sim flights for the month, ordered by date and off_block time
        rows = conn.execute(
            """SELECT date, dep_icao, arr_icao, off_block_utc, on_block_utc
               FROM flights
               WHERE strftime('%Y-%m', date) = ?
                 AND is_sim = 0
                 AND dep_icao IS NOT NULL
               ORDER BY date, off_block_utc""",
            (month,),
        ).fetchall()
    except Exception:
        rows = []

    if not rows:
        return {
            "int_no_overnight": 0, "int_overnight": 0, "int_nat_overnight": 0,
            "nat_overnight": 0, "bdo_days": 0, "hdb_days": 0,
            "detail": [],
        }

    # Group by calendar date
    from collections import defaultdict
    days: dict[str, list] = defaultdict(list)
    for r in rows:
        days[r["date"]].append(r)

    sorted_dates = sorted(days.keys())

    int_no_overnight = 0
    int_overnight = 0       # overnight abroad (non-Spain) → 91.35
    int_nat_overnight = 0   # overnight in Spain away from base → 66.11
    nat_overnight = 0
    bdo_days = 0
    hdb_days = 0
    detail = []

    for i, d in enumerate(sorted_dates):
        legs = days[d]
        first_leg = legs[0]
        last_leg = legs[-1]

        first_dep = first_leg["dep_icao"] or ""
        last_arr = last_leg["arr_icao"] or ""
        last_on_block = last_leg["on_block_utc"] or ""

        # Overnight detection: did we end the day away from base?
        away_from_base = last_arr.upper() != _HOME_BASE_ICAO

        # Cross-midnight check: on_block_utc date > flight date
        cross_midnight = False
        if last_on_block and len(last_on_block) >= 10:
            on_block_date = last_on_block[:10]
            if on_block_date > d:
                cross_midnight = True
                # Determine BDO vs HDB by time
                try:
                    hour = int(last_on_block[11:13])
                    minute = int(last_on_block[14:16])
                    # HDB: landing before 04:00 UTC next day (Art.2.09 — minor invasion)
                    if hour < 4 or (hour == 4 and minute == 0):
                        hdb_days += 1
                    else:
                        bdo_days += 1
                except (ValueError, IndexError):
                    bdo_days += 1

        # Per diem classification. Every NAS Spain flight is international, but the
        # overnight per diem differs by where you stop: abroad (non-Spain) pays the
        # full international overnight (91.35), while an overnight still inside Spain
        # away from base pays the "international with national overnight" rate (66.11).
        if away_from_base:
            if _is_spain(last_arr):
                int_nat_overnight += 1
                perd_type = "int_nat_overnight"
            else:
                int_overnight += 1
                perd_type = "int_overnight"
        else:
            # Returned to base — international day trip, no overnight (66.11)
            int_no_overnight += 1
            perd_type = "int_no_overnight"

        detail.append({
            "date": d,
            "first_dep": first_dep,
            "last_arr": last_arr,
            "perd_type": perd_type,
            "cross_midnight": cross_midnight,
        })

    return {
        "int_no_overnight": int_no_overnight,
        "int_overnight": int_overnight,
        "int_nat_overnight": int_nat_overnight,
        "nat_overnight": nat_overnight,  # not applicable for NAS Spain
        "bdo_days": bdo_days,
        "hdb_days": hdb_days,
        "detail": detail,
    }


@router.get("/pay-estimate")
def get_pay_estimate(
    month: str = Query(..., description="YYYY-MM"),
    category: str = Query("FO", description="FO or CPT"),
    level: int = Query(4, ge=1, le=10, description="Salary level 1–10"),
    irpf: float = Query(0.24, description="IRPF withholding rate (0–1), e.g. 0.24 for 24%"),
):
    """
    Estimate gross monthly pay from roster + logged flights.
    Uses Norwegian Spain CLA 2025 (Appendix C, Table C.1).
    Per diems derived from flight dep/arr ICAO and on-block UTC times.
    """
    category = category.upper()
    if category not in ("FO", "CPT"):
        category = "FO"

    conn = _get_conn()
    try:
        # ── 1. Roster counts ──────────────────────────────────────────────────
        roster_rows = conn.execute(
            "SELECT duty_type, COUNT(*) AS cnt FROM roster "
            "WHERE strftime('%Y-%m', date) = ? GROUP BY duty_type",
            (month,),
        ).fetchall()
    except sqlite3.OperationalError:
        roster_rows = []

    try:
        # ── 2. Block hours + sim count ────────────────────────────────────────
        flt_totals = conn.execute(
            """SELECT COALESCE(SUM(CASE WHEN is_sim=0 THEN block_seconds ELSE 0 END), 0) AS bs,
                      COALESCE(SUM(CASE WHEN is_sim=0 THEN 1 ELSE 0 END), 0) AS sectors,
                      COALESCE(COUNT(DISTINCT CASE WHEN is_sim=1 THEN date END), 0) AS sim_days
               FROM flights
               WHERE strftime('%Y-%m', date) = ?""",
            (month,),
        ).fetchone()
        block_seconds = flt_totals["bs"] if flt_totals else 0
        sectors = flt_totals["sectors"] if flt_totals else 0
        sim_count = flt_totals["sim_days"] if flt_totals else 0
    except Exception:
        block_seconds = 0
        sectors = 0
        sim_count = 0

    # ── 3. Per diem analysis from flight data ─────────────────────────────────
    per_diems = _analyse_per_diems(conn, month)
    conn.close()

    duty_counts: dict[str, int] = {r["duty_type"]: r["cnt"] for r in roster_rows}
    block_hours = round(block_seconds / 3600.0, 2)

    # ── 4. Salary components ──────────────────────────────────────────────────
    base = _BASE_SALARY_2025.get((category, level), 0.0)
    fixed = _FIXED_2025.get(category, _FIXED_2025["FO"])
    var = _VAR_2025.get(category, _VAR_2025["FO"])

    fixed_total = base + sum(fixed.values())

    blh_threshold = 60.0
    blh_base_hours = min(block_hours, blh_threshold)
    blh_prod_hours = max(0.0, block_hours - blh_threshold)
    blh_pay  = round(blh_base_hours * var["blh"], 2)
    blhp_pay = round(blh_prod_hours * var["blhp"], 2)

    sby_days = duty_counts.get("SBY", 0) + duty_counts.get("standby", 0)
    sby_pay  = round(sby_days * var["sby"], 2)

    sim_pay  = round(sim_count * var["simulator"], 2)

    vac_days = duty_counts.get("VAC", 0)
    soc_pay  = round(vac_days * var["var_soc"], 2)

    # LVO in roster = deadhead/positioning day → DH international per diem
    lvo_days = duty_counts.get("LVO", 0)
    lvo_pay  = round(lvo_days * var["dh_int"], 2)

    # Per diems from flight analysis. A worked international day trip (returned to
    # base same day) pays the "international without overnight" dieta (66.11), NOT
    # the DH positioning rate (39.66). Overnights split abroad vs Spain.
    dh_int_pay      = round(per_diems["int_no_overnight"] * var["int_no_overnight"], 2)
    dh_int_ovn_pay  = round(per_diems["int_overnight"] * var["int_int_overnight"], 2)
    dh_nat_ovn_pay  = round(per_diems["int_nat_overnight"] * var["int_nat_overnight"], 2)
    bdo_pay         = round(per_diems["bdo_days"] * var["bdo"], 2)
    hdb_pay         = round(per_diems["hdb_days"] * var["hdb"], 2)

    variable_total = (
        blh_pay + blhp_pay + sby_pay + sim_pay + soc_pay + lvo_pay
        + dh_int_pay + dh_int_ovn_pay + dh_nat_ovn_pay + bdo_pay + hdb_pay
    )

    gross_monthly = round(fixed_total + variable_total, 2)
    net_monthly   = _net_estimate(gross_monthly, irpf)

    return {
        "month": month,
        "category": category,
        "level": level,
        "irpf_rate": irpf,
        # Inputs
        "block_hours": block_hours,
        "sectors": sectors,
        "duty_counts": duty_counts,
        "sim_days": sim_count,
        # Components
        "base_salary": base,
        "fixed_supplements": {
            "phone": fixed["phone"],
            "connectivity": fixed["connectivity"],
            "uniform": fixed["uniform"],
            "parking": fixed["parking"],
            "total": round(sum(fixed.values()), 2),
        },
        "variable_pay": {
            "blh_hours": blh_base_hours,
            "blh_pay": blh_pay,
            "blhp_hours": blh_prod_hours,
            "blhp_pay": blhp_pay,
            "sby_days": sby_days,
            "sby_pay": sby_pay,
            "sim_days": sim_count,
            "sim_pay": sim_pay,
            "vac_days": vac_days,
            "soc_pay": soc_pay,
            "lvo_days": lvo_days,
            "lvo_pay": lvo_pay,
            # Per diems (from flight analysis)
            "dh_int_days": per_diems["int_no_overnight"],
            "dh_int_pay": dh_int_pay,
            "dh_int_overnight_days": per_diems["int_overnight"],
            "dh_int_overnight_pay": dh_int_ovn_pay,
            "dh_nat_overnight_days": per_diems["int_nat_overnight"],
            "dh_nat_overnight_pay": dh_nat_ovn_pay,
            "bdo_days": per_diems["bdo_days"],
            "bdo_pay": bdo_pay,
            "hdb_days": per_diems["hdb_days"],
            "hdb_pay": hdb_pay,
            "total": round(variable_total, 2),
        },
        "per_diem_detail": per_diems["detail"],
        "gross_monthly": gross_monthly,
        "net_monthly_estimate": net_monthly,
        "notes": [
            "Base salary includes 2 prorated extraordinary payments per Art.1.02",
            "BLHp applies above 60h/month threshold (Art.2.02)",
            "Per diems inferred from flight ICAO codes — all NAS Spain flights counted as international",
            "BDO triggered when last on_block UTC crosses midnight (Art.2.07/2.08)",
            "HDB triggered for landings 00:01–04:00 UTC next day (Art.2.09)",
            f"Net uses {int(irpf*100)}% IRPF withholding + 6.35% SS employee contribution",
        ],
    }
