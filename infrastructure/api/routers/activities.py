"""
Activities router — /activities endpoints.
Activities are sourced primarily from Garmin; Strava enriches them with
strava_id and segment efforts.
"""

import json
import sqlite3
from collections import defaultdict
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.activity import (
    ActivityCreate,
    ActivityComputedMetrics,
    ActivityDetail,
    ActivityPatch,
    ActivitySummary,
    SegmentEffortOut,
    SplitOut,
    SyncStatusOut,
    TennisPlayer,
    TennisSession,
    TennisSessionWrite,
)

router = APIRouter(prefix="/activities", tags=["activities"])


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_summary(r: sqlite3.Row) -> ActivitySummary:
    keys = r.keys()
    return ActivitySummary(
        id=r["id"],
        date=r["date"],
        source=r["source"],
        strava_id=r["strava_id"],
        activity_type=r["activity_type"],
        name=r["name"],
        start_time=r["start_time"],
        duration_seconds=r["duration_seconds"],
        moving_time_seconds=r["moving_time_seconds"],
        distance_meters=r["distance_meters"],
        elevation_gain_meters=r["elevation_gain_meters"],
        avg_heart_rate=r["avg_heart_rate"],
        max_heart_rate=r["max_heart_rate"],
        avg_speed_mps=r["avg_speed_mps"],
        avg_power_watts=r["avg_power_watts"],
        calories=r["calories"],
        training_stress_score=r["training_stress_score"],
        start_lat=r["start_lat"],
        start_lng=r["start_lng"],
        has_polyline=bool(r["polyline"]),
        user_notes=r["user_notes"] if "user_notes" in keys else None,
        user_rating=r["user_rating"] if "user_rating" in keys else None,
    )


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


def _tennis_session(conn: sqlite3.Connection, activity_id: str) -> TennisSession | None:
    """Return the tennis match/training attached to an activity, if any."""
    if not _table_exists(conn, "tennis_session"):
        return None
    row = conn.execute(
        "SELECT * FROM tennis_session WHERE activity_id=?", (activity_id,)
    ).fetchone()
    if row is None:
        return None

    player_rows = conn.execute(
        """SELECT p.contact_id, p.role, c.name, c.emoji
           FROM tennis_session_player p
           JOIN contacts c ON c.id = p.contact_id
           WHERE p.activity_id=?
           ORDER BY p.role, c.name""",
        (activity_id,),
    ).fetchall()

    return TennisSession(
        session_type=row["session_type"],
        format=row["format"],
        result=row["result"],
        score=row["score"],
        surface=row["surface"],
        focus=row["focus"],
        coaching_notes=row["coaching_notes"],
        players=[
            TennisPlayer(
                contact_id=p["contact_id"], name=p["name"],
                emoji=p["emoji"], role=p["role"],
            )
            for p in player_rows
        ],
    )


def _splits(conn: sqlite3.Connection, activity_id: str) -> list[SplitOut]:
    rows = conn.execute(
        """SELECT split_index, type, distance_m, time_s, avg_pace_s_per_km,
                  gap_s_per_km, avg_hr, avg_power_w, avg_cadence, elev_gain_m, avg_grade
           FROM activity_split WHERE activity_id=? ORDER BY split_index""",
        (activity_id,),
    ).fetchall()
    return [
        SplitOut(
            split_index=r["split_index"],
            type=r["type"],
            distance_m=r["distance_m"],
            time_s=r["time_s"],
            avg_pace_s_per_km=r["avg_pace_s_per_km"],
            gap_s_per_km=r["gap_s_per_km"],
            avg_hr=r["avg_hr"],
            avg_power_w=r["avg_power_w"],
            avg_cadence=r["avg_cadence"],
            elev_gain_m=r["elev_gain_m"],
            avg_grade=r["avg_grade"],
        )
        for r in rows
    ]


