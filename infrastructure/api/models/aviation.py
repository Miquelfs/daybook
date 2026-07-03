from __future__ import annotations
from pydantic import BaseModel


class FlightSummary(BaseModel):
    id: str
    date: str
    source: str
    dep_icao: str | None = None
    arr_icao: str | None = None
    dep_iata: str | None = None
    arr_iata: str | None = None
    flight_number: str | None = None
    aircraft_reg: str | None = None
    aircraft_type: str | None = None
    operator: str | None = None
    crew_role: str | None = None
    off_block_utc: str | None = None
    on_block_utc: str | None = None
    block_seconds: int | None = None
    airborne_seconds: int | None = None
    pic_seconds: int = 0
    sic_seconds: int = 0
    night_seconds: int = 0
    distance_nm: float | None = None
    takeoffs_day: int = 0
    takeoffs_night: int = 0
    landings_day: int = 0
    landings_night: int = 0
    is_sim: bool = False
    pic_name: str | None = None
    landing_rating: int | None = None


class AirportInfo(BaseModel):
    icao: str
    iata: str | None = None
    name: str | None = None
    city: str | None = None
    country: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class FlightDetail(FlightSummary):
    takeoff_utc: str | None = None
    landing_utc: str | None = None
    takeoff_crew: str | None = None
    landing_crew: str | None = None
    sim_type: str | None = None
    ifr_seconds: int = 0
    pax_total: int | None = None
    pax_adult: int | None = None
    pax_child: int | None = None
    pax_infant: int | None = None
    freight_kg: float | None = None
    baggage_kg: float | None = None
    fuel_block_kg: float | None = None
    fuel_trip_kg: float | None = None
    fuel_reserves_kg: float | None = None
    fuel_uplift_kg: float | None = None
    fuel_burn_kg: float | None = None
    fuel_burn_diff_kg: float | None = None
    delay_minutes: int | None = None
    delay_code: str | None = None
    delay_reason: str | None = None
    notes: str | None = None
    remarks: str | None = None
    dep_airport: AirportInfo | None = None
    arr_airport: AirportInfo | None = None


class FlightIn(BaseModel):
    date: str
    dep_icao: str | None = None
    arr_icao: str | None = None
    dep_iata: str | None = None
    arr_iata: str | None = None
    flight_number: str | None = None
    aircraft_reg: str | None = None
    aircraft_type: str | None = None
    operator: str | None = None
    crew_role: str | None = None
    off_block_utc: str | None = None
    on_block_utc: str | None = None
    takeoff_utc: str | None = None
    landing_utc: str | None = None
    block_seconds: int | None = None
    airborne_seconds: int | None = None
    is_sim: bool = False
    sim_type: str | None = None
    pic_name: str | None = None
    takeoffs_day: int = 0
    takeoffs_night: int = 0
    landings_day: int = 0
    landings_night: int = 0
    night_seconds: int = 0
    notes: str | None = None
    remarks: str | None = None
    pax_total: int | None = None
    pax_adult: int | None = None
    pax_child: int | None = None
    pax_infant: int | None = None
    freight_kg: float | None = None
    baggage_kg: float | None = None
    fuel_uplift_kg: float | None = None
    fuel_block_kg: float | None = None
    fuel_burn_kg: float | None = None
    delay_minutes: int | None = None
    delay_code: str | None = None
    delay_reason: str | None = None


class FlightPatch(BaseModel):
    crew_role: str | None = None
    notes: str | None = None
    remarks: str | None = None
    landing_rating: int | None = None
    night_seconds: int | None = None
    ifr_seconds: int | None = None
    takeoffs_day: int | None = None
    takeoffs_night: int | None = None
    landings_day: int | None = None
    landings_night: int | None = None
    # Operational data editable post-import
    pax_total: int | None = None
    pax_adult: int | None = None
    pax_child: int | None = None
    pax_infant: int | None = None
    freight_kg: float | None = None
    baggage_kg: float | None = None
    fuel_uplift_kg: float | None = None
    fuel_block_kg: float | None = None
    fuel_burn_kg: float | None = None
    fuel_trip_kg: float | None = None
    fuel_reserves_kg: float | None = None
    delay_minutes: int | None = None
    delay_code: str | None = None
    delay_reason: str | None = None
    pic_name: str | None = None
    airborne_seconds: int | None = None
    block_seconds: int | None = None


class LogbookTotals(BaseModel):
    block_hours: float = 0
    pic_hours: float = 0
    sic_hours: float = 0
    night_hours: float = 0
    ifr_hours: float = 0
    sim_hours: float = 0
    sim_sessions: int = 0
    distance_nm: float = 0
    sectors: int = 0
    takeoffs_day: int = 0
    takeoffs_night: int = 0
    landings_day: int = 0
    landings_night: int = 0


class LogbookStats(BaseModel):
    totals: LogbookTotals
    by_year: list[dict] = []
    by_month: list[dict] = []
    by_role: list[dict] = []
    by_aircraft_type: list[dict] = []
    airports_visited: int = 0
    countries_visited: int = 0


class RouteFrequency(BaseModel):
    dep_icao: str
    arr_icao: str
    dep_iata: str | None = None
    arr_iata: str | None = None
    dep_lat: float | None = None
    dep_lon: float | None = None
    arr_lat: float | None = None
    arr_lon: float | None = None
    count: int
    total_block_hours: float
    operator: str | None = None
    source: str | None = None


class AirportVisit(BaseModel):
    icao: str
    iata: str | None = None
    name: str | None = None
    city: str | None = None
    country: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    visit_count: int
    first_visit: str | None = None
    last_visit: str | None = None


class CurrencyStatus(BaseModel):
    reference_date: str
    takeoffs_landings_90d: int
    takeoffs_90d: int
    landings_90d: int
    night_takeoffs_90d: int
    night_landings_90d: int
    next_expiry_date: str | None = None
