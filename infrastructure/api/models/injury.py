from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class InjuryCreate(BaseModel):
    zone: str
    side: Optional[str] = Field(None, pattern=r"^(left|right)$")
    pain_scale: int = Field(..., ge=1, le=10)
    status: str = Field("active", pattern=r"^(active|recovering|resolved)$")
    onset_date: str
    resolved_date: Optional[str] = None
    notes: Optional[str] = None
    mechanism: Optional[str] = Field(None, pattern=r"^(overuse|acute|unknown)$")
    activity_type: Optional[str] = None
    activity_id: Optional[str] = None


class InjuryPatch(BaseModel):
    pain_scale: Optional[int] = Field(None, ge=1, le=10)
    status: Optional[str] = Field(None, pattern=r"^(active|recovering|resolved)$")
    resolved_date: Optional[str] = None
    notes: Optional[str] = None
    mechanism: Optional[str] = Field(None, pattern=r"^(overuse|acute|unknown)$")
    activity_type: Optional[str] = None
    activity_id: Optional[str] = None


class InjuryOut(BaseModel):
    id: int
    zone: str
    side: Optional[str]
    pain_scale: int
    status: str
    onset_date: str
    resolved_date: Optional[str]
    notes: Optional[str]
    mechanism: Optional[str]
    activity_type: Optional[str]
    activity_id: Optional[str]
    created_at: str
    updated_at: str
