from __future__ import annotations
from pydantic import BaseModel


class ActivitySummary(BaseModel):
    id: str
    date: str
    source: str
    strava_id: str | None = None
    activity_type: str | None = None
    name: str | None = None
    start_time: str | None = None
    duration_seconds: float | None = None
    moving_time_seconds: float | None = None
    distance_meters: float | None = None
    elevation_gain_meters: float | None = None
    avg_heart_rate: float | None = None
    max_heart_rate: float | None = None
    avg_speed_mps: float | None = None
    avg_power_watts: float | None = None
    calories: float | None = None
    training_stress_score: float | None = None
    start_lat: float | None = None
    start_lng: float | None = None
    has_polyline: bool = False


class SegmentEffortOut(BaseModel):
    id: int
    segment_name: str
    segment_distance_meters: float | None = None
    segment_type: str | None = None
    duration_seconds: float
    avg_heart_rate: float | None = None
    avg_power_watts: float | None = None
    is_personal_record: bool = False


class ActivityDetail(ActivitySummary):
    polyline: str | None = None
    raw_payload: str | None = None
    streams: dict[str, str] = {}         # stream_type → JSON array string
    segment_efforts: list[SegmentEffortOut] = []


class SyncStatusOut(BaseModel):
    source: str
    last_attempt_at: str
    last_success_at: str | None = None
    last_error: str | None = None
    records_synced: int = 0
