from typing import Optional
from pydantic import BaseModel, Field


class PassengerFlightIn(BaseModel):
    date: str = Field(description="YYYY-MM-DD — day of the flight")
    flight_number: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    airline: Optional[str] = None
    aircraft: Optional[str] = None
    price_paid: Optional[float] = None
    reason: Optional[str] = None
    commuting: bool = False
    companion: Optional[str] = None
    seat: Optional[str] = None
    duration_hours: Optional[float] = None
    notes: Optional[str] = None


class PassengerFlightPatch(BaseModel):
    date: Optional[str] = None
    flight_number: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    airline: Optional[str] = None
    aircraft: Optional[str] = None
    price_paid: Optional[float] = None
    reason: Optional[str] = None
    commuting: Optional[bool] = None
    companion: Optional[str] = None
    seat: Optional[str] = None
    duration_hours: Optional[float] = None
    notes: Optional[str] = None


class PassengerFlightOut(BaseModel):
    id: int
    date: str
    flight_number: Optional[str]
    origin: Optional[str]
    destination: Optional[str]
    airline: Optional[str]
    aircraft: Optional[str]
    price_paid: Optional[float]
    reason: Optional[str]
    commuting: bool
    companion: Optional[str]
    seat: Optional[str]
    duration_hours: Optional[float]
    notes: Optional[str]
    created_at: str
    updated_at: str


class PassengerFlightStats(BaseModel):
    total: int
    total_spent: float
    distinct_airlines: int
    distinct_airports: int
    total_hours: float
    flights_per_year: dict          # {YYYY: count}
    top_airlines: list              # [{airline, flights}]
    top_routes: list                # [{route, flights}]
    current_year: dict              # {year, flights, spent, hours}
