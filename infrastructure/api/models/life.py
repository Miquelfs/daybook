from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field

# Categories are now free-form strings — the list below is the suggested set
# but the API accepts any non-empty string.
EVENT_TYPES = Literal["career", "relationship", "travel", "loss", "achievement", "other"]

# ─── user_profile ─────────────────────────────────────────────────────────────

class ProfileIn(BaseModel):
    birthdate: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    display_name: str | None = None


class ProfileOut(BaseModel):
    birthdate: str
    display_name: str | None = None
    created_at: str
    updated_at: str


# ─── life_periods ─────────────────────────────────────────────────────────────

class PeriodIn(BaseModel):
    label: str
    category: str                        # free-form, e.g. "education", "tennis", "van"
    layer: str = "main"                  # kept for DB compat; ignored by new renderer
    color: str                           # Tailwind ramp "blue-400" OR hex "#60a5fa"
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str | None = None
    sort_order: int = 0


class PeriodPatch(BaseModel):
    label: str | None = None
    category: str | None = None
    layer: str | None = None
    color: str | None = None
    start_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str | None = None
    sort_order: int | None = None


class PeriodOut(BaseModel):
    id: int
    label: str
    category: str
    layer: str
    color: str
    start_date: str
    end_date: str | None
    notes: str | None
    sort_order: int
    created_at: str
    updated_at: str


class AutoCappedPeriod(BaseModel):
    id: int
    label: str
    old_end_date: str | None
    new_end_date: str


class PeriodCreateResponse(BaseModel):
    period: PeriodOut
    auto_capped: list[AutoCappedPeriod] = []


# ─── life_events ──────────────────────────────────────────────────────────────

class EventIn(BaseModel):
    event_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    label: str
    type: EVENT_TYPES
    notes: str | None = None


class EventPatch(BaseModel):
    event_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    label: str | None = None
    type: EVENT_TYPES | None = None
    notes: str | None = None


class EventOut(BaseModel):
    id: int
    event_date: str
    label: str
    type: str
    notes: str | None
    photo_url: str | None
    created_at: str
    updated_at: str


# ─── Grid response ────────────────────────────────────────────────────────────

class WeekCell(BaseModel):
    """One cell in the 90×52 grid."""
    row: int           # age year 0–89
    col: int           # week-of-year 1–52
    week_start: str    # ISO date of the birthday-anchored week start
    week_end: str      # week_start + 6 days
    is_past: bool
    is_current: bool
    # All active periods for this cell (any category, sorted by sort_order then start_date).
    # The renderer decides how to slice the cell visually.
    periods: list[PeriodOut] = []
    events: list[EventOut] = []


class GridResponse(BaseModel):
    birthdate: str
    today: str
    cells: list[WeekCell]
