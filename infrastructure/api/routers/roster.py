"""
Roster API — PDF upload and monthly/daily views.

POST /roster/upload          multipart PDF → parse + upsert
GET  /roster                 ?month=YYYY-MM → list of RosterDay rows
GET  /roster/months          → list of distinct YYYY-MM periods available
GET  /roster/day/{date}      → full day detail (roster row + legs with crew)
GET  /roster/day/{date}/brief → lightweight duty summary (or null)
GET  /roster/pay-estimate    ?month=YYYY-MM → payslip of month+1 (CLA II ESP), day-by-day reconciled
GET/PUT /roster/pay-settings → category, level, IRPF %, jornada %
PUT  /roster/pay-overrides/{date} → per-day pay corrections (BDO, standby paid, dieta, positioning)
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
from dataclasses import asdict
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
from domains.aviation import pay

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

    # New duties → re-place training sessions around them right away.
    replanned = 0
    try:
        from domains.training.reflow import reflow_all
        rconn = _get_conn()
        try:
            replanned = reflow_all(rconn)
        finally:
            rconn.close()
    except Exception as e:  # never fail a roster import over the training plan
        print(f"WARN reflow after roster import: {e}")

    return {"period": period, "imported": count, "legs": len(legs) if 'legs' in dir() else 0,
            "training_sessions_replanned": replanned}


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


# ── Pay estimate (CLA II ESP) — model lives in domains/aviation/pay.py ───────

class PaySettingsIn(BaseModel):
    category: Optional[Literal["FO", "CPT"]] = None
    level: Optional[int] = Field(None, ge=1, le=10)
    irpf_pct: Optional[float] = Field(None, ge=0, le=50)
    jornada_pct: Optional[int] = Field(None, ge=50, le=100)


class PayOverrideIn(BaseModel):
    standby_paid: Optional[bool] = None
    per_diem: Optional[Literal["none", "int_no_overnight", "int_int_overnight", "int_nat_overnight",
                              "nat_no_overnight", "nat_nat_overnight"]] = None
    positioning: Optional[int] = Field(None, ge=0, le=4)
    bdo: Optional[float] = Field(None, ge=0, le=1)
    note: Optional[str] = None


@router.get("/pay-settings")
def get_pay_settings():
    conn = _get_conn()
    try:
        return pay.get_settings(conn)
    finally:
        conn.close()


@router.put("/pay-settings")
def put_pay_settings(body: PaySettingsIn):
    conn = _get_conn()
    try:
        pay.ensure_tables(conn)
        fields = body.model_dump(exclude_none=True)
        if fields:
            conn.execute(
                f"UPDATE pay_settings SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = 1",
                list(fields.values()),
            )
            conn.commit()
        return pay.get_settings(conn)
    finally:
        conn.close()


@router.put("/pay-overrides/{date}")
def put_pay_override(date: str, body: PayOverrideIn):
    """Replace the day's overrides; fields left null fall back to the automatic value."""
    conn = _get_conn()
    try:
        pay.ensure_tables(conn)
        o = body.model_dump()
        if all(v is None for v in o.values()):
            conn.execute("DELETE FROM roster_pay_overrides WHERE date = ?", (date,))
        else:
            conn.execute(
                """INSERT INTO roster_pay_overrides (date, standby_paid, per_diem, positioning, bdo, note, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                   ON CONFLICT(date) DO UPDATE SET
                     standby_paid = excluded.standby_paid, per_diem = excluded.per_diem,
                     positioning = excluded.positioning, bdo = excluded.bdo,
                     note = excluded.note, updated_at = excluded.updated_at""",
                (date, None if o["standby_paid"] is None else int(o["standby_paid"]),
                 o["per_diem"], o["positioning"], o["bdo"], o["note"]),
            )
        conn.commit()
        day = next((d for d in pay.reconcile_month(conn, date[:7]) if d.date == date), None)
        return asdict(day) if day else None
    finally:
        conn.close()


@router.get("/pay-estimate")
def get_pay_estimate(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="Activity (roster) month YYYY-MM"),
    category: Optional[str] = Query(None, description="FO or CPT (default: saved settings)"),
    level: Optional[int] = Query(None, ge=1, le=10),
    irpf_pct: Optional[float] = Query(None, ge=0, le=50),
    jornada: Optional[int] = Query(None, ge=50, le=100, description="Jornada % of the payslip month"),
    jornada_prev: Optional[int] = Query(None, ge=50, le=100, description="Jornada % of the activity month"),
):
    """
    Payslip paid in month+1: fixed pay of month+1 plus the variable pay earned in
    `month`, reconciled day by day (roster plan vs logged flights + overrides).
    """
    conn = _get_conn()
    try:
        s = pay.get_settings(conn)
        return pay.payslip(
            conn, month,
            category=category or s["category"],
            level=level or s["level"],
            irpf_pct=s["irpf_pct"] if irpf_pct is None else irpf_pct,
            jornada_pct=jornada or s["jornada_pct"],
            jornada_prev_pct=jornada_prev or jornada or s["jornada_pct"],
        )
    finally:
        conn.close()
