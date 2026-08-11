from typing import Optional
from pydantic import BaseModel, Field


class PassengerFlightIn(BaseModel):
    date: str = Field(description="YYYY-MM-DD — day of the flight")
    flight_number: Optional[str] = None
    origin: Optional[str] = None            # IATA/ICAO — resolved server-side
    destination: Optional[str] = None
    airline: Optional[str] = None
    airline_code: Optional[str] = None
    aircraft: Optional[str] = None
    aircraft_code: Optional[str] = None
    registration: Optional[str] = None
    price_paid: Optional[float] = None
    reason: Optional[str] = None
    commuting: bool = False
    companion: Optional[str] = None
    seat: Optional[str] = None
    seat_type: Optional[str] = None
    flight_class: Optional[str] = None
    dep_time: Optional[str] = None
    arr_time: Optional[str] = None
    duration_hours: Optional[float] = None
    notes: Optional[str] = None


class PassengerFlightPatch(BaseModel):
    date: Optional[str] = None
    flight_number: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    airline: Optional[str] = None
    airline_code: Optional[str] = None
    aircraft: Optional[str] = None
    aircraft_code: Optional[str] = None
    registration: Optional[str] = None
    price_paid: Optional[float] = None
    reason: Optional[str] = None
    commuting: Optional[bool] = None
    companion: Optional[str] = None
    seat: Optional[str] = None
    seat_type: Optional[str] = None
    flight_class: Optional[str] = None
    dep_time: Optional[str] = None
    arr_time: Optional[str] = None
    duration_hours: Optional[float] = None
    notes: Optional[str] = None


class PassengerFlightOut(BaseModel):
    id: int
    date: str
    flight_number: Optional[str]
    origin: Optional[str]
    destination: Optional[str]
    dep_icao: Optional[str]
    arr_icao: Optional[str]
    airline: Optional[str]
    airline_code: Optional[str]
    aircraft: Optional[str]
    aircraft_code: Optional[str]
    registration: Optional[str]
    price_paid: Optional[float]
    reason: Optional[str]
    commuting: bool
    companion: Optional[str]
    seat: Optional[str]
    seat_type: Optional[str]
    flight_class: Optional[str]
    dep_time: Optional[str]
    arr_time: Optional[str]
    duration_hours: Optional[float]
    distance_km: Optional[float]
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