def _computed_metrics(conn: sqlite3.Connection, activity_id: str) -> ActivityComputedMetrics | None:
    row = conn.execute(
        """SELECT normalized_power_w, intensity_factor, variability_index,
                  efficiency_factor, decoupling_pct, relative_effort, hr_tss,
                  zones_json, garmin_aerobic_te, garmin_anaerobic_te, garmin_activity_load
           FROM activity_detail WHERE activity_id=?""",
        (activity_id,),
    ).fetchone()
    if not row:
        return None
    return ActivityComputedMetrics(
        normalized_power_w=row["normalized_power_w"],
        intensity_factor=row["intensity_factor"],
        variability_index=row["variability_index"],
        efficiency_factor=row["efficiency_factor"],
        decoupling_pct=row["decoupling_pct"],
        relative_effort=row["relative_effort"],
        hr_tss=row["hr_tss"],
        zones_json=row["zones_json"],
        garmin_aerobic_te=row["garmin_aerobic_te"],
        garmin_anaerobic_te=row["garmin_anaerobic_te"],
        garmin_activity_load=row["garmin_activity_load"],
    )


def _segment_efforts(conn: sqlite3.Connection, activity_id: str) -> list[SegmentEffortOut]:
    rows = conn.execute(
        """SELECT se.id, se.duration_seconds, se.avg_heart_rate, se.avg_power_watts,
                  se.is_personal_record, se.date,
                  s.name AS segment_name, s.distance_meters AS segment_distance,
                  s.activity_type AS segment_type
           FROM segment_efforts se
           JOIN segments s ON s.id = se.segment_id
           WHERE se.activity_id = ?
           ORDER BY s.name""",
        (activity_id,),
    ).fetchall()
    return [
        SegmentEffortOut(
            id=r["id"],
            segment_name=r["segment_name"],
            segment_distance_meters=r["segment_distance"],
            segment_type=r["segment_type"],
            duration_seconds=r["duration_seconds"],
            avg_heart_rate=r["avg_heart_rate"],
            avg_power_watts=r["avg_power_watts"],
            is_personal_record=bool(r["is_personal_record"]),
        )
        for r in rows
    ]


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("", response_model=ActivitySummary, status_code=201)
def create_activity(
    body: ActivityCreate,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    import uuid
    activity_id = f"manual_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """INSERT INTO activities
            (id, date, source, activity_type, name, start_time,
             duration_seconds, distance_meters, elevation_gain_meters,
             avg_heart_rate, calories, user_notes, user_rating,
             raw_payload)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            activity_id, body.date, "manual", body.activity_type,
            body.name or body.activity_type,
            body.start_time,
            body.duration_seconds, body.distance_meters,
            body.elevation_gain_meters, body.avg_heart_rate,
            body.calories, body.user_notes, body.user_rating,
            "{}",
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    return _row_to_summary(row)


@router.get("", response_model=list[ActivitySummary])
def get_activities(
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    source: str | None = Query(None, description="garmin | strava | manual"),
    activity_type: str | None = Query(None),
):
    try:
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=422, detail="start and end must be YYYY-MM-DD")

    filters = ["date BETWEEN ? AND ?"]
    params: list = [start, end]

    if source:
        filters.append("source = ?")
        params.append(source)
    if activity_type:
        filters.append("activity_type = ?")
        params.append(activity_type)

    where = " AND ".join(filters)
    rows = conn.execute(
        f"SELECT * FROM activities WHERE {where} ORDER BY start_time",
        params,
    ).fetchall()
    return [_row_to_summary(r) for r in rows]


