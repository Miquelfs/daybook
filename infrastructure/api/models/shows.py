from typing import Optional
from pydantic import BaseModel, Field


class ShowIn(BaseModel):
    title: str
    date_watched: Optional[str] = Field(default=None, description="YYYY-MM-DD")
    type: Optional[str] = None          # "movie" | "show" | "documentary"
    genre: Optional[str] = None
    platform: Optional[str] = None      # Netflix, Cinema, HBO, etc.
    companions: Optional[str] = None
    rating_mf: Optional[int] = Field(default=None, ge=1, le=10)
    rating_ad: Optional[int] = Field(default=None, ge=1, le=10)
    notes: Optional[str] = None


class ShowPatch(BaseModel):
    title: Optional[str] = None
    date_watched: Optional[str] = None
    type: Optional[str] = None
    genre: Optional[str] = None
    platform: Optional[str] = None
    companions: Optional[str] = None
    rating_mf: Optional[int] = Field(default=None, ge=1, le=10)
    rating_ad: Optional[int] = Field(default=None, ge=1, le=10)
    notes: Optional[str] = None


class ShowOut(BaseModel):
    id: int
    title: str
    date_watched: Optional[str]
    type: Optional[str]
    genre: Optional[str]
    platform: Optional[str]
    companions: Optional[str]
    rating_mf: Optional[int]
    rating_ad: Optional[int]
    notes: Optional[str]
    created_at: str
    updated_at: str


class ShowStats(BaseModel):
    total: int
    by_year: dict
    by_type: dict
    by_genre: dict
    by_platform: dict
    avg_rating_mf: float | None
    top_rated: list
