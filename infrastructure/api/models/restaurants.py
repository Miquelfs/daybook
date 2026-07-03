from typing import Optional
from pydantic import BaseModel, Field


class RestaurantIn(BaseModel):
    name: str
    date_visited: Optional[str] = Field(default=None, description="YYYY-MM-DD")
    city: Optional[str] = None
    country: Optional[str] = None
    cuisine: Optional[str] = None
    rating_mf: Optional[int] = Field(default=None, ge=1, le=10)
    rating_ad: Optional[int] = Field(default=None, ge=1, le=10)
    companions: Optional[str] = None
    google_maps_url: Optional[str] = None
    notes: Optional[str] = None
    trip_context: Optional[str] = None
    source: Optional[str] = None


class RestaurantPatch(BaseModel):
    name: Optional[str] = None
    date_visited: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    cuisine: Optional[str] = None
    rating_mf: Optional[int] = Field(default=None, ge=1, le=10)
    rating_ad: Optional[int] = Field(default=None, ge=1, le=10)
    companions: Optional[str] = None
    google_maps_url: Optional[str] = None
    notes: Optional[str] = None
    trip_context: Optional[str] = None


class RestaurantOut(BaseModel):
    id: int
    name: str
    date_visited: Optional[str]
    city: Optional[str]
    country: Optional[str]
    cuisine: Optional[str]
    rating_mf: Optional[int]
    rating_ad: Optional[int]
    companions: Optional[str]
    google_maps_url: Optional[str]
    notes: Optional[str]
    trip_context: Optional[str]
    source: Optional[str]
    created_at: str
    updated_at: str


class RestaurantStats(BaseModel):
    total: int
    by_year: dict           # {year: count}
    by_cuisine: dict        # {cuisine: count}
    by_country: dict        # {country: count}
    by_city: list           # [{city, country, count}]
    avg_rating_mf: float | None
    avg_rating_ad: float | None
    top_rated: list         # [{id, name, city, rating_mf}]