@router.get("/streaks")
def get_streaks(
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    activity_type: Optional[str] = Query(None),
):
    """
    Compute activity streaks and frequency stats.
    Returns: current, longest, best_rest, by_type, weekly_avg, monthly_avg, heatmap_weeks.
    """
    today = date.today()

    # Fetch all distinct activity dates (optionally filtered by type)
    if activity_type:
        rows = conn.execute(
            "SELECT DISTINCT date FROM activities WHERE activity_type=? ORDER BY date",
            (activity_type,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT DISTINCT date FROM activities ORDER BY date"
        ).fetchall()

    all_dates = sorted({date.fromisoformat(r["date"]) for r in rows})

    if not all_dates:
        return {
            "current_streak": 0,
            "longest_streak": 0,
            "longest_streak_end": None,
            "current_rest": 0,
            "longest_rest": 0,
            "total_active_days": 0,
            "by_type": [],
            "weekly_avg": 0.0,
            "monthly_avg": 0.0,
            "heatmap_weeks": [],
        }

    # --- Streak computation ---
    def compute_streaks(dates: list[date]):
        if not dates:
            return 0, 0, None, 0, 0
        cur_streak = 1
        max_streak = 1
        max_end = dates[-1]
        cur_rest = 0
        max_rest = 0
        tmp_rest = 0

        for i in range(1, len(dates)):
            gap = (dates[i] - dates[i - 1]).days
            if gap == 1:
                cur_streak += 1
                if cur_streak > max_streak:
                    max_streak = cur_streak
                    max_end = dates[i]
                tmp_rest = 0
            else:
                cur_streak = 1
                rest = gap - 1
                tmp_rest = rest
                if rest > max_rest:
                    max_rest = rest

        # current streak: count back from today
        current = 1
        for i in range(len(all_dates) - 1, 0, -1):
            if (all_dates[i] - all_dates[i - 1]).days == 1:
                current += 1
            else:
                break
        # If last activity wasn't yesterday or today, streak is broken
        last = all_dates[-1]
        if (today - last).days > 1:
            current = 0

        # Current rest streak
        cur_rest = (today - last).days if (today - last).days > 0 else 0

        return current, max_streak, max_end, cur_rest, max_rest

    current_streak, longest_streak, longest_end, current_rest, longest_rest = compute_streaks(all_dates)

    # --- By type ---
    type_rows = conn.execute(
        "SELECT activity_type, COUNT(DISTINCT date) AS days, COUNT(*) AS sessions "
        "FROM activities WHERE activity_type IS NOT NULL GROUP BY activity_type ORDER BY days DESC"
    ).fetchall()

    by_type = []
    for r in type_rows:
        t_dates = sorted({
            date.fromisoformat(row["date"])
            for row in conn.execute(
                "SELECT DISTINCT date FROM activities WHERE activity_type=?",
                (r["activity_type"],),
            ).fetchall()
        })
        _, t_longest, t_end, _, _ = compute_streaks(t_dates)
        by_type.append({
            "type": r["activity_type"],
            "sessions": r["sessions"],
            "active_days": r["days"],
            "longest_streak": t_longest,
        })

    # --- Frequency ---
    if len(all_dates) >= 2:
        span_days = (all_dates[-1] - all_dates[0]).days + 1
        weeks = max(span_days / 7, 1)
        months = max(span_days / 30.44, 1)
        weekly_avg = round(len(all_dates) / weeks, 1)
        monthly_avg = round(len(all_dates) / months, 1)
    else:
        weekly_avg = float(len(all_dates))
        monthly_avg = float(len(all_dates))

    # --- Heatmap: last 52 weeks ---
    week_counts: dict[str, int] = defaultdict(int)
    cutoff = today - timedelta(weeks=52)
    for d in all_dates:
        if d >= cutoff:
            # ISO week key
            iso = d.isocalendar()
            key = f"{iso[0]}-W{iso[1]:02d}"
            week_counts[key] += 1

    # Build ordered list of weeks
    heatmap_weeks = []
    w = cutoff - timedelta(days=cutoff.weekday())  # align to Monday
    while w <= today:
        iso = w.isocalendar()
        key = f"{iso[0]}-W{iso[1]:02d}"
        heatmap_weeks.append({
            "week": key,
            "week_start": w.isoformat(),
            "count": week_counts.get(key, 0),
        })
        w += timedelta(weeks=1)

    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "longest_streak_end": longest_end.isoformat() if longest_end else None,
        "current_rest": current_rest,
        "longest_rest": longest_rest,
        "total_active_days": len(all_dates),
        "by_type": by_type,
        "weekly_avg": weekly_avg,
        "monthly_avg": monthly_avg,
        "heatmap_weeks": heatmap_weeks,
    }


