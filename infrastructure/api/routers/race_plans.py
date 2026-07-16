"""
Race plan router — goal management, session scheduling, adaptation.
Prefix: /race-plans
"""

import json
import sqlite3
from datetime import date, datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from infrastructure.api.db import get_db
from domains.training.plan_templates import TEMPLATES, RACE_TYPE_WEEKS, RACE_TYPE_VARIANTS, get_template_key
from domains.training.scheduler import generate_plan, get_discipline as _discipline_from_type
from domains.training.adaptation_engine import (
    OMYRATrainingEngine,
    PlanPhase,
    WeekData,
    map_daybook_data,
    RECOMMENDATION_EXPLANATIONS,
)

router = APIRouter(prefix="/race-plans", tags=["race-plans"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

_engine = OMYRATrainingEngine()

# ── helpers ────────────────────────────────────────────────────────────────

def _today() -> str:
    return date.today().isoformat()


def _row(conn: sqlite3.Connection, table: str, row_id: int) -> sqlite3.Row:
    r = conn.execute(f"SELECT * FROM {table} WHERE id=?", (row_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail=f"{table} {row_id} not found")
    return r


def _phase_for_week(week_num: int, total_weeks: int) -> PlanPhase:
    fraction = week_num / total_weeks
    if fraction <= 0.35:
        return PlanPhase.BASE_BUILDING
    if fraction <= 0.65:
        return PlanPhase.BUILD
    if fraction <= 0.85:
        return PlanPhase.PEAK
    return PlanPhase.TAPER


def _plan_total_weeks(conn: sqlite3.Connection, goal_row: sqlite3.Row) -> int:
    """
    The real number of weeks in the materialized plan. After a trim (e.g. a goal
    that starts mid-template), this is the authoritative span — MAX(week_number).
    Falls back to the plan_start→race_date span, then the template constant.
    Using this instead of RACE_TYPE_WEEKS keeps phase/taper detection correct when
    the plan was trimmed (a 16-week restart of a 20-week template is really 16 weeks).
    """
    r = conn.execute(
        "SELECT MAX(week_number) AS mw FROM plan_sessions WHERE goal_id=?",
        (goal_row["id"],),
    ).fetchone()
    if r and r["mw"]:
        return int(r["mw"])
    plan_start = goal_row["plan_start_date"]
    if plan_start:
        ps = date.fromisoformat(plan_start)
        rd = date.fromisoformat(goal_row["race_date"])
        return max(1, ((rd - ps).days + 6) // 7)
    return RACE_TYPE_WEEKS.get(goal_row["race_type"], 16)


def _current_week(plan_start: Optional[str], total_weeks: int) -> int:
    """1-based week index within the plan, clamped to [1, total_weeks]."""
    if not plan_start:
        return 1
    ps = date.fromisoformat(plan_start)
    wk = (date.today() - ps).days // 7 + 1
    return max(1, min(wk, total_weeks))


def _week_bounds(date_str: str):
    """Return (monday_str, sunday_str) for the calendar week containing date_str."""
    d = date.fromisoformat(date_str)
    mon = d - timedelta(days=d.weekday())
    sun = mon + timedelta(days=6)
    return mon.isoformat(), sun.isoformat()


def _fetch_roster_blocked(conn: sqlite3.Connection, start: str, end: str) -> set[str]:
    """
    Returns roster-blocked dates only for multi-day trips (away from base).
    FLT/SBY days are NOT blocked — they just get a warning in the day view.
    Only block dates where the pilot is genuinely unavailable (layovers / multi-day trips).
    For now returns empty set; override is per-session via roster_warning.
    """
    return set()


def _effective_duration(duration_min: int, volume_factor: float) -> int:
    return max(10, round(duration_min * volume_factor))


# ── zone helpers (shared by pace-zones and discipline-zones) ─────────────────

_ZONE_META = {
    "Z1": {"hr_pct": "56–75%", "rpe": "2–3", "label": "Recovery"},
    "Z2": {"hr_pct": "76–86%", "rpe": "4–5", "label": "Aerobic"},
    "Z3": {"hr_pct": "87–91%", "rpe": "6–7", "label": "Tempo"},
    "Z4": {"hr_pct": "92–95%", "rpe": "8",   "label": "Threshold"},
    "Z5": {"hr_pct": "95–100%", "rpe": "9–10", "label": "VO2max"},
}

# threshold-pace multipliers (Z3 = threshold)
_PACE_MULT = {"Z1": 1.37, "Z2": 1.15, "Z3": 1.00, "Z4": 0.885, "Z5": 0.80}
# speed factors relative to a hard-steady reference speed (bike, no power meter)
_SPEED_FACTOR = {"Z1": 0.72, "Z2": 0.85, "Z3": 0.93, "Z4": 1.00, "Z5": 1.06}
# swim CSS offsets in seconds/100m (Z4 = CSS)
_CSS_OFFSET = {"Z1": 16, "Z2": 10, "Z3": 5, "Z4": 0, "Z5": -3}


def _s_per_km_to_display(s: float) -> str:
    m = int(s) // 60
    sec = int(s) % 60
    return f"{m}:{sec:02d}/km"


def _s_per_100m_to_display(s: float) -> str:
    m = int(s) // 60
    sec = int(s) % 60
    return f"{m}:{sec:02d}/100m"


def _run_zones_from_threshold(threshold_s_km: float) -> dict:
    zones = {}
    for z, mult in _PACE_MULT.items():
        pace_s = threshold_s_km * mult
        zones[z] = {
            "pace_s_km": round(pace_s),
            "display": _s_per_km_to_display(pace_s),
            **_ZONE_META[z],
        }
    return zones


def _latest_zone_row(conn: sqlite3.Connection, sport: str) -> Optional[sqlite3.Row]:
    try:
        return conn.execute(
            "SELECT * FROM athlete_zones WHERE sport=? ORDER BY valid_from DESC LIMIT 1",
            (sport,),
        ).fetchone()
    except Exception:
        return None


_HR_BANDS = [("Z1", 0.0, 0.65), ("Z2", 0.65, 0.75), ("Z3", 0.75, 0.82),
             ("Z4", 0.82, 0.88), ("Z5", 0.88, 1.6)]


def _zones_json_from_max(max_hr: int) -> str:
    return json.dumps([
        {"name": n, "min_hr": round(max_hr * lo), "max_hr": 999 if hi >= 1.5 else round(max_hr * hi)}
        for n, lo, hi in _HR_BANDS
    ])


def _race_sweat_rate(conn: sqlite3.Connection) -> Optional[float]:
    """Latest hot/humid sweat rate (fallback overall) for hydration targeting."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sweat_tests'").fetchone():
        return None
    row = conn.execute(
        "SELECT sweat_rate_l_h FROM sweat_tests WHERE sweat_rate_l_h IS NOT NULL "
        "ORDER BY (conditions IN ('hot','humid')) DESC, date DESC LIMIT 1"
    ).fetchone()
    return row["sweat_rate_l_h"] if row else None


def _session_fuel(conn, duration_min, zone, discipline, weeks_to_race):
    """Compute per-session fueling targets; returns None on any failure."""
    try:
        from domains.training import fueling
        return fueling.session_fuel_targets(
            duration_min or 0, zone, discipline, weeks_to_race,
            sweat_rate_l_h=_race_sweat_rate(conn),
        )
    except Exception:
        return None


def _materialize_sessions(
    conn: sqlite3.Connection,
    goal_id: int,
    goal_row: sqlite3.Row,
    from_date: Optional[str] = None,
) -> int:
    """
    Run the scheduler and INSERT sessions into plan_sessions.
    Returns the number of sessions inserted.

    When from_date is set, sessions dated before it are skipped — used to rebuild
    only the remaining plan (e.g. after a mid-plan template change) without
    duplicating past weeks that still hold completed/skipped history.
    """
    race_type = goal_row["race_type"]
    variant = goal_row["variant"]
    template_key = get_template_key(race_type, variant)
    template = TEMPLATES.get(template_key)
    if not template:
        raise HTTPException(status_code=422, detail=f"No template found for {template_key}")

    avail_days = goal_row["available_days"].split(",")
    race_date_str = goal_row["race_date"]
    plan_start_str = goal_row["plan_start_date"] or _today()
    volume_factor = goal_row["volume_factor"] or 1.0

    blocked: set[str] = set()
    if goal_row["respect_roster"]:
        blocked = _fetch_roster_blocked(conn, plan_start_str, race_date_str)

    plan = generate_plan(
        template=template,
        goal_date=race_date_str,
        availability=avail_days,
        start_from=plan_start_str,
        roster_blocked_dates=blocked,
        schedule_all_weeks=True,
    )

    count = 0
    for week in plan.get("plan", []):
        week_num = week["week"]
        for session in week.get("training_sessions", []):
            s_date = session.get("date", "")
            if not s_date:
                continue
            # Pin the race session to the actual race date (the scheduler otherwise
            # spreads it onto an ordinary available day, which can miss race day).
            if "race" in session["type"].lower():
                s_date = race_date_str
            if from_date and s_date < from_date:
                continue
            discipline = _discipline_from_type(session["type"])
            eff_dur = _effective_duration(session["duration"], volume_factor)
            structure = session.get("structure")
            conn.execute(
                """INSERT INTO plan_sessions
                   (goal_id, session_date, original_date, week_number,
                    session_type, discipline, duration_min, intensity_zone,
                    is_optional, effective_duration_min, status, structure_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)""",
                (
                    goal_id,
                    s_date,
                    s_date,
                    week_num,
                    session["type"],
                    discipline,
                    session["duration"],
                    session.get("intensity_zone", "Z2"),
                    1 if session.get("optional") else 0,
                    eff_dur,
                    json.dumps(structure) if structure else None,
                ),
            )
            count += 1
    conn.commit()
    return count


def _goal_out(row: sqlite3.Row, conn: sqlite3.Connection) -> dict:
    race_date = date.fromisoformat(row["race_date"])
    today_d = date.today()
    days_left = (race_date - today_d).days

    plan_start = row["plan_start_date"]
    weeks_materialized = 0
    if plan_start and date.fromisoformat(plan_start) <= today_d:
        r = conn.execute(
            "SELECT MAX(week_number) as mw FROM plan_sessions WHERE goal_id=?",
            (row["id"],),
        ).fetchone()
        weeks_materialized = r["mw"] or 0

    race_type = row["race_type"]
    total_weeks = _plan_total_weeks(conn, row)
    current_week = _current_week(plan_start, total_weeks)

    phase = _phase_for_week(current_week, total_weeks)

    adaptation = None
    if row["last_adaptation_json"]:
        try:
            a = json.loads(row["last_adaptation_json"])
            # Only surface the adaptation note if it was applied this week
            if a.get("adaptation_week") == current_week:
                adaptation = a
        except Exception:
            pass

    waiting = plan_start and date.fromisoformat(plan_start) > today_d
    plan_start_display = None
    if waiting and plan_start:
        ps_d = date.fromisoformat(plan_start)
        plan_start_display = ps_d.strftime("%B %Y")

    return {
        "id": row["id"],
        "name": row["name"],
        "race_type": race_type,
        "variant": row["variant"],
        "race_date": row["race_date"],
        "plan_start_date": plan_start,
        "status": row["status"],
        "available_days": row["available_days"].split(","),
        "respect_roster": bool(row["respect_roster"]),
        "volume_factor": row["volume_factor"],
        "intensity_factor": row["intensity_factor"],
        "notes": row["notes"],
        "target_time": row["target_time"] if "target_time" in row.keys() else None,
        "days_until_race": max(0, days_left),
        "weeks_until_race": max(0, days_left // 7),
        "current_phase": phase.value,
        "current_week": current_week,
        "total_weeks": total_weeks,
        "weeks_materialized": weeks_materialized,
        "waiting": waiting,
        "plan_start_display": plan_start_display,
        "last_adaptation": adaptation,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _session_out(row: sqlite3.Row) -> dict:
    keys = row.keys()
    structure = None
    if "structure_json" in keys and row["structure_json"]:
        try:
            structure = json.loads(row["structure_json"])
        except Exception:
            structure = None
    return {
        "id": row["id"],
        "goal_id": row["goal_id"],
        "session_date": row["session_date"],
        "original_date": row["original_date"],
        "week_number": row["week_number"],
        "session_type": row["session_type"],
        "discipline": row["discipline"],
        "duration_min": row["duration_min"],
        "effective_duration_min": row["effective_duration_min"],
        "intensity_zone": row["intensity_zone"],
        "is_optional": bool(row["is_optional"]),
        "is_displaced": bool(row["is_displaced"]),
        "status": row["status"],
        "completed_activity_id": row["completed_activity_id"],
        "rpe_actual": row["rpe_actual"],
        "notes": row["notes"],
        "structure": structure,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ── Pydantic models ─────────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    name: str
    race_type: str
    variant: str = "balanced"
    race_date: str
    available_days: list[str]
    respect_roster: bool = True
    volume_factor: float = 1.0
    intensity_factor: float = 1.0
    notes: Optional[str] = None
    target_time: Optional[str] = None  # e.g. "2:15:00" for target finish time

    @field_validator("race_type")
    @classmethod
    def valid_race_type(cls, v):
        valid = list(RACE_TYPE_WEEKS.keys())
        if v not in valid:
            raise ValueError(f"race_type must be one of {valid}")
        return v

    @field_validator("variant")
    @classmethod
    def valid_variant(cls, v):
        if v not in ("balanced", "polarized"):
            raise ValueError("variant must be 'balanced' or 'polarized'")
        return v

    @field_validator("available_days")
    @classmethod
    def at_least_three_days(cls, v):
        if len(v) < 3:
            raise ValueError("Need at least 3 available training days")
        return v


class GoalPatch(BaseModel):
    name: Optional[str] = None
    available_days: Optional[list[str]] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    volume_factor: Optional[float] = None
    intensity_factor: Optional[float] = None
    target_time: Optional[str] = None
    plan_start_date: Optional[str] = None  # restart the plan from a new (Monday) date


class SessionPatch(BaseModel):
    session_date: Optional[str] = None
    status: Optional[str] = None
    rpe_actual: Optional[int] = None
    completed_activity_id: Optional[str] = None
    notes: Optional[str] = None
    injury_override: Optional[dict] = None  # {zone, duration_factor, days}


# ── Goal endpoints ───────────────────────────────────────────────────────────

@router.get("/goals")
def list_goals(conn: DB, status: Optional[str] = Query(None)):
    where = "WHERE status=?" if status else ""
    params = [status] if status else []
    rows = conn.execute(
        f"SELECT * FROM race_goals {where} ORDER BY race_date ASC", params
    ).fetchall()
    return [_goal_out(r, conn) for r in rows]


@router.post("/goals", status_code=201)
def create_goal(body: GoalCreate, conn: DB):
    race_type = body.race_type
    variant = body.variant

    # Validate template exists
    available_variants = RACE_TYPE_VARIANTS.get(race_type, ["balanced"])
    if variant not in available_variants:
        variant = available_variants[0]

    total_weeks = RACE_TYPE_WEEKS[race_type]
    race_date_d = date.fromisoformat(body.race_date)
    plan_start_d = race_date_d - timedelta(weeks=total_weeks)
    plan_start_str = plan_start_d.isoformat()
    today_d = date.today()

    avail_str = ",".join(body.available_days)

    cur = conn.execute(
        """INSERT INTO race_goals
           (name, race_type, variant, race_date, plan_start_date, status,
            available_days, respect_roster, volume_factor, intensity_factor, notes, target_time)
           VALUES (?,?,?,?,?,'active',?,?,?,?,?,?)""",
        (
            body.name, race_type, variant,
            body.race_date, plan_start_str,
            avail_str,
            1 if body.respect_roster else 0,
            body.volume_factor, body.intensity_factor,
            body.notes, body.target_time,
        ),
    )
    conn.commit()
    goal_id = cur.lastrowid
    goal_row = _row(conn, "race_goals", goal_id)

    sessions_created = 0
    waiting = plan_start_d > today_d
    if not waiting:
        sessions_created = _materialize_sessions(conn, goal_id, goal_row)

    out = _goal_out(goal_row, conn)
    out["sessions_created"] = sessions_created
    out["waiting"] = waiting
    return out


@router.get("/goals/{goal_id}")
def get_goal(goal_id: int, conn: DB):
    row = _row(conn, "race_goals", goal_id)
    return _goal_out(row, conn)


@router.patch("/goals/{goal_id}")
def patch_goal(goal_id: int, body: GoalPatch, conn: DB):
    row = _row(conn, "race_goals", goal_id)

    updates: list[str] = ["updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"]
    params: list = []

    if body.name is not None:
        updates.append("name=?")
        params.append(body.name)
    if body.notes is not None:
        updates.append("notes=?")
        params.append(body.notes)
    if body.status is not None:
        if body.status not in ("active", "completed", "abandoned"):
            raise HTTPException(status_code=422, detail="Invalid status")
        updates.append("status=?")
        params.append(body.status)
    if body.volume_factor is not None:
        updates.append("volume_factor=?")
        params.append(body.volume_factor)
    if body.intensity_factor is not None:
        updates.append("intensity_factor=?")
        params.append(body.intensity_factor)
    if body.target_time is not None:
        updates.append("target_time=?")
        params.append(body.target_time)

    regenerate = False
    restart = False
    if body.available_days is not None:
        if len(body.available_days) < 3:
            raise HTTPException(status_code=422, detail="Need at least 3 available days")
        updates.append("available_days=?")
        params.append(",".join(body.available_days))
        regenerate = True

    if body.plan_start_date is not None:
        try:
            date.fromisoformat(body.plan_start_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="plan_start_date must be ISO YYYY-MM-DD")
        updates.append("plan_start_date=?")
        params.append(body.plan_start_date)
        regenerate = True
        restart = True

    params.append(goal_id)
    conn.execute(
        f"UPDATE race_goals SET {', '.join(updates)} WHERE id=?", params
    )
    conn.commit()

    if regenerate:
        # A restart (new plan_start_date) wipes the whole schedule and rebuilds;
        # an availability-only change preserves completed/skipped history.
        if restart:
            conn.execute("DELETE FROM plan_sessions WHERE goal_id=?", (goal_id,))
        else:
            conn.execute(
                "DELETE FROM plan_sessions WHERE goal_id=? AND status='pending'",
                (goal_id,),
            )
        conn.commit()
        updated_row = _row(conn, "race_goals", goal_id)
        plan_start = updated_row["plan_start_date"]
        if plan_start and date.fromisoformat(plan_start) <= date.today():
            _materialize_sessions(conn, goal_id, updated_row)

    return _goal_out(_row(conn, "race_goals", goal_id), conn)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, conn: DB):
    _row(conn, "race_goals", goal_id)
    conn.execute("DELETE FROM race_goals WHERE id=?", (goal_id,))
    conn.commit()


@router.post("/goals/{goal_id}/start-early", status_code=200)
def start_plan_early(goal_id: int, conn: DB):
    """Materialize sessions now even if plan_start_date is in the future."""
    row = _row(conn, "race_goals", goal_id)
    existing = conn.execute(
        "SELECT COUNT(*) as c FROM plan_sessions WHERE goal_id=?", (goal_id,)
    ).fetchone()
    if existing["c"] > 0:
        return {"message": "Sessions already materialized", "sessions_created": existing["c"]}
    count = _materialize_sessions(conn, goal_id, row)
    # Update plan_start_date to today
    conn.execute(
        "UPDATE race_goals SET plan_start_date=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
        (_today(), goal_id),
    )
    conn.commit()
    return {"sessions_created": count}


@router.post("/goals/{goal_id}/rematerialize", status_code=200)
def rematerialize_goal(
    goal_id: int,
    conn: DB,
    from_date: Optional[str] = Query(None, alias="from"),
):
    """
    Delete pending sessions and regenerate the plan from plan_start_date.
    Completed/skipped sessions are preserved.

    Pass ?from=current_week (or ?from=YYYY-MM-DD) to only rebuild the remaining
    plan from that date onward — used after a mid-plan template change so past
    weeks (with their logged history) are left untouched and not duplicated.
    """
    row = _row(conn, "race_goals", goal_id)

    cutoff: Optional[str] = None
    if from_date:
        if from_date == "current_week":
            today_d = date.today()
            cutoff = (today_d - timedelta(days=today_d.weekday())).isoformat()
        else:
            try:
                date.fromisoformat(from_date)
            except ValueError:
                raise HTTPException(status_code=422, detail="from must be 'current_week' or ISO YYYY-MM-DD")
            cutoff = from_date

    if cutoff:
        deleted = conn.execute(
            "DELETE FROM plan_sessions WHERE goal_id=? AND status='pending' AND session_date >= ?",
            (goal_id, cutoff),
        ).rowcount
    else:
        deleted = conn.execute(
            "DELETE FROM plan_sessions WHERE goal_id=? AND status='pending'",
            (goal_id,),
        ).rowcount
    conn.commit()
    count = _materialize_sessions(conn, goal_id, row, from_date=cutoff)
    return {"sessions_deleted": deleted, "sessions_created": count, "from": cutoff}


@router.get("/goals/{goal_id}/pace-zones")
def get_pace_zones(goal_id: int, conn: DB):
    """
    Return personalized pace zones for the goal's primary discipline.

    Priority:
    1. goal.target_time → VDOT multiplier logic (from race time)
    2. Last-90-day activity history → empirical Z2 anchor
    3. athlete_zones defaults → VO2max estimate
    """
    row = _row(conn, "race_goals", goal_id)
    race_type = row["race_type"]
    target_time = row["target_time"] if "target_time" in row.keys() else None

    # Determine primary discipline and sport key
    if race_type in ("half_marathon", "marathon", "5k", "10k"):
        sport = "running"
        distance_km = {
            "5k": 5.0, "10k": 10.0,
            "half_marathon": 21.1, "marathon": 42.2,
        }.get(race_type, 21.1)
    elif race_type in ("triathlon_olympic", "half_ironman", "ironman"):
        sport = "running"  # Default to run zones for triathlon
        distance_km = {"triathlon_olympic": 10.0, "half_ironman": 21.1, "ironman": 42.2}.get(race_type, 21.1)
    else:
        sport = "running"
        distance_km = 21.1

    _zones_from_threshold = _run_zones_from_threshold

    # Tier 0: a measured/benchmarked run threshold in athlete_zones (non-placeholder)
    # reflects current fitness best and wins over everything else.
    run_zone = _latest_zone_row(conn, "run")
    if (run_zone and run_zone["valid_from"] != "2019-01-01"
            and run_zone["threshold_pace_s_per_km"]):
        threshold_s_km = float(run_zone["threshold_pace_s_per_km"])
        return {
            "sport": sport,
            "source": "athlete_zones",
            "target_time": target_time,
            "threshold_pace_s_km": round(threshold_s_km),
            "threshold_pace_display": _s_per_km_to_display(threshold_s_km),
            "zones": _zones_from_threshold(threshold_s_km),
            "activities_analyzed": None,
            "window_days": None,
        }

    # Tier 1: derive from target race time — ONLY for pure running races.
    # For triathlons, target_time is the whole-race time (swim+bike+run), so it
    # cannot be read as a 21.1km run split; fall through to activity history.
    is_running_race = race_type in ("half_marathon", "marathon", "5k", "10k")
    if target_time and is_running_race:
        try:
            parts = target_time.split(":")
            if len(parts) == 3:
                total_min = int(parts[0]) * 60 + int(parts[1]) + int(parts[2]) / 60
            else:
                total_min = int(parts[0]) * 60 + int(parts[1])
            race_pace_s_km = (total_min * 60) / distance_km
            threshold_multiplier = {5.0: 0.95, 10.0: 1.02, 21.1: 1.08, 42.2: 1.15}.get(distance_km, 1.08)
            threshold_s_km = race_pace_s_km * threshold_multiplier
            return {
                "sport": sport,
                "source": "race_time",
                "target_time": target_time,
                "threshold_pace_s_km": round(threshold_s_km),
                "threshold_pace_display": _s_per_km_to_display(threshold_s_km),
                "zones": _zones_from_threshold(threshold_s_km),
                "activities_analyzed": None,
                "window_days": None,
            }
        except Exception:
            pass

    # Tier 2: derive from last-90-day activity history (Z2 bucket anchor)
    # Z2 HR range: 76–86% of max HR. Using default max_hr=195 → Z2 = 148–167 bpm.
    # Try to get actual max_hr from athlete_zones if available.
    zones_row = None
    try:
        zones_row = conn.execute(
            "SELECT max_hr, threshold_hr FROM athlete_zones WHERE sport='run' "
            "ORDER BY valid_from DESC LIMIT 1"
        ).fetchone()
    except Exception:
        pass

    max_hr = (zones_row["max_hr"] if zones_row else None) or 195
    z2_lo = round(max_hr * 0.76)
    z2_hi = round(max_hr * 0.86)

    runs = conn.execute(
        """SELECT avg_speed_mps FROM activities
           WHERE activity_type IN ('running','trail_running')
             AND date >= date('now','-90 days')
             AND avg_heart_rate BETWEEN ? AND ?
             AND avg_speed_mps > 0""",
        (z2_lo, z2_hi),
    ).fetchall()

    if len(runs) >= 3:
        avg_speed = sum(r["avg_speed_mps"] for r in runs) / len(runs)
        z2_pace_s_km = 1000.0 / avg_speed
        # Back-calculate threshold: Z2 = threshold × 1.15
        threshold_s_km = z2_pace_s_km / 1.15
        return {
            "sport": sport,
            "source": "activity_history",
            "target_time": None,
            "threshold_pace_s_km": round(threshold_s_km),
            "threshold_pace_display": _s_per_km_to_display(threshold_s_km),
            "zones": _zones_from_threshold(threshold_s_km),
            "activities_analyzed": len(runs),
            "window_days": 90,
        }

    # Tier 3: fallback — VO2max-based estimate or fixed default
    physio = None
    try:
        physio = conn.execute(
            "SELECT vo2max_run FROM garmin_physio WHERE vo2max_run IS NOT NULL ORDER BY date DESC LIMIT 1"
        ).fetchone()
    except Exception:
        pass

    if physio and physio["vo2max_run"]:
        # Jack Daniels VDOT: threshold pace ≈ 0.83 × vVO2max pace
        # vVO2max (m/min) ≈ VO2max × 0.21 (Daniels constant)
        vvo2max_m_min = physio["vo2max_run"] * 0.21 * 1000.0 / 60.0  # m/s
        vvo2max_s_km = 1000.0 / vvo2max_m_min
        threshold_s_km = vvo2max_s_km / 0.83
    else:
        threshold_s_km = 285.0  # ~4:45/km sensible default for a solid club runner

    return {
        "sport": sport,
        "source": "default",
        "target_time": None,
        "threshold_pace_s_km": round(threshold_s_km),
        "threshold_pace_display": _s_per_km_to_display(threshold_s_km),
        "zones": _zones_from_threshold(threshold_s_km),
        "activities_analyzed": None,
        "window_days": None,
    }


@router.get("/goals/{goal_id}/discipline-zones")
def get_discipline_zones(goal_id: int, conn: DB):
    """
    Per-discipline training targets resolved from athlete_zones, used to render
    structured-workout steps. Run = pace/km; ride = HR bands + RPE + a flat-speed
    hint (no power meter this year); swim = CSS-offset pace/100m.
    """
    _row(conn, "race_goals", goal_id)
    out: dict = {}

    # ---- RUN: reuse the /pace-zones tiering for the threshold, then bands ----
    pace = get_pace_zones(goal_id, conn)
    out["run"] = {
        "source": pace.get("source"),
        "threshold_pace_s_km": pace.get("threshold_pace_s_km"),
        "threshold_pace_display": pace.get("threshold_pace_display"),
        "zones": pace.get("zones"),
    }

    # ---- RIDE: HR bands from athlete_zones + speed hint from reference pace ----
    ride_row = _latest_zone_row(conn, "ride")
    ride_zones: dict = {}
    ref_speed_kmh = None
    threshold_hr = ride_row["threshold_hr"] if ride_row else None
    if ride_row and ride_row["threshold_pace_s_per_km"]:
        ref_speed_kmh = round(3600.0 / ride_row["threshold_pace_s_per_km"], 1)  # 1000m/s→km/h
    zone_bands = []
    if ride_row and ride_row["zones_json"]:
        try:
            zone_bands = json.loads(ride_row["zones_json"])
        except Exception:
            zone_bands = []
    band_by_name = {b["name"]: b for b in zone_bands}
    for z in ("Z1", "Z2", "Z3", "Z4", "Z5"):
        band = band_by_name.get(z)
        entry = dict(_ZONE_META[z])
        if band:
            hr_lo, hr_hi = band.get("min_hr"), band.get("max_hr")
            entry["hr_lo"] = hr_lo
            entry["hr_hi"] = None if hr_hi and hr_hi >= 999 else hr_hi
            if hr_lo is not None:
                hi_disp = "+" if (hr_hi and hr_hi >= 999) else f"–{entry['hr_hi']}"
                entry["display"] = f"{hr_lo}{hi_disp} bpm"
        if ref_speed_kmh:
            entry["speed_kmh_hint"] = round(ref_speed_kmh * _SPEED_FACTOR[z], 1)
        ride_zones[z] = entry
    out["ride"] = {
        "source": (ride_row and ("placeholder" if ride_row["valid_from"] == "2019-01-01" else "derived")),
        "threshold_hr": threshold_hr,
        "ref_speed_kmh": ref_speed_kmh,
        "zones": ride_zones,
        "note": "No power meter — pace by HR + RPE + speed feel.",
    }

    # ---- SWIM: CSS-offset pace/100m ----
    swim_row = _latest_zone_row(conn, "swim")
    css = swim_row["css_pace_s_per_100m"] if swim_row else None
    swim_zones: dict = {}
    for z in ("Z1", "Z2", "Z3", "Z4", "Z5"):
        entry = dict(_ZONE_META[z])
        if css:
            pace_100 = css + _CSS_OFFSET[z]
            entry["pace_s_100m"] = round(pace_100)
            entry["display"] = _s_per_100m_to_display(pace_100)
        swim_zones[z] = entry
    out["swim"] = {
        "source": (swim_row and ("placeholder" if swim_row["valid_from"] == "2019-01-01" else "derived")),
        "css_s_100m": css,
        "css_display": _s_per_100m_to_display(css) if css else None,
        "zones": swim_zones,
    }

    return out


# ── Benchmark tests ──────────────────────────────────────────────────────────

class BenchmarkCreate(BaseModel):
    date: Optional[str] = None
    sport: str            # run | ride | swim
    test_type: str        # run_1k_tt | bike_20min | swim_css
    session_id: Optional[int] = None
    result: dict          # run: {time_s}; bike: {avg_hr, avg_speed_kmh}; swim: {t400_s, t200_s}


@router.post("/benchmarks", status_code=201)
def create_benchmark(body: BenchmarkCreate, conn: DB):
    """
    Log a field-test result → derive the new threshold, write a fresh
    athlete_zones row (valid from the test date), record it in benchmark_results,
    mark the linked session completed, and return old→new deltas.
    """
    sport = body.sport
    if sport not in ("run", "ride", "swim"):
        raise HTTPException(status_code=422, detail="sport must be run|ride|swim")
    test_date = body.date or _today()
    r = body.result or {}
    prev = _latest_zone_row(conn, sport)
    max_hr = (prev["max_hr"] if prev else None) or 195

    derived: dict = {}
    old_val = None
    new_val = None
    if body.test_type == "run_1k_tt":
        time_s = float(r.get("time_s") or 0)
        if time_s <= 0:
            raise HTTPException(status_code=422, detail="run_1k_tt needs result.time_s")
        threshold = round(time_s * 1.12)  # 1k pace × 1.12 ≈ threshold pace
        derived = {"threshold_pace_s_per_km": threshold}
        old_val = prev["threshold_pace_s_per_km"] if prev else None
        new_val = threshold
    elif body.test_type == "bike_20min":
        avg_hr = float(r.get("avg_hr") or 0)
        avg_speed = float(r.get("avg_speed_kmh") or 0)
        if avg_hr <= 0:
            raise HTTPException(status_code=422, detail="bike_20min needs result.avg_hr")
        threshold_hr = round(avg_hr * 0.98)
        ref_s_km = round(3600.0 / avg_speed) if avg_speed > 0 else (prev["threshold_pace_s_per_km"] if prev else None)
        derived = {"threshold_hr": threshold_hr, "threshold_pace_s_per_km": ref_s_km}
        old_val = prev["threshold_hr"] if prev else None
        new_val = threshold_hr
    elif body.test_type == "swim_css":
        t400 = float(r.get("t400_s") or 0)
        t200 = float(r.get("t200_s") or 0)
        if t400 <= 0 or t200 <= 0:
            raise HTTPException(status_code=422, detail="swim_css needs result.t400_s and t200_s")
        css = round((t400 - t200) / 2.0)  # per-100m
        derived = {"css_pace_s_per_100m": css}
        old_val = prev["css_pace_s_per_100m"] if prev else None
        new_val = css
    else:
        raise HTTPException(status_code=422, detail="Unknown test_type")

    # Build the new athlete_zones row (carry forward unspecified fields)
    row_vals = {
        "max_hr": max_hr,
        "threshold_hr": derived.get("threshold_hr", prev["threshold_hr"] if prev else None),
        "ftp_w": prev["ftp_w"] if prev else None,
        "threshold_pace_s_per_km": derived.get("threshold_pace_s_per_km",
                                               prev["threshold_pace_s_per_km"] if prev else None),
        "css_pace_s_per_100m": derived.get("css_pace_s_per_100m",
                                           prev["css_pace_s_per_100m"] if prev else None),
    }
    conn.execute(
        """INSERT OR REPLACE INTO athlete_zones
           (valid_from, sport, max_hr, threshold_hr, ftp_w,
            threshold_pace_s_per_km, css_pace_s_per_100m, zones_json)
           VALUES (?,?,?,?,?,?,?,?)""",
        (test_date, sport, row_vals["max_hr"], row_vals["threshold_hr"], row_vals["ftp_w"],
         row_vals["threshold_pace_s_per_km"], row_vals["css_pace_s_per_100m"],
         _zones_json_from_max(row_vals["max_hr"])),
    )

    delta = {"old": old_val, "new": new_val,
             "change": (round(new_val - old_val, 1) if (old_val is not None and new_val is not None) else None)}
    conn.execute(
        """INSERT INTO benchmark_results (date, sport, test_type, result_json, derived_json, session_id)
           VALUES (?,?,?,?,?,?)""",
        (test_date, sport, body.test_type, json.dumps(r), json.dumps({**derived, "delta": delta}),
         body.session_id),
    )

    # Mark the linked test session completed
    if body.session_id:
        conn.execute(
            "UPDATE plan_sessions SET status='completed', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
            (body.session_id,),
        )
    conn.commit()

    return {"date": test_date, "sport": sport, "test_type": body.test_type,
            "derived": derived, "delta": delta}


@router.get("/benchmarks")
def list_benchmarks(conn: DB, sport: Optional[str] = Query(None)):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='benchmark_results'").fetchone():
        return []
    where = "WHERE sport=?" if sport else ""
    params = [sport] if sport else []
    rows = conn.execute(
        f"SELECT * FROM benchmark_results {where} ORDER BY date DESC, id DESC", params
    ).fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "date": r["date"], "sport": r["sport"], "test_type": r["test_type"],
            "result": json.loads(r["result_json"]) if r["result_json"] else None,
            "derived": json.loads(r["derived_json"]) if r["derived_json"] else None,
            "session_id": r["session_id"],
        })
    return out


# ── Day endpoint ─────────────────────────────────────────────────────────────

@router.get("/day/{date_str}")
def day_prescription(date_str: str, conn: DB):
    """
    Returns all sessions scheduled for a given date across all active goals,
    plus readiness context, load warnings, and injury suggestions.
    """
    # Readiness context — gather from multiple tables
    tl = conn.execute(
        "SELECT ctl, atl, tsb, ramp_rate FROM training_load_daily WHERE date=?",
        (date_str,),
    ).fetchone()
    hrv = conn.execute(
        "SELECT status FROM hrv WHERE date=?", (date_str,)
    ).fetchone()
    roster = None
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name='roster'").fetchone():
        roster = conn.execute(
            "SELECT duty_type FROM roster WHERE date=?", (date_str,)
        ).fetchone()
    daily = conn.execute(
        "SELECT body_battery_high FROM daily_stats WHERE date=?", (date_str,)
    ).fetchone()
    load_idx = conn.execute(
        "SELECT fatigue_score, recovery_status FROM load_index WHERE date=? ORDER BY computed_at DESC LIMIT 1",
        (date_str,)
    ).fetchone()
    physio = conn.execute(
        "SELECT training_readiness_score FROM garmin_physio WHERE date=? LIMIT 1",
        (date_str,)
    ).fetchone()

    tsb = tl["tsb"] if tl else None
    overall_signal = "moderate"
    if tsb is not None:
        if tsb > 5:
            overall_signal = "high"
        elif tsb < -15:
            overall_signal = "low"

    readiness_context = {
        "ctl": tl["ctl"] if tl else None,
        "atl": tl["atl"] if tl else None,
        "tsb": tsb,
        "training_readiness": physio["training_readiness_score"] if physio else None,
        "hrv_status": hrv["status"] if hrv else None,
        "roster_today": roster["duty_type"] if roster else None,
        "overall_signal": overall_signal,
        "fatigue_score": load_idx["fatigue_score"] if load_idx else None,
        "recovery_status": load_idx["recovery_status"] if load_idx else None,
        "body_battery": daily["body_battery_high"] if daily else None,
        "garmin_readiness": physio["training_readiness_score"] if physio else None,
        "ramp_rate": tl["ramp_rate"] if tl else None,
    }

    # Sessions for this date from active goals (pending + completed)
    rows = conn.execute(
        """SELECT ps.*, rg.name as goal_name, rg.volume_factor, rg.intensity_factor,
                  rg.last_adaptation_json, rg.plan_start_date, rg.race_date as rg_race_date,
                  rg.race_type
           FROM plan_sessions ps
           JOIN race_goals rg ON ps.goal_id = rg.id
           WHERE ps.session_date=? AND rg.status='active' AND ps.status IN ('pending','completed')
           ORDER BY ps.discipline, ps.intensity_zone""",
        (date_str,),
    ).fetchall()

    sessions = []
    for r in rows:
        adaptation_note = None
        if r["last_adaptation_json"]:
            try:
                adapt = json.loads(r["last_adaptation_json"])
                rec = adapt.get("recommendation")
                if rec and rec not in ("maintain_course", "maintain_intensity"):
                    adaptation_note = RECOMMENDATION_EXPLANATIONS.get(rec)
            except Exception:
                pass

        roster_warning = None
        if roster and roster["duty_type"] in ("FLT", "SBY"):
            roster_warning = f"{roster['duty_type']} duty today — session optional"

        # Compute current phase for display
        plan_start = r["plan_start_date"]
        total_weeks = _plan_total_weeks(conn, {"id": r["goal_id"], "plan_start_date": plan_start,
                                               "race_date": r["rg_race_date"], "race_type": r["race_type"]})
        current_week_num = _current_week(plan_start, total_weeks)
        phase = _phase_for_week(current_week_num, total_weeks)
        race_date_val = r["rg_race_date"]
        days_until_race = None
        weeks_to_race = None
        if race_date_val:
            days_until_race = max(0, (date.fromisoformat(race_date_val) - date.today()).days)
            weeks_to_race = days_until_race // 7

        # Per-session fueling targets (uses the latest hot-conditions sweat rate if known)
        fuel = _session_fuel(conn, r["effective_duration_min"] or r["duration_min"],
                             r["intensity_zone"], r["discipline"], weeks_to_race)

        sessions.append({
            **_session_out(r),
            "goal_name": r["goal_name"],
            "adaptation_note": adaptation_note,
            "roster_warning": roster_warning,
            "current_phase": phase.value,
            "current_week": current_week_num,
            "total_weeks": total_weeks,
            "days_until_race": days_until_race,
            "fueling": fuel,
        })

    # Combined load warning for multiple active goals
    load_warning = None
    conflict_warning = None
    if len(sessions) > 1 and tsb is not None:
        # Rough TSS estimate: effective_duration * zone_intensity_factor
        zone_tss = {"Z1": 0.5, "Z2": 0.65, "Z3": 0.85, "Z4": 1.05, "Z5": 1.2}
        combined_tss = sum(
            (s["effective_duration_min"] or 0) * zone_tss.get(s["intensity_zone"], 0.7)
            for s in sessions
        )
        projected_tsb = tsb - combined_tss * 0.1
        if projected_tsb < -25:
            load_warning = (
                f"Combined training load is high today (TSB would reach ~{projected_tsb:.0f}). "
                "Consider doing only the higher-priority session or reducing one."
            )

        # Conflict check: same discipline, both Z4+
        by_disc: dict[str, list] = {}
        for s in sessions:
            by_disc.setdefault(s["discipline"], []).append(s)
        for disc, ss in by_disc.items():
            hard = [s for s in ss if s["intensity_zone"] in ("Z4", "Z5")]
            if len(hard) >= 2:
                conflict_warning = (
                    f"Two hard {disc} sessions today from different plans. "
                    "Recommend keeping only one."
                )
                break

    # Injury suggestions
    injury_suggestions = []
    injuries = conn.execute(
        "SELECT * FROM injuries WHERE status IN ('active','recovering')",
    ).fetchall()
    for inj in injuries:
        disc = (inj["activity_type"] or "").lower()
        affected = [
            s["id"] for s in sessions
            if disc and disc in s["discipline"]
        ]
        if not affected:
            continue
        # look forward 14 days for affected sessions
        end_14 = (date.fromisoformat(date_str) + timedelta(days=14)).isoformat()
        future = conn.execute(
            """SELECT id FROM plan_sessions
               WHERE goal_id IN (SELECT id FROM race_goals WHERE status='active')
               AND discipline LIKE ? AND session_date BETWEEN ? AND ? AND status='pending'""",
            (f"%{disc}%", date_str, end_14),
        ).fetchall()
        if future:
            injury_suggestions.append({
                "injury_id": inj["id"],
                "zone": inj["zone"],
                "activity_type": disc,
                "suggested_action": "reduce_intensity",
                "affected_sessions": [r["id"] for r in future],
                "message": (
                    f"Active {inj['zone']} injury detected. Suggest Z1 + halved duration "
                    f"for next 14 days of {disc} sessions. Apply?"
                ),
            })

    return {
        "date": date_str,
        "readiness_context": readiness_context,
        "sessions": sessions,
        "load_warning": load_warning,
        "conflict_warning": conflict_warning,
        "injury_suggestions": injury_suggestions,
    }


# ── Session endpoints ────────────────────────────────────────────────────────

@router.patch("/sessions/{session_id}")
def patch_session(session_id: int, body: SessionPatch, conn: DB):
    row = _row(conn, "plan_sessions", session_id)

    updates: list[str] = ["updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"]
    params: list = []

    # Move: validate new date stays within same week's Mon–Sun
    if body.session_date is not None:
        mon, sun = _week_bounds(row["session_date"])
        if not (mon <= body.session_date <= sun):
            raise HTTPException(
                status_code=400,
                detail=f"Can only move session within the same week ({mon} to {sun})"
            )
        updates.append("session_date=?")
        params.append(body.session_date)
        updates.append("is_displaced=1")

    if body.status is not None:
        if body.status not in ("pending", "completed", "skipped", "displaced"):
            raise HTTPException(status_code=422, detail="Invalid status")
        updates.append("status=?")
        params.append(body.status)

    if body.rpe_actual is not None:
        if not (1 <= body.rpe_actual <= 10):
            raise HTTPException(status_code=422, detail="rpe_actual must be 1–10")
        updates.append("rpe_actual=?")
        params.append(body.rpe_actual)

    if body.completed_activity_id is not None:
        updates.append("completed_activity_id=?")
        params.append(body.completed_activity_id)

    if body.notes is not None:
        updates.append("notes=?")
        params.append(body.notes)

    params.append(session_id)
    conn.execute(
        f"UPDATE plan_sessions SET {', '.join(updates)} WHERE id=?", params
    )
    conn.commit()

    # Injury override: update affected future sessions
    if body.injury_override:
        override = body.injury_override
        zone = override.get("zone", "Z1")
        dur_factor = override.get("duration_factor", 0.5)
        days = int(override.get("days", 14))
        disc = row["discipline"]
        cutoff = (date.today() + timedelta(days=days)).isoformat()

        future_sessions = conn.execute(
            """SELECT id, duration_min FROM plan_sessions
               WHERE goal_id=? AND discipline=? AND session_date BETWEEN ? AND ? AND status='pending'""",
            (row["goal_id"], disc, _today(), cutoff),
        ).fetchall()
        for fs in future_sessions:
            new_dur = max(10, round(fs["duration_min"] * dur_factor))
            conn.execute(
                """UPDATE plan_sessions
                   SET intensity_zone=?, effective_duration_min=?,
                       notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                   WHERE id=?""",
                (zone, new_dur, f"Reduced — injury override (user confirmed)", fs["id"]),
            )
        conn.commit()

    return _session_out(_row(conn, "plan_sessions", session_id))


# ── Week view ────────────────────────────────────────────────────────────────

@router.get("/goals/{goal_id}/week")
def goal_week(goal_id: int, conn: DB, date: Optional[str] = Query(None)):
    _row(conn, "race_goals", goal_id)
    ref = date or _today()
    mon, sun = _week_bounds(ref)
    rows = conn.execute(
        """SELECT * FROM plan_sessions
           WHERE goal_id=? AND session_date BETWEEN ? AND ?
           ORDER BY session_date, discipline""",
        (goal_id, mon, sun),
    ).fetchall()

    # Roster for the week
    roster_rows = conn.execute(
        "SELECT date, duty_type FROM roster WHERE date BETWEEN ? AND ?",
        (mon, sun),
    ).fetchall()
    roster_map = {r["date"]: r["duty_type"] for r in roster_rows}

    # Build 7-day structure
    days_out = []
    d = datetime.fromisoformat(mon)
    sessions_by_date: dict[str, list] = {}
    for r in rows:
        sessions_by_date.setdefault(r["session_date"], []).append(_session_out(r))

    for _ in range(7):
        ds = d.strftime("%Y-%m-%d")
        days_out.append({
            "date": ds,
            "day_name": d.strftime("%A"),
            "sessions": sessions_by_date.get(ds, []),
            "roster": roster_map.get(ds),
        })
        d += timedelta(days=1)

    return {"week_start": mon, "week_end": sun, "days": days_out}


# ── Full schedule ────────────────────────────────────────────────────────────

@router.get("/goals/{goal_id}/sessions")
def goal_sessions(
    goal_id: int,
    conn: DB,
    week: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
):
    _row(conn, "race_goals", goal_id)
    clauses = ["goal_id=?"]
    params: list = [goal_id]
    if week is not None:
        clauses.append("week_number=?")
        params.append(week)
    if status:
        clauses.append("status=?")
        params.append(status)
    rows = conn.execute(
        f"SELECT * FROM plan_sessions WHERE {' AND '.join(clauses)} ORDER BY session_date, discipline",
        params,
    ).fetchall()
    return [_session_out(r) for r in rows]


# ── Race-day nutrition plan ──────────────────────────────────────────────────

class NutritionPlanGenerate(BaseModel):
    weight_kg: float = 85.0
    target_splits: Optional[dict] = None
    carbs_g_h_override: Optional[int] = None


def _trained_carbs_g_h(conn, goal_id: int) -> Optional[int]:
    """Best carbs/h actually logged on a gut-training session for this goal."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fueling_logs'").fetchone():
        return None
    row = conn.execute(
        """SELECT MAX(fl.carbs_g / (fl.duration_min/60.0)) AS best
           FROM fueling_logs fl JOIN plan_sessions ps ON ps.id = fl.plan_session_id
           WHERE ps.goal_id=? AND fl.carbs_g IS NOT NULL AND fl.duration_min>0""",
        (goal_id,),
    ).fetchone()
    return round(row["best"]) if row and row["best"] else None


@router.post("/goals/{goal_id}/nutrition-plan/generate")
def generate_nutrition_plan(goal_id: int, body: NutritionPlanGenerate, conn: DB):
    goal_row = _row(conn, "race_goals", goal_id)
    from domains.training import race_nutrition
    plan = race_nutrition.build_race_plan(
        goal_row,
        weight_kg=body.weight_kg,
        race_sweat_rate_l_h=_race_sweat_rate(conn),
        trained_carbs_g_h=body.carbs_g_h_override or _trained_carbs_g_h(conn, goal_id),
        target_splits=body.target_splits,
    )
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='race_nutrition_plans'").fetchone():
        conn.execute(
            """INSERT INTO race_nutrition_plans (goal_id, plan_json, updated_at)
               VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
               ON CONFLICT(goal_id) DO UPDATE SET plan_json=excluded.plan_json, updated_at=excluded.updated_at""",
            (goal_id, json.dumps(plan)),
        )
        conn.commit()
    return plan


@router.get("/goals/{goal_id}/nutrition-plan")
def get_nutrition_plan(goal_id: int, conn: DB):
    _row(conn, "race_goals", goal_id)
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='race_nutrition_plans'").fetchone():
        return None
    row = conn.execute("SELECT plan_json, updated_at FROM race_nutrition_plans WHERE goal_id=?", (goal_id,)).fetchone()
    if not row:
        return None
    return {"plan": json.loads(row["plan_json"]), "updated_at": row["updated_at"]}


class NutritionPlanPut(BaseModel):
    plan: dict


@router.put("/goals/{goal_id}/nutrition-plan")
def put_nutrition_plan(goal_id: int, body: NutritionPlanPut, conn: DB):
    _row(conn, "race_goals", goal_id)
    conn.execute(
        """INSERT INTO race_nutrition_plans (goal_id, plan_json, updated_at)
           VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
           ON CONFLICT(goal_id) DO UPDATE SET plan_json=excluded.plan_json, updated_at=excluded.updated_at""",
        (goal_id, json.dumps(body.plan)),
    )
    conn.commit()
    return {"plan": body.plan}


# ── Adaptation ───────────────────────────────────────────────────────────────

@router.post("/goals/{goal_id}/adapt")
def adapt_goal(goal_id: int, conn: DB):
    """Run adaptation engine against last 7 days of real data, update future sessions."""
    goal_row = _row(conn, "race_goals", goal_id)

    week_data, daily_loads = map_daybook_data(conn, goal_id)

    race_date_d = date.fromisoformat(goal_row["race_date"])
    plan_start_str = goal_row["plan_start_date"] or _today()
    total_weeks = _plan_total_weeks(conn, goal_row)
    today_d = date.today()
    current_week = _current_week(plan_start_str, total_weeks)
    weeks_remaining = max(1, (race_date_d - today_d).days // 7)
    phase = _phase_for_week(current_week, total_weeks)

    result = _engine.process_training_week(
        recent_weeks=[week_data],
        plan_phase=phase,
        weeks_remaining=weeks_remaining,
        daily_loads=daily_loads if daily_loads else None,
    )

    new_volume = result["volume_factor"]
    new_intensity = result["intensity_factor"]

    # Tag the adaptation with the current week so it can auto-expire next week
    result["adaptation_week"] = current_week

    # Persist factors and adaptation JSON on goal
    conn.execute(
        """UPDATE race_goals
           SET volume_factor=?, intensity_factor=?, last_adaptation_json=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE id=?""",
        (new_volume, new_intensity, json.dumps(result), goal_id),
    )

    # Apply effective_duration_min only to THIS WEEK's pending sessions
    # (adaptation is week-scoped — next week resets to base duration)
    week_start = (today_d - timedelta(days=today_d.weekday())).isoformat()
    week_end = (today_d - timedelta(days=today_d.weekday()) + timedelta(days=6)).isoformat()
    week_sessions = conn.execute(
        "SELECT id, duration_min FROM plan_sessions WHERE goal_id=? AND status='pending' AND session_date BETWEEN ? AND ?",
        (goal_id, week_start, week_end),
    ).fetchall()
    for fs in week_sessions:
        new_dur = _effective_duration(fs["duration_min"], new_volume)
        conn.execute(
            "UPDATE plan_sessions SET effective_duration_min=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
            (new_dur, fs["id"]),
        )

    # Optional LLM narrative explaining the decision — deterministic explanation
    # is always present in `result`; the narrative is a graceful-fallback bonus.
    narrative = _adaptation_narrative(conn, goal_id, week_start, week_end, result,
                                      week_data, phase, current_week, total_weeks, weeks_remaining)
    result["narrative"] = narrative

    # Adaptation history log (never let logging failures break the endpoint)
    try:
        conn.execute(
            """INSERT INTO adaptation_log
               (goal_id, date, week_number, readiness_score, risk_level, recommendation,
                volume_factor, intensity_factor, inputs_json, narrative)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (goal_id, _today(), current_week, result["readiness_score"], result["risk_level"],
             result["recommendation"], new_volume, new_intensity,
             json.dumps({
                 "tsb": week_data.tsb, "ramp_rate": week_data.ramp_rate,
                 "compliance": round(week_data.compliance_score, 3),
                 "avg_rpe": round(week_data.avg_rpe, 1),
                 "sleep_debt": round(week_data.sleep_debt, 1),
                 "hrv_trend": week_data.hrv_trend,
             }), narrative),
        )
    except Exception:
        pass

    conn.commit()

    return {
        **result,
        "sessions_updated": len(week_sessions),
        "goal_id": goal_id,
    }


def _adaptation_narrative(conn, goal_id, week_start, week_end, result, week_data,
                          phase, current_week, total_weeks, weeks_remaining):
    """Build a short coach narrative via Ollama; return None on any failure."""
    try:
        from domains.ai import ollama_client, prompt_builder
        if not ollama_client.is_available():
            return None
        key_rows = conn.execute(
            """SELECT session_type, effective_duration_min, duration_min, intensity_zone
               FROM plan_sessions WHERE goal_id=? AND session_date BETWEEN ? AND ?
               ORDER BY CASE intensity_zone WHEN 'Z5' THEN 5 WHEN 'Z4' THEN 4 WHEN 'Z3' THEN 3
                        WHEN 'Z2' THEN 2 ELSE 1 END DESC LIMIT 4""",
            (goal_id, week_start, week_end),
        ).fetchall()
        key_sessions = [
            f"{r['session_type']} ({r['effective_duration_min'] or r['duration_min']}min {r['intensity_zone']})"
            for r in key_rows
        ]
        prompt = prompt_builder.adaptation_narrative({
            "recommendation": result["recommendation"],
            "readiness_score": result["readiness_score"],
            "risk_level": result["risk_level"],
            "volume_factor": result["volume_factor"],
            "intensity_factor": result["intensity_factor"],
            "phase": phase.value,
            "week_number": current_week,
            "total_weeks": total_weeks,
            "weeks_to_race": weeks_remaining,
            "tsb": week_data.tsb,
            "ramp_rate": week_data.ramp_rate,
            "compliance_pct": round(week_data.compliance_score * 100),
            "avg_rpe": round(week_data.avg_rpe, 1),
            "key_sessions": key_sessions,
        })
        text = ollama_client.generate(prompt)
        return text.strip() if text else None
    except Exception:
        return None


@router.get("/goals/{goal_id}/adaptations")
def goal_adaptations(goal_id: int, conn: DB, limit: int = Query(8)):
    """Recent adaptation-log entries for the goal (most recent first)."""
    _row(conn, "race_goals", goal_id)
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='adaptation_log'").fetchone():
        return []
    rows = conn.execute(
        """SELECT id, date, week_number, readiness_score, risk_level, recommendation,
                  volume_factor, intensity_factor, inputs_json, narrative, created_at
           FROM adaptation_log WHERE goal_id=? ORDER BY id DESC LIMIT ?""",
        (goal_id, limit),
    ).fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "date": r["date"], "week_number": r["week_number"],
            "readiness_score": r["readiness_score"], "risk_level": r["risk_level"],
            "recommendation": r["recommendation"], "volume_factor": r["volume_factor"],
            "intensity_factor": r["intensity_factor"],
            "inputs": json.loads(r["inputs_json"]) if r["inputs_json"] else None,
            "narrative": r["narrative"], "created_at": r["created_at"],
        })
    return out


# ── Compliance ───────────────────────────────────────────────────────────────

@router.get("/goals/{goal_id}/compliance")
def goal_compliance(goal_id: int, conn: DB):
    goal_row = _row(conn, "race_goals", goal_id)
    # Determine current week number so we only show elapsed weeks (not future)
    total_weeks = _plan_total_weeks(conn, goal_row)
    plan_start = goal_row["plan_start_date"]
    current_week_num = _current_week(plan_start, total_weeks)

    # A session is only counted "missed" once it's on/after the plan actually
    # started (or the goal was created) — sessions dated before that are backfill
    # artifacts (e.g. a goal created with a backdated plan_start) and must not
    # pollute compliance or the adaptation engine.
    counts_missed_from = plan_start or _today()
    created = goal_row["created_at"]
    if created:
        created_date = created[:10]
        if created_date > counts_missed_from:
            counts_missed_from = created_date

    rows = conn.execute(
        """SELECT week_number,
                  COUNT(*) as planned,
                  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
                  SUM(CASE WHEN status='skipped'   THEN 1 ELSE 0 END) as skipped,
                  SUM(CASE WHEN status='pending' AND original_date < date('now')
                            AND original_date >= ? THEN 1 ELSE 0 END) as missed
           FROM plan_sessions
           WHERE goal_id=? AND week_number <= ?
           GROUP BY week_number
           ORDER BY week_number""",
        (counts_missed_from, goal_id, current_week_num),
    ).fetchall()

    weeks = []
    total_planned = total_completed = 0
    for r in rows:
        planned = r["planned"] or 0
        completed = r["completed"] or 0
        total_planned += planned
        total_completed += completed
        weeks.append({
            "week": r["week_number"],
            "planned": planned,
            "completed": completed,
            "skipped": r["skipped"] or 0,
            "missed": r["missed"] or 0,
            "rate": round(completed / planned, 2) if planned else 0.0,
        })

    overall_rate = round(total_completed / total_planned, 2) if total_planned else 0.0
    return {
        "goal_id": goal_id,
        "overall_compliance": overall_rate,
        "total_planned": total_planned,
        "total_completed": total_completed,
        "counts_missed_from": counts_missed_from,
        "weeks": weeks,
    }
