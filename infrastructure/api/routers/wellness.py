"""Wellness router — all-day stress/energy timeline + recovery flag (CIRQA)."""

import sqlite3
from datetime import datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from infrastructure.api.db import get_db
from domains.health.recovery import recovery_flag

router = APIRouter(prefix="/wellness", tags=["wellness"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _local_hhmm(iso_utc: Optional[str], offset_min: int) -> Optional[str]:
    """Convert a UTC ISO timestamp to local HH:MM using the day's offset."""
    if not iso_utc:
        return None
    try:
        dt = datetime.strptime(iso_utc[:19], "%Y-%m-%dT%H:%M:%S") + timedelta(minutes=offset_min)
        return dt.strftime("%H:%M")
    except Exception:
        return None


@router.get("/recovery")
def get_recovery(date: str = Query(...), conn: DB = None):
    return recovery_flag(conn, date)


@router.get("/timeline")
def get_timeline(date: str = Query(...), conn: DB = None):
    """All-day stress / Body Battery / HR series + life events overlaid.

    Series are stored local; events (activities, meals, flights) are UTC, so we
    localize them with the day's offset captured during the wellness sync.
    """
    stress = [{"t": r["time"], "v": r["level"]}
              for r in conn.execute("SELECT time, level FROM intraday_stress WHERE date=? ORDER BY time", (date,))]
    body_battery = [{"t": r["time"], "v": r["level"]}
                    for r in conn.execute("SELECT time, level FROM intraday_body_battery WHERE date=? ORDER BY time", (date,))]
    try:
        hr = [{"t": r["time"], "v": r["heart_rate"]}
              for r in conn.execute("SELECT time, heart_rate FROM intraday_hr WHERE date=? ORDER BY time", (date,))]
    except sqlite3.OperationalError:
        hr = []  # intraday_hr table created lazily by its sync; may not exist yet

    off_row = conn.execute("SELECT utc_offset_min FROM wellness_daily WHERE date=?", (date,)).fetchone()
    offset_min = (off_row["utc_offset_min"] if off_row and off_row["utc_offset_min"] is not None else 0)

    events = []
    for a in conn.execute("SELECT name, activity_type, start_time FROM activities WHERE date=?", (date,)):
        t = _local_hhmm(a["start_time"], offset_min)
        if t:
            events.append({"t": t, "label": a["name"] or (a["activity_type"] or "Activity"), "type": "activity"})
    for m in conn.execute("SELECT description, logged_at FROM food_entries WHERE date=?", (date,)):
        t = _local_hhmm(m["logged_at"], offset_min)
        if t:
            events.append({"t": t, "label": m["description"], "type": "meal"})
    for f in conn.execute(
        "SELECT dep_iata, arr_iata, takeoff_utc, landing_utc FROM flights WHERE date=? AND is_sim=0", (date,)
    ):
        tk = _local_hhmm(f["takeoff_utc"], offset_min)
        ld = _local_hhmm(f["landing_utc"], offset_min)
        if tk:
            events.append({"t": tk, "label": f"Takeoff {f['dep_iata'] or ''}".strip(), "type": "flight"})
        if ld:
            events.append({"t": ld, "label": f"Landing {f['arr_iata'] or ''}".strip(), "type": "flight"})

    events.sort(key=lambda e: e["t"])
    return {
        "date": date,
        "offset_min": offset_min,
        "stress": stress,
        "body_battery": body_battery,
        "hr": hr,
        "events": events,
        "has_data": bool(stress or body_battery or hr),
    }