@router.get("/sync-status", response_model=list[SyncStatusOut])
def get_sync_status(conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    rows = conn.execute("SELECT * FROM sync_status ORDER BY source").fetchall()
    return [
        SyncStatusOut(
            source=r["source"],
            last_attempt_at=r["last_attempt_at"],
            last_success_at=r["last_success_at"],
            last_error=r["last_error"],
            records_synced=r["records_synced"],
        )
        for r in rows
    ]


@router.get("/{activity_id}/streams")
def get_activity_streams(
    activity_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    max_hr: int = Query(195),
):
    """
    Decoded activity streams ready for charting.
    Returns empty arrays if no streams exist (never 404).
    Includes HR zone breakdown in seconds per zone.
    """
    stream_rows = conn.execute(
        "SELECT stream_type, data_json FROM activity_streams WHERE activity_id = ?",
        (activity_id,),
    ).fetchall()

    streams: dict[str, list] = {}
    for r in stream_rows:
        try:
            streams[r["stream_type"]] = json.loads(r["data_json"])
        except Exception:
            pass

    available = list(streams.keys())

    # HR zone breakdown — boundaries at 60/70/80/90% of max_hr
    hr_zones = None
    hr_data = streams.get("heartrate") or streams.get("heart_rate")
    if hr_data:
        z = [max_hr * p for p in (0.60, 0.70, 0.80, 0.90)]
        counts = {"z1": 0, "z2": 0, "z3": 0, "z4": 0, "z5": 0}
        for bpm in hr_data:
            if bpm is None:
                continue
            if bpm < z[0]:
                counts["z1"] += 1
            elif bpm < z[1]:
                counts["z2"] += 1
            elif bpm < z[2]:
                counts["z3"] += 1
            elif bpm < z[3]:
                counts["z4"] += 1
            else:
                counts["z5"] += 1
        hr_zones = counts

    return {
        "distance": streams.get("distance", []),
        "time": streams.get("time", []),
        "heartrate": hr_data,
        "altitude": streams.get("altitude"),
        "velocity": streams.get("velocity_smooth") or streams.get("velocity"),
        "cadence": streams.get("cadence"),
        "hr_zones": hr_zones,
        "available": available,
    }


@router.patch("/{activity_id}", response_model=ActivityDetail)
def patch_activity(
    activity_id: str,
    body: ActivityPatch,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    row = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id!r} not found")

    updates: dict = {}
    if body.user_notes is not None:
        updates["user_notes"] = body.user_notes
    if body.user_rating is not None:
        updates["user_rating"] = body.user_rating

    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates) + ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
        conn.execute(
            f"UPDATE activities SET {set_clause} WHERE id=?",
            [*updates.values(), activity_id],
        )
        conn.commit()
        row = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()

    stream_rows = conn.execute(
        "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?",
        (activity_id,),
    ).fetchall()
    streams = {r["stream_type"]: r["data_json"] for r in stream_rows}
    efforts = _segment_efforts(conn, activity_id)
    splits = _splits(conn, activity_id)
    computed = _computed_metrics(conn, activity_id)

    return ActivityDetail(
        **_row_to_summary(row).__dict__,
        polyline=row["polyline"],
        raw_payload=row["raw_payload"],
        streams=streams,
        segment_efforts=efforts,
        splits=splits,
        computed=computed,
        tennis=_tennis_session(conn, activity_id),
    )


