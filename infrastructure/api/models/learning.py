from __future__ import annotations

from pydantic import BaseModel, Field


class LearningPlanPatch(BaseModel):
    title: str | None = None
    emoji: str | None = None
    goal: str | None = None
    start_date: str | None = None          # moved to that week's Monday
    weekly_hours: float | None = Field(None, ge=0, le=80)
    status: str | None = None              # active | paused | done


class LearningPhasePatch(BaseModel):
    gate_passed_at: str | None = None      # YYYY-MM-DD; null re-opens the gate


class LearningItemIn(BaseModel):
    plan_id: int
    phase_id: int | None = None
    title: str
    notes: str | None = None
    kind: str = "learn"
    tier: str = "core"
    resource: str | None = None
    url: str | None = None
    week: int | None = Field(None, ge=1, le=260)
    weeks: int = Field(1, ge=1, le=52)
    est_hours: float | None = Field(None, ge=0)


class LearningItemPatch(BaseModel):
    phase_id: int | None = None
    title: str | None = None
    notes: str | None = None
    kind: str | None = None
    tier: str | None = None
    resource: str | None = None
    url: str | None = None
    week: int | None = Field(None, ge=1, le=260)
    weeks: int | None = Field(None, ge=1, le=52)
    est_hours: float | None = Field(None, ge=0)
    status: str | None = None              # todo | done | skipped
    done_at: str | None = None             # with status=done: the day it was done (default today)


class LearningLogIn(BaseModel):
    plan_id: int
    item_id: int | None = None
    date: str
    minutes: int = Field(..., ge=1, le=24 * 60)
    note: str | None = None
