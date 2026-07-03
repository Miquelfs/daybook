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
    user_notes: str | None = None
    user_rating: int | None = None


class SegmentEffortOut(BaseModel):
    id: int
    segment_name: str
    segment_distance_meters: float | None = None
    segment_type: str | None = None
    duration_seconds: float
    avg_heart_rate: float | None = None
    avg_power_watts: float | None = None
    is_personal_record: bool = False


class ActivityPatch(BaseModel):
    user_notes: str | None = None
    user_rating: int | None = None


class ActivityCreate(BaseModel):
    date: str                           # YYYY-MM-DD
    activity_type: str
    name: str | None = None
    start_time: str | None = None       # ISO 8601 optional
    duration_seconds: float | None = None
    distance_meters: float | None = None
    elevation_gain_meters: float | None = None
    avg_heart_rate: float | None = None
    calories: float | None = None
    user_notes: str | None = None
    user_rating: int | None = None


class SplitOut(BaseModel):
    split_index: int
    type: str | None = None
    distance_m: float | None = None
    time_s: float | None = None
    avg_pace_s_per_km: float | None = None
    gap_s_per_km: float | None = None
    avg_hr: float | None = None
    avg_power_w: float | None = None
    avg_cadence: float | None = None
    elev_gain_m: float | None = None
    avg_grade: float | None = None


class ActivityComputedMetrics(BaseModel):
    normalized_power_w: float | None = None
    intensity_factor: float | None = None
    variability_index: float | None = None
    efficiency_factor: float | None = None
    decoupling_pct: float | None = None
    relative_effort: float | None = None
    hr_tss: float | None = None
    zones_json: str | None = None
    garmin_aerobic_te: float | None = None
    garmin_anaerobic_te: float | None = None
    garmin_activity_load: float | None = None


class ActivityDetail(ActivitySummary):
    polyline: str | None = None
    raw_payload: str | None = None
    streams: dict[str, str] = {}         # stream_type → JSON array string
    segment_efforts: list[SegmentEffortOut] = []
    splits: list[SplitOut] = []
    computed: ActivityComputedMetrics | None = None


class SyncStatusOut(BaseModel):
    source: str
    last_attempt_at: str
    last_success_at: str | None = None
    last_error: str | None = None
    records_synced: int = 0