@router.put("/{activity_id}/tennis", response_model=TennisSession)
def put_tennis_session(
    activity_id: str,
    body: TennisSessionWrite,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    """Create or replace the tennis match/training attached to an activity."""
    if conn.execute("SELECT 1 FROM activities WHERE id=?", (activity_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id!r} not found")

    conn.execute(
        """INSERT INTO tennis_session
               (activity_id, session_type, format, result, score, surface, focus, coaching_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(activity_id) DO UPDATE SET
               session_type=excluded.session_type,
               format=excluded.format,
               result=excluded.result,
               score=excluded.score,
               surface=excluded.surface,
               focus=excluded.focus,
               coaching_notes=excluded.coaching_notes,
               updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
        (
            activity_id, body.session_type, body.format, body.result,
            body.score, body.surface, body.focus, body.coaching_notes,
        ),
    )

    # Replace the player set for this activity
    conn.execute("DELETE FROM tennis_session_player WHERE activity_id=?", (activity_id,))
    seen: set[tuple[int, str]] = set()
    for role, ids in (
        ("partner", body.partner_ids),
        ("opponent", body.opponent_ids),
        ("coach", body.coach_ids),
    ):
        for cid in ids:
            key = (cid, role)
            if key in seen:
                continue
            seen.add(key)
            conn.execute(
                "INSERT OR IGNORE INTO tennis_session_player (activity_id, contact_id, role) VALUES (?,?,?)",
                (activity_id, cid, role),
            )

    conn.commit()
    return _tennis_session(conn, activity_id)


@router.delete("/{activity_id}/tennis", status_code=204)
def delete_tennis_session(
    activity_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    """Detach the tennis match/training from an activity."""
    conn.execute("DELETE FROM tennis_session_player WHERE activity_id=?", (activity_id,))
    conn.execute("DELETE FROM tennis_session WHERE activity_id=?", (activity_id,))
    conn.commit()


def _linked_plan_session(conn: sqlite3.Connection, activity_id: str):
    """Return (plan_session_with_structure_and_fueling, fueling_log) if this
    activity completed a scheduled session. Best-effort — returns (None, None)
    when the tables/link aren't present."""
    if not _table_exists(conn, "plan_sessions"):
        return None, None
    try:
        ps = conn.execute(
            """SELECT ps.*, rg.race_date, rg.race_type
               FROM plan_sessions ps JOIN race_goals rg ON rg.id = ps.goal_id
               WHERE ps.completed_activity_id=?""",
            (activity_id,),
        ).fetchone()
    except sqlite3.OperationalError:
        return None, None
    if not ps:
        return None, None

    from datetime import date as _date
    structure = None
    if "structure_json" in ps.keys() and ps["structure_json"]:
        try:
            structure = json.loads(ps["structure_json"])
        except Exception:
            structure = None

    weeks_to_race = None
    if ps["race_date"]:
        try:
            weeks_to_race = max(0, (_date.fromisoformat(ps["race_date"]) - _date.today()).days // 7)
        except Exception:
            weeks_to_race = None

    fueling = None
    try:
        from domains.training import fueling as _fuel
        fueling = _fuel.session_fuel_targets(
            ps["effective_duration_min"] or ps["duration_min"],
            ps["intensity_zone"], ps["discipline"], weeks_to_race,
        )
    except Exception:
        fueling = None

    out = {
        "id": ps["id"], "goal_id": ps["goal_id"], "session_type": ps["session_type"],
        "discipline": ps["discipline"], "intensity_zone": ps["intensity_zone"],
        "duration_min": ps["duration_min"], "effective_duration_min": ps["effective_duration_min"],
        "week_number": ps["week_number"], "structure": structure, "fueling": fueling,
    }

    flog = None
    if _table_exists(conn, "fueling_logs"):
        fl = conn.execute(
            "SELECT * FROM fueling_logs WHERE activity_id=? OR plan_session_id=? ORDER BY id DESC LIMIT 1",
            (activity_id, ps["id"]),
        ).fetchone()
        if fl:
            flog = {
                "carbs_g": fl["carbs_g"], "fluids_ml": fl["fluids_ml"],
                "sodium_mg": fl["sodium_mg"], "gi_severity": fl["gi_severity"],
                "gi_notes": fl["gi_notes"],
            }
    return out, flog


@router.get("/{activity_id}", response_model=ActivityDetail)
def get_activity(
    activity_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    row = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id!r} not found")

    # Auto-link this day's pending plan session(s) to their real activity so the
    # Planned-vs-Actual panel appears even if no training view was opened first.
    try:
        from infrastructure.api.routers.race_plans import autolink_sessions
        autolink_sessions(conn, on_date=row["date"])
    except Exception:
        pass

    stream_rows = conn.execute(
        "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?",
        (activity_id,),
    ).fetchall()
    streams = {r["stream_type"]: r["data_json"] for r in stream_rows}

    efforts = _segment_efforts(conn, activity_id)
    splits = _splits(conn, activity_id)
    computed = _computed_metrics(conn, activity_id)
    plan_session, fueling_log = _linked_plan_session(conn, activity_id)

    return ActivityDetail(
        **_row_to_summary(row).__dict__,
        polyline=row["polyline"],
        raw_payload=row["raw_payload"],
        streams=streams,
        segment_efforts=efforts,
        splits=splits,
        computed=computed,
        tennis=_tennis_session(conn, activity_id),
        plan_session=plan_session,
        fueling_log=fueling_log,
    )
