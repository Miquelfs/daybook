"""Wellness router — all-day stress/energy timeline + recovery flag (CIRQA)."""

import sqlite3
from datetime import datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from infrastructure.api.db import get_db
from domains.health.recovery import recovery_flag
from domains.health.stress_context import flight_phases, flight_phase_by_id, stress_by_place

router = APIRouter(prefix="/wellness", tags=["wellness"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _local_hhmm(iso_utc: Optional[str], offset_min: int, plus_s: int = 0) -> Optional[str]:
    """Convert a UTC ISO timestamp (+ optional seconds) to local HH:MM."""
    if not iso_utc:
        return None
    try:
        dt = (datetime.strptime(iso_utc[:19].replace(" ", "T"), "%Y-%m-%dT%H:%M:%S")
              + timedelta(minutes=offset_min) + timedelta(seconds=plus_s))
        return dt.strftime("%H:%M")
    except Exception:
        return None


_MEAL_LABEL = {
    "breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner",
    "snack": "Snack", "extra": "Extra",
}


@router.get("/recovery")
def get_recovery(date: str = Query(...), conn: DB = None):
    return recovery_flag(conn, date)


@router.get("/flight-phases")
def get_flight_phases(date: str = Query(...), conn: DB = None):
    return {"date": date, "flights": flight_phases(conn, date)}


@router.get("/flight/{flight_id}")
def get_flight_phase(flight_id: str, conn: DB):
    """Physiological load for one flight — for the flight detail page."""
    return {"flight_id": flight_id, "phase": flight_phase_by_id(conn, flight_id)}


@router.get("/stress-by-place")
def get_stress_by_place(date: str = Query(...), conn: DB = None):
    return stress_by_place(conn, date)


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

    spans = []   # shaded regions on the timeline (flights, activities)
    events = []  # point markers (takeoff, landing, meals-by-tag)

    # Activities → shaded green block (start → start + duration) + a marker.
    for a in conn.execute(
        "SELECT name, activity_type, start_time, duration_seconds FROM activities WHERE date=?", (date,)
    ):
        start = _local_hhmm(a["start_time"], offset_min)
        if not start:
            continue
        label = a["name"] or (a["activity_type"] or "Activity")
        end = _local_hhmm(a["start_time"], offset_min, plus_s=int(a["duration_seconds"] or 0))
        spans.append({"start": start, "end": end or start, "label": label, "type": "activity"})

    # Flights → shaded blue block (off-block → on-block) + takeoff/landing markers.
    for f in conn.execute(
        "SELECT dep_iata, arr_iata, off_block_utc, on_block_utc, takeoff_utc, landing_utc "
        "FROM flights WHERE date=? AND is_sim=0", (date,)
    ):
        leg = f"{f['dep_iata'] or '?'}→{f['arr_iata'] or '?'}"
        s = _local_hhmm(f["off_block_utc"], offset_min) or _local_hhmm(f["takeoff_utc"], offset_min)
        e = _local_hhmm(f["on_block_utc"], offset_min) or _local_hhmm(f["landing_utc"], offset_min)
        if s and e:
            spans.append({"start": s, "end": e, "label": leg, "type": "flight"})
        tk = _local_hhmm(f["takeoff_utc"], offset_min)
        ld = _local_hhmm(f["landing_utc"], offset_min)
        if tk:
            events.append({"t": tk, "label": f"T/O {f['dep_iata'] or ''}".strip(), "type": "takeoff"})
        if ld:
            events.append({"t": ld, "label": f"LDG {f['arr_iata'] or ''}".strip(), "type": "landing"})

    # Meals → one marker per meal-type (tag only, not the food list), with total kcal on hover.
    # Prefer the user's eaten_at (already local wall-clock); else localize logged_at.
    meals: dict = {}
    for m in conn.execute("SELECT meal_type, eaten_at, logged_at, kcal FROM food_entries WHERE date=?", (date,)):
        t = m["eaten_at"][11:16] if m["eaten_at"] and len(m["eaten_at"]) >= 16 else _local_hhmm(m["logged_at"], offset_min)
        if not t:
            continue
        g = meals.setdefault(m["meal_type"] or "", {"t": t, "kcal": 0.0, "n": 0})
        if t < g["t"]:
            g["t"] = t
        g["kcal"] += m["kcal"] or 0
        g["n"] += 1
    for key, g in meals.items():
        events.append({
            "t": g["t"], "label": _MEAL_LABEL.get(key, "Meal"), "type": "meal",
            "detail": f"{int(g['kcal'])} kcal · {g['n']} item{'s' if g['n'] != 1 else ''}",
        })

    events.sort(key=lambda e: e["t"])
    spans.sort(key=lambda s: s["start"])
    return {
        "date": date,
        "offset_min": offset_min,
        "stress": stress,
        "body_battery": body_battery,
        "hr": hr,
        "spans": spans,
        "events": events,
        "has_data": bool(stress or body_battery or hr),
    }
