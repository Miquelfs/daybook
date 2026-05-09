import sqlite3
from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.day import (
    ActivityData, DayDetail, DayPatch, DaySummary,
    DailyStatsData, DaySubjective, HRVData, LocationSummary,
    LocationVisit, SleepData,
)
from domains.locations.locations_query import (
    location_summary_for_date, visits_for_date,
)

router = APIRouter(prefix="/days", tags=["days"])

TIMEZONE = "Europe/Madrid"   # TODO: move to .env / config


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _today() -> str:
    return datetime.now(ZoneInfo(TIMEZONE)).date().isoformat()


def _require_day(conn: sqlite3.Connection, date_str: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM days WHERE date=?", (date_str,)).fetchone()
    if row is None:
        # Auto-create a spine row for any valid date rather than 404ing.
        # This handles days that postdate the last backfill run.
        conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))
        conn.commit()
        row = conn.execute("SELECT * FROM days WHERE date=?", (date_str,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No data for date {date_str}")
    return row


def _subjective(row: sqlite3.Row) -> DaySubjective:
    return DaySubjective(
        energy=row["energy"],
        mood=row["mood"],
        stress=row["stress"],
        sleep_quality=row["sleep_quality"],
        notes=row["notes"],
        daily_question=row["daily_question"],
        daily_answer=row["daily_answer"],
        tags=row["tags"],
        duty_day=bool(row["duty_day"]),
        away_from_base=bool(row["away_from_base"]),
        timezone_offset=row["timezone_offset"],
    )


def _sleep(conn: sqlite3.Connection, date_str: str) -> SleepData | None:
    row = conn.execute("SELECT * FROM sleep WHERE date=?", (date_str,)).fetchone()
    if row is None:
        return None
    return SleepData(
        duration_seconds=row["duration_seconds"],
        deep_seconds=row["deep_seconds"],
        light_seconds=row["light_seconds"],
        rem_seconds=row["rem_seconds"],
        awake_seconds=row["awake_seconds"],
        avg_hrv=row["avg_hrv"],
        avg_spo2=row["avg_spo2"],
        score=row["score"],
    )


def _daily_stats(conn: sqlite3.Connection, date_str: str) -> DailyStatsData | None:
    row = conn.execute("SELECT * FROM daily_stats WHERE date=?", (date_str,)).fetchone()
    if row is None:
        return None
    return DailyStatsData(
        steps=row["steps"],
        active_calories=row["active_calories"],
        total_calories=row["total_calories"],
        resting_hr=row["resting_hr"],
        stress_avg=row["stress_avg"],
        body_battery_low=row["body_battery_low"],
        body_battery_high=row["body_battery_high"],
    )


def _hrv(conn: sqlite3.Connection, date_str: str) -> HRVData | None:
    row = conn.execute("SELECT * FROM hrv WHERE date=?", (date_str,)).fetchone()
    if row is None:
        return None
    return HRVData(
        last_night_avg=row["last_night_avg"],
        weekly_avg=row["weekly_avg"],
        status=row["status"],
    )


def _activities(conn: sqlite3.Connection, date_str: str) -> list[ActivityData]:
    rows = conn.execute("SELECT * FROM activities WHERE date=?", (date_str,)).fetchall()
    return [
        ActivityData(
            activity_id=r["activity_id"],
            type=r["type"],
            name=r["name"],
            start_time=r["start_time"],
            duration_seconds=r["duration_seconds"],
            distance_meters=r["distance_meters"],
            avg_hr=r["avg_hr"],
            max_hr=r["max_hr"],
            calories=r["calories"],
            elevation_gain=r["elevation_gain"],
        )
        for r in rows
    ]


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/today", response_model=DayDetail)
def get_today(conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    return get_day(_today(), conn)


@router.get("/{date_str}", response_model=DayDetail)
def get_day(date_str: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    # Validate format
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    row = _require_day(conn, date_str)

    loc_summary = location_summary_for_date(date_str)
    loc_visits = visits_for_date(date_str)

    return DayDetail(
        date=date_str,
        subjective=_subjective(row),
        sleep=_sleep(conn, date_str),
        daily_stats=_daily_stats(conn, date_str),
        hrv=_hrv(conn, date_str),
        activities=_activities(conn, date_str),
        location=LocationSummary(**loc_summary),
        visits=[LocationVisit(**v) for v in loc_visits],
    )


@router.get("", response_model=list[DaySummary])
def get_range(
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
):
    try:
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=422, detail="start and end must be YYYY-MM-DD")

    days_rows = conn.execute(
        "SELECT * FROM days WHERE date BETWEEN ? AND ? ORDER BY date",
        (start, end),
    ).fetchall()

    results = []
    for row in days_rows:
        d = row["date"]
        sleep_row = conn.execute("SELECT duration_seconds FROM sleep WHERE date=?", (d,)).fetchone()
        stats_row = conn.execute("SELECT steps, resting_hr FROM daily_stats WHERE date=?", (d,)).fetchone()
        hrv_row = conn.execute("SELECT last_night_avg FROM hrv WHERE date=?", (d,)).fetchone()
        act_count = conn.execute("SELECT COUNT(*) FROM activities WHERE date=?", (d,)).fetchone()[0]
        loc = location_summary_for_date(d)

        results.append(DaySummary(
            date=d,
            energy=row["energy"],
            mood=row["mood"],
            stress=row["stress"],
            sleep_duration_seconds=sleep_row["duration_seconds"] if sleep_row else None,
            steps=stats_row["steps"] if stats_row else None,
            resting_hr=stats_row["resting_hr"] if stats_row else None,
            hrv_last_night=hrv_row["last_night_avg"] if hrv_row else None,
            activity_count=act_count,
            cities=loc["cities"],
            duty_day=bool(row["duty_day"]),
            away_from_base=bool(row["away_from_base"]),
        ))

    return results


@router.patch("/{date_str}", response_model=DayDetail)
def patch_day(
    date_str: str,
    patch: DayPatch,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    # Upsert the days row (backfill may not have run for future dates)
    conn.execute(
        "INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,)
    )

    updates = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not updates:
        return get_day(date_str, conn)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    set_clause += ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
    conn.execute(
        f"UPDATE days SET {set_clause} WHERE date = ?",
        (*updates.values(), date_str),
    )
    conn.commit()

    return get_day(date_str, conn)
