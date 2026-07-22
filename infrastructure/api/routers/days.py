import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from infrastructure.api.db import get_db
from infrastructure.api.models.day import (
    ActivityData, DayDetail, DayPatch, DaySummary,
    DailyStatsData, DaySubjective, DayTagSummary, HRVData, LoadIndexData, LocationSummary,
    LocationVisit, SleepData, WeatherData,
)
from pydantic import BaseModel


class CompanionsBody(BaseModel):
    contact_ids: list[int]
from domains.locations.locations_query import (
    location_data_for_date, _location_summary_with_conn, _conn as _loc_conn,
)

router = APIRouter(prefix="/days", tags=["days"])

TIMEZONE = "Europe/Madrid"   # TODO: move to .env / config
PHOTOS_DIR = Path(__file__).parents[3] / "data" / "photos"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


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
        mood_note=row["mood_note"] if "mood_note" in row.keys() else None,
        gratitude=row["gratitude"] if "gratitude" in row.keys() else None,
        intention=row["intention"] if "intention" in row.keys() else None,
        learning=row["learning"] if "learning" in row.keys() else None,
        focus_score=row["focus_score"] if "focus_score" in row.keys() else None,
        error_log=row["error_log"] if "error_log" in row.keys() else None,
        photo_caption=row["photo_caption"] if "photo_caption" in row.keys() else None,
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


def _companions(conn: sqlite3.Connection, date_str: str) -> list[str]:
    rows = conn.execute(
        """SELECT c.name FROM day_companions dc
           JOIN contacts c ON c.id = dc.contact_id
           WHERE dc.date = ? ORDER BY c.name""",
        (date_str,),
    ).fetchall()
    return [r[0] for r in rows]


def _day_tags(conn: sqlite3.Connection, date_str: str) -> list[DayTagSummary]:
    rows = conn.execute(
        """
        SELECT dt.tag_id, t.slug, t.name, t.icon, t.category, t.color, dt.note
        FROM day_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.date = ?
        ORDER BY t.category, t.name
        """,
        (date_str,),
    ).fetchall()
    return [
        DayTagSummary(
            tag_id=r["tag_id"], slug=r["slug"], name=r["name"],
            icon=r["icon"], category=r["category"], color=r["color"], note=r["note"],
        )
        for r in rows
    ]


def _load_index(conn: sqlite3.Connection, date_str: str) -> LoadIndexData | None:
    row = conn.execute("SELECT * FROM load_index WHERE date=?", (date_str,)).fetchone()
    if row is None:
        return None
    return LoadIndexData(
        fatigue_score=row["fatigue_score"],
        hrv_load=row["hrv_load"],
        sleep_debt=row["sleep_debt"],
        tss_load=row["tss_load"],
        timezone_penalty=row["timezone_penalty"],
        recovery_status=row["recovery_status"],
    )


