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


def _materialize_sessions(conn: sqlite3.Connection, goal_id: int, goal_row: sqlite3.Row) -> int:
    """
    Run the scheduler and INSERT sessions into plan_sessions.
    Returns the number of sessions inserted.
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
            discipline = _discipline_from_type(session["type"])
            eff_dur = _effective_duration(session["duration"], volume_factor)
            conn.execute(
                """INSERT INTO plan_sessions
                   (goal_id, session_date, original_date, week_number,
                    session_type, discipline, duration_min, intensity_zone,
                    is_optional, effective_duration_min, status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,'pending')""",
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
    total_weeks = RACE_TYPE_WEEKS.get(race_type, 16)
    # current week number within the plan
    current_week = 1
    if plan_start:
        ps = date.fromisoformat(plan_start)
        delta = (today_d - ps).days
        current_week = max(1, delta // 7 + 1)

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
    if body.available_days is not None:
        if len(body.available_days) < 3:
            raise HTTPException(status_code=422, detail="Need at least 3 available days")
        updates.append("available_days=?")
        params.append(",".join(body.available_days))
        regenerate = True

    params.append(goal_id)
    conn.execute(
        f"UPDATE race_goals SET {', '.join(updates)} WHERE id=?", params
    )
    conn.commit()

    if regenerate:
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
def rematerialize_goal(goal_id: int, conn: DB):
    """
    Delete all pending sessions and regenerate the full plan from plan_start_date.
    Completed/skipped sessions are preserved. Use this after scheduler fixes or
    availability changes to rebuild the schedule without losing logged history.
    """
    row = _row(conn, "race_goals", goal_id)
    deleted = conn.execute(
        "DELETE FROM plan_sessions WHERE goal_id=? AND status='pending'",
        (goal_id,),
    ).rowcount
    conn.commit()
    count = _materialize_sessions(conn, goal_id, row)
    return {"sessions_deleted": deleted, "sessions_created": count}


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

    # Zone HR% labels and RPE (fixed per zone)
    zone_meta = {
        "Z1": {"hr_pct": "56–75%", "rpe": "2–3", "label": "Recovery"},
        "Z2": {"hr_pct": "76–86%", "rpe": "4–5", "label": "Aerobic"},
        "Z3": {"hr_pct": "87–91%", "rpe": "6–7", "label": "Tempo"},
        "Z4": {"hr_pct": "92–95%", "rpe": "8",   "label": "Threshold"},
        "Z5": {"hr_pct": "95–100%","rpe": "9–10", "label": "VO2max"},
    }

    def _s_per_km_to_display(s: float) -> str:
        m = int(s) // 60
        sec = int(s) % 60
        return f"{m}:{sec:02d}/km"

    def _zones_from_threshold(threshold_s_km: float) -> dict:
        multipliers = {"Z1": 1.37, "Z2": 1.15, "Z3": 1.00, "Z4": 0.885, "Z5": 0.80}
        zones = {}
        for z, mult in multipliers.items():
            pace_s = threshold_s_km * mult
            zones[z] = {
                "pace_s_km": round(pace_s),
                "display": _s_per_km_to_display(pace_s),
                **zone_meta[z],
            }
        return zones

    # Tier 1: derive from target race time
    if target_time:
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
        total_weeks = RACE_TYPE_WEEKS.get(r["race_type"], 16)
        current_week_num = 1
        if plan_start:
            ps_d = date.fromisoformat(plan_start)
            delta = (date.today() - ps_d).days
            current_week_num = max(1, delta // 7 + 1)
        phase = _phase_for_week(current_week_num, total_weeks)

        sessions.append({
            **_session_out(r),
            "goal_name": r["goal_name"],
            "adaptation_note": adaptation_note,
            "roster_warning": roster_warning,
            "current_phase": phase.value,
            "current_week": current_week_num,
            "total_weeks": total_weeks,
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


# ── Adaptation ───────────────────────────────────────────────────────────────

@router.post("/goals/{goal_id}/adapt")
def adapt_goal(goal_id: int, conn: DB):
    """Run adaptation engine against last 7 days of real data, update future sessions."""
    goal_row = _row(conn, "race_goals", goal_id)

    week_data, daily_loads = map_daybook_data(conn, goal_id)

    race_date_d = date.fromisoformat(goal_row["race_date"])
    plan_start_str = goal_row["plan_start_date"] or _today()
    total_weeks = RACE_TYPE_WEEKS.get(goal_row["race_type"], 16)
    today_d = date.today()
    plan_start_d = date.fromisoformat(plan_start_str)
    weeks_elapsed = max(0, (today_d - plan_start_d).days // 7)
    current_week = weeks_elapsed + 1
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
    conn.commit()

    return {
        **result,
        "sessions_updated": len(future_sessions),
        "goal_id": goal_id,
    }


# ── Compliance ───────────────────────────────────────────────────────────────

@router.get("/goals/{goal_id}/compliance")
def goal_compliance(goal_id: int, conn: DB):
    goal_row = _row(conn, "race_goals", goal_id)
    # Determine current week number so we only show elapsed weeks (not future)
    today_d = date.today()
    plan_start = goal_row["plan_start_date"]
    current_week_num = 1
    if plan_start:
        ps_d = date.fromisoformat(plan_start)
        current_week_num = max(1, (today_d - ps_d).days // 7 + 1)

    rows = conn.execute(
        """SELECT week_number,
                  COUNT(*) as planned,
                  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
                  SUM(CASE WHEN status='skipped'   THEN 1 ELSE 0 END) as skipped,
                  SUM(CASE WHEN status='pending' AND original_date < date('now') THEN 1 ELSE 0 END) as missed
           FROM plan_sessions
           WHERE goal_id=? AND week_number <= ?
           GROUP BY week_number
           ORDER BY week_number""",
        (goal_id, current_week_num),
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
        "weeks": weeks,
    }
