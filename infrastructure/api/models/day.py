from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field


class SleepData(BaseModel):
    duration_seconds: int | None = None
    deep_seconds: int | None = None
    light_seconds: int | None = None
    rem_seconds: int | None = None
    awake_seconds: int | None = None
    avg_hrv: float | None = None
    avg_spo2: float | None = None
    score: int | None = None


class DailyStatsData(BaseModel):
    steps: int | None = None
    active_calories: int | None = None
    total_calories: int | None = None
    resting_hr: int | None = None
    stress_avg: int | None = None
    body_battery_low: int | None = None
    body_battery_high: int | None = None


class HRVData(BaseModel):
    last_night_avg: float | None = None
    weekly_avg: float | None = None
    status: str | None = None


class ActivityData(BaseModel):
    id: str
    source: str = "garmin"
    strava_id: str | None = None
    activity_type: str | None = None
    name: str | None = None
    start_time: str | None = None
    duration_seconds: int | None = None
    distance_meters: float | None = None
    elevation_gain_meters: float | None = None
    avg_heart_rate: float | None = None
    max_heart_rate: float | None = None
    calories: float | None = None
    has_polyline: bool = False


class LocationVisit(BaseModel):
    start_time: str
    end_time: str
    semantic_type: str | None = None
    place_name: str | None = None
    city: str | None = None
    country: str | None = None
    lat: float | None = None
    lng: float | None = None


class LocationSummary(BaseModel):
    cities: list[str] = []
    total_distance_meters: float = 0.0


class DayTagSummary(BaseModel):
    tag_id: int
    slug: str
    name: str
    icon: str | None = None
    category: str
    color: str | None = None
    note: str | None = None


class DaySubjective(BaseModel):
    energy: int | None = Field(None, ge=1, le=10)
    mood: int | None = Field(None, ge=1, le=10)
    stress: int | None = Field(None, ge=1, le=10)
    sleep_quality: int | None = Field(None, ge=1, le=10)
    notes: str | None = None
    daily_question: str | None = None
    daily_answer: str | None = None
    tags: str | None = None
    mood_note: str | None = None
    duty_day: bool = False
    away_from_base: bool = False
    timezone_offset: int | None = None
    gratitude: str | None = None
    intention: str | None = None
    learning: str | None = None
    focus_score: int | None = Field(None, ge=1, le=10)
    error_log: str | None = None
    photo_caption: str | None = None


class DaySummary(BaseModel):
    """Lightweight — used in timeline/range queries."""
    date: str
    energy: int | None = None
    mood: int | None = None
    stress: int | None = None
    sleep_duration_seconds: int | None = None
    steps: int | None = None
    resting_hr: int | None = None
    hrv_last_night: float | None = None
    activity_count: int = 0
    flight_count: int = 0
    cities: list[str] = []
    duty_day: bool = False
    away_from_base: bool = False
    daily_question: str | None = None
    daily_answer: str | None = None
    photo_path: str | None = None
    photo_caption: str | None = None
    tags: str | None = None
    tags_list: list[str] = []


class ContactOut(BaseModel):
    id: int
    name: str
    emoji: str | None = None
    group_: str | None = None


class WeatherData(BaseModel):
    condition: str | None = None
    temp_min: float | None = None
    temp_max: float | None = None
    temp_mean: float | None = None
    precipitation: float | None = None
    weather_code: int | None = None
    wind_speed_max: float | None = None


class LoadIndexData(BaseModel):
    fatigue_score: float | None = None
    hrv_load: float | None = None
    sleep_debt: float | None = None
    tss_load: float | None = None
    timezone_penalty: float | None = None
    recovery_status: str | None = None


class DayDetail(BaseModel):
    """Full envelope — used for single-day view."""
    date: str
    subjective: DaySubjective
    sleep: SleepData | None = None
    daily_stats: DailyStatsData | None = None
    hrv: HRVData | None = None
    activities: list[ActivityData] = []
    location: LocationSummary | None = None
    visits: list[LocationVisit] = []
    companions: list[str] = []
    photo_url: str | None = None
    tags: list[DayTagSummary] = []
    weather: WeatherData | None = None
    load_index: LoadIndexData | None = None


class DayPatch(BaseModel):
    """Fields accepted by PATCH /days/{date}."""
    energy: int | None = Field(None, ge=1, le=10)
    mood: int | None = Field(None, ge=1, le=10)
    stress: int | None = Field(None, ge=1, le=10)
    sleep_quality: int | None = Field(None, ge=1, le=10)
    notes: str | None = None
    daily_question: str | None = None
    daily_answer: str | None = None
    tags: str | None = None
    mood_note: str | None = None
    duty_day: bool | None = None
    away_from_base: bool | None = None
    timezone_offset: int | None = None
    gratitude: str | None = None
    intention: str | None = None
    learning: str | None = None
    focus_score: int | None = Field(None, ge=1, le=10)
    error_log: str | None = None
    photo_caption: str | None = None
