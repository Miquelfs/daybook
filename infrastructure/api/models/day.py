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
    activity_id: str
    type: str | None = None
    name: str | None = None
    start_time: str | None = None
    duration_seconds: int | None = None
    distance_meters: float | None = None
    avg_hr: int | None = None
    max_hr: int | None = None
    calories: int | None = None
    elevation_gain: float | None = None


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


class DaySubjective(BaseModel):
    energy: int | None = Field(None, ge=1, le=10)
    mood: int | None = Field(None, ge=1, le=10)
    stress: int | None = Field(None, ge=1, le=10)
    sleep_quality: int | None = Field(None, ge=1, le=10)
    notes: str | None = None
    daily_question: str | None = None
    daily_answer: str | None = None
    tags: str | None = None
    duty_day: bool = False
    away_from_base: bool = False
    timezone_offset: int | None = None


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
    cities: list[str] = []
    duty_day: bool = False
    away_from_base: bool = False


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
    duty_day: bool | None = None
    away_from_base: bool | None = None
    timezone_offset: int | None = None