def _activities(conn: sqlite3.Connection, date_str: str) -> list[ActivityData]:
    # Exclude strava-only rows that have a garmin counterpart on the same date/time.
    # Garmin rows with strava_id set already carry Strava enrichment (polyline, segments).
    rows = conn.execute(
        """SELECT * FROM activities
           WHERE date=?
             AND NOT (source='strava' AND EXISTS (
               SELECT 1 FROM activities g
               WHERE g.date = activities.date
                 AND g.source = 'garmin'
                 AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
             ))
           ORDER BY start_time""",
        (date_str,)
    ).fetchall()
    return [
        ActivityData(
            id=r["id"],
            source=r["source"],
            strava_id=r["strava_id"],
            activity_type=r["activity_type"],
            name=r["name"],
            start_time=r["start_time"],
            duration_seconds=r["duration_seconds"],
            distance_meters=r["distance_meters"],
            elevation_gain_meters=r["elevation_gain_meters"],
            avg_heart_rate=r["avg_heart_rate"],
            max_heart_rate=r["max_heart_rate"],
            calories=r["calories"],
            has_polyline=bool(r["polyline"]),
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

    loc_summary, loc_visits = location_data_for_date(date_str)

    photo_path = row["photo_path"] if "photo_path" in row.keys() else None
    photo_url = f"/photos/{photo_path}" if photo_path else None

    weather_row = conn.execute(
        "SELECT condition, temp_min, temp_max, temp_mean, precipitation, weather_code, wind_speed_max FROM weather WHERE date = ?",
        (date_str,)
    ).fetchone()
    weather = WeatherData(**dict(weather_row)) if weather_row else None

    return DayDetail(
        date=date_str,
        subjective=_subjective(row),
        sleep=_sleep(conn, date_str),
        daily_stats=_daily_stats(conn, date_str),
        hrv=_hrv(conn, date_str),
        activities=_activities(conn, date_str),
        location=LocationSummary(**loc_summary),
        visits=[LocationVisit(**v) for v in loc_visits],
        companions=_companions(conn, date_str),
        photo_url=photo_url,
        tags=_day_tags(conn, date_str),
        weather=weather,
        load_index=_load_index(conn, date_str),
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

    loc_conn = _loc_conn()
    results = []
    for row in days_rows:
        d = row["date"]
        sleep_row = conn.execute("SELECT duration_seconds FROM sleep WHERE date=?", (d,)).fetchone()
        stats_row = conn.execute("SELECT steps, resting_hr FROM daily_stats WHERE date=?", (d,)).fetchone()
        hrv_row = conn.execute("SELECT last_night_avg FROM hrv WHERE date=?", (d,)).fetchone()
        act_count = conn.execute(
            """SELECT COUNT(*) FROM activities
               WHERE date=?
                 AND NOT (source='strava' AND EXISTS (
                   SELECT 1 FROM activities g
                   WHERE g.date = activities.date
                     AND g.source = 'garmin'
                     AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
                 ))""",
            (d,)
        ).fetchone()[0]
        loc = _location_summary_with_conn(loc_conn, d)
        flight_count = conn.execute(
            "SELECT COUNT(*) FROM flights WHERE date=?", (d,)
        ).fetchone()[0]

        tag_slugs = [
            r[0] for r in conn.execute(
                "SELECT t.slug FROM day_tags dt JOIN tags t ON t.id=dt.tag_id WHERE dt.date=? ORDER BY t.category, t.name",
                (d,),
            ).fetchall()
        ]
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
            flight_count=flight_count,
            cities=loc["cities"],
            duty_day=bool(row["duty_day"]),
            away_from_base=bool(row["away_from_base"]),
            daily_question=row["daily_question"],
            daily_answer=row["daily_answer"],
            photo_path=row["photo_path"] if "photo_path" in row.keys() else None,
            photo_caption=row["photo_caption"] if "photo_caption" in row.keys() else None,
            tags=row["tags"] if "tags" in row.keys() else None,
            tags_list=tag_slugs,
        ))

    loc_conn.close()
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

    # Exclude None (means "not provided") but keep empty strings and False/0
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


@router.post("/{date_str}/photo")
def upload_photo(
    date_str: str,
    file: UploadFile,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    import io
    import pillow_heif
    import PIL.Image as Image
    from PIL import ImageOps

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    pillow_heif.register_heif_opener()

    try:
        img = Image.open(io.BytesIO(content))
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        jpeg_bytes = buf.getvalue()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image conversion failed: {e}")

    filename = f"{date_str}.jpg"
    dest = PHOTOS_DIR / filename
    dest.write_bytes(jpeg_bytes)

    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))
    conn.execute("UPDATE days SET photo_path = ? WHERE date = ?", (filename, date_str))
    conn.commit()

    return JSONResponse({"photo_url": f"/photos/{filename}"})


@router.delete("/{date_str}/photo", status_code=204)
def delete_photo(
    date_str: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    row = conn.execute("SELECT photo_path FROM days WHERE date=?", (date_str,)).fetchone()
    if row is None or not row["photo_path"]:
        raise HTTPException(status_code=404, detail="No photo for this day")

    photo_path = PHOTOS_DIR / row["photo_path"]
    photo_path.unlink(missing_ok=True)

    conn.execute("UPDATE days SET photo_path = NULL WHERE date = ?", (date_str,))
    conn.commit()


@router.post("/{date_str}/companions", response_model=list[str])
def set_companions(
    date_str: str,
    body: CompanionsBody,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))
    conn.execute("DELETE FROM day_companions WHERE date = ?", (date_str,))
    for cid in body.contact_ids:
        conn.execute(
            "INSERT OR IGNORE INTO day_companions (date, contact_id) VALUES (?,?)",
            (date_str, cid),
        )
    conn.commit()
    return _companions(conn, date_str)
