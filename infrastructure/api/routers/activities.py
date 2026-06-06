"""
Activities router — /activities endpoints.
Activities are sourced primarily from Garmin; Strava enriches them with
strava_id and segment efforts.
"""

import json
import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.activity import (
    ActivityDetail,
    ActivitySummary,
    SegmentEffortOut,
    SyncStatusOut,
)

router = APIRouter(prefix="/activities", tags=["activities"])


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_summary(r: sqlite3.Row) -> ActivitySummary:
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


@router.get("/{activity_id}", response_model=ActivityDetail)
def get_activity(
    activity_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
):
    row = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Activity {activity_id!r} not found")

    # Load streams
    stream_rows = conn.execute(
        "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?",
        (activity_id,),
    ).fetchall()
    streams = {r["stream_type"]: r["data_json"] for r in stream_rows}

    efforts = _segment_efforts(conn, activity_id)

    return ActivityDetail(
        **_row_to_summary(row).__dict__,
        polyline=row["polyline"],
        raw_payload=row["raw_payload"],
        streams=streams,
        segment_efforts=efforts,
    )
