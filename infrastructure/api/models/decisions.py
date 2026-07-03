from __future__ import annotations
from pydantic import BaseModel, Field


class DecisionOut(BaseModel):
    id: str
    date: str
    description: str
    expected_outcome: str | None = None
    confidence: int | None = Field(None, ge=1, le=10)
    horizon_date: str | None = None
    actual_outcome: str | None = None
    outcome_score: int | None = Field(None, ge=1, le=10)
    created_at: str
    resolved_at: str | None = None

    @property
    def is_resolved(self) -> bool:
        return self.actual_outcome is not None


class DecisionCreate(BaseModel):
    date: str
    description: str
    expected_outcome: str | None = None
    confidence: int | None = Field(None, ge=1, le=10)
    horizon_date: str | None = None


class DecisionResolve(BaseModel):
    actual_outcome: str
    outcome_score: int | None = Field(None, ge=1, le=10)
