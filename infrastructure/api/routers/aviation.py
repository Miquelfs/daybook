"""
Aviation router — /flights endpoints.
"""

import json
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from infrastructure.api.db import get_db
from infrastructure.api.models.aviation import (
    AirportInfo,
    AirportVisit,
    CurrencyStatus,
    FlightDetail,
    FlightIn,
    FlightPatch,
    FlightSummary,
    FlightTimeLimits,
    LimitWindow,
    LogbookStats,
    LogbookTotals,
    RouteFrequency,
)

router = APIRouter(prefix="/flights", tags=["aviation"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_summary(r: sqlite3.Row) -> FlightSummary:
    return FlightSummary(
        id=r["id"],
        date=r["date"],
        source=r["source"],
        dep_icao=r["dep_icao"],
        arr_icao=r["arr_icao"],
        dep_iata=r["dep_iata"],
        arr_iata=r["arr_iata"],
        flight_number=r["flight_number"],
        aircraft_reg=r["aircraft_reg"],
        aircraft_type=r["aircraft_type"],
        operator=r["operator"],
        crew_role=r["crew_role"],
        off_block_utc=r["off_block_utc"],
        on_block_utc=r["on_block_utc"],
        block_seconds=r["block_seconds"],
        airborne_seconds=r["airborne_seconds"],
        pic_seconds=r["pic_seconds"] or 0,
        sic_seconds=r["sic_seconds"] or 0,
        night_seconds=r["night_seconds"] or 0,
        distance_nm=r["distance_nm"],
        takeoffs_day=r["takeoffs_day"] or 0,
        takeoffs_night=r["takeoffs_night"] or 0,
        landings_day=r["landings_day"] or 0,
        landings_night=r["landings_night"] or 0,
        is_sim=bool(r["is_sim"]),
        pic_name=r["pic_name"] if "pic_name" in r.keys() else None,
        landing_rating=r["landing_rating"] if "landing_rating" in r.keys() else None,
    )


# Aircraft type name normalisation map (display → canonical)
_AIRCRAFT_TYPE_MAP: dict[str, str] = {
    # B737-800 variants
    "B737-800":              "Boeing 737-800",
    "B737-8AS":              "Boeing 737-800",
    "Boeing 737-8AS":        "Boeing 737-800",
    "738":                   "Boeing 737-800",
    "73H":                   "Boeing 737-800",
    "B738":                  "Boeing 737-800",
    # B737 MAX 8 variants → all normalise to Boeing 737 MAX 8
    "B737 MAX":              "Boeing 737 MAX 8",
    "B737 MAX 8":            "Boeing 737 MAX 8",
    "B737-8200":             "Boeing 737 MAX 8",
    "B737-8200 MAX":         "Boeing 737 MAX 8",
    "Boeing 737 MAX 8-200":  "Boeing 737 MAX 8",
    "Boeing 737 MAX 8":      "Boeing 737 MAX 8",
    "7M8":                   "Boeing 737 MAX 8",
    "B7M8":                  "Boeing 737 MAX 8",
}


def _normalise_aircraft_type(raw: str | None) -> str | None:
    if not raw:
        return raw
    return _AIRCRAFT_TYPE_MAP.get(raw.strip(), raw.strip())


def _utc_diff_seconds(t1: str | None, t2: str | None) -> int | None:
    """Compute seconds between two HH:MM UTC strings, crossing midnight if needed."""
    if not t1 or not t2:
        return None
    try:
        h1, m1 = map(int, t1.split(":"))
        h2, m2 = map(int, t2.split(":"))
        diff = (h2 * 60 + m2) - (h1 * 60 + m1)
        if diff < 0:
            diff += 24 * 60  # crossed midnight
        return diff * 60
    except Exception:
        return None


def _airport_info(conn: sqlite3.Connection, icao: str | None) -> AirportInfo | None:
    if not icao:
        return None
    row = conn.execute("SELECT * FROM airports WHERE icao = ?", (icao,)).fetchone()
    if not row:
        return None
    return AirportInfo(
        icao=row["icao"],
        iata=row["iata"],
        name=row["name"],
        city=row["city"],
        country=row["country"],
        latitude=row["latitude"],
        longitude=row["longitude"],
    )


def _ensure_day(conn: sqlite3.Connection, date_str: str):
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))


# ─── List / filter ────────────────────────────────────────────────────────────

@router.get("", response_model=list[FlightSummary])
def get_flights(
    conn: DB,
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    dep: str | None = Query(None, description="ICAO or IATA departure"),
    arr: str | None = Query(None, description="ICAO or IATA arrival"),
    role: str | None = Query(None, description="pic | first_officer | other"),
    source: str | None = Query(None),
    limit: int = Query(1000, le=5000),
):
    filters = []
    params: list = []

    if start:
        filters.append("date >= ?")
        params.append(start)
    if end:
        filters.append("date <= ?")
        params.append(end)
    if dep:
        filters.append("(dep_icao = ? OR dep_iata = ?)")
        params += [dep.upper(), dep.upper()]
    if arr:
        filters.append("(arr_icao = ? OR arr_iata = ?)")
        params += [arr.upper(), arr.upper()]
    if role:
        filters.append("crew_role = ?")
        params.append(role)
    if source:
        filters.append("source = ?")
        params.append(source)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    rows = conn.execute(
        f"SELECT * FROM flights {where} ORDER BY date, off_block_utc LIMIT ?",
        params + [limit],
    ).fetchall()
    return [_row_to_summary(r) for r in rows]


# ─── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=LogbookStats)
def get_stats(conn: DB):
    def _h(seconds) -> float:
        return round((seconds or 0) / 3600, 2)

    tot = conn.execute("""
        SELECT
            SUM(CASE WHEN is_sim = 0 THEN block_seconds ELSE 0 END)   AS bs,
            SUM(pic_seconds)     AS ps,
            SUM(sic_seconds)     AS ss,
            SUM(night_seconds)   AS ns,
            SUM(ifr_seconds)     AS is_,
            SUM(CASE WHEN is_sim = 1 THEN block_seconds ELSE 0 END)   AS sim_bs,
            SUM(CASE WHEN is_sim = 1 THEN 1 ELSE 0 END)               AS sim_count,
            SUM(CASE WHEN is_sim = 0 THEN distance_nm ELSE NULL END)   AS dm,
            SUM(CASE WHEN is_sim = 0 THEN 1 ELSE 0 END)                AS sectors,
            SUM(takeoffs_day)    AS tod,
            SUM(takeoffs_night)  AS ton,
            SUM(landings_day)    AS ldd,
            SUM(landings_night)  AS ldn
        FROM flights
    """).fetchone()

    totals = LogbookTotals(
        block_hours=_h(tot["bs"]),
        pic_hours=_h(tot["ps"]),
        sic_hours=_h(tot["ss"]),
        night_hours=_h(tot["ns"]),
        ifr_hours=_h(tot["is_"]),
        sim_hours=_h(tot["sim_bs"]),
        sim_sessions=tot["sim_count"] or 0,
        distance_nm=round(tot["dm"] or 0, 1),
        sectors=tot["sectors"] or 0,
        takeoffs_day=tot["tod"] or 0,
        takeoffs_night=tot["ton"] or 0,
        landings_day=tot["ldd"] or 0,
        landings_night=tot["ldn"] or 0,
    )

    by_year = [
        dict(r)
        for r in conn.execute("""
            SELECT substr(date,1,4) AS year,
                   COUNT(*) AS sectors,
                   ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours,
                   ROUND(SUM(pic_seconds)/3600.0, 2) AS pic_hours,
                   ROUND(SUM(sic_seconds)/3600.0, 2) AS sic_hours,
                   ROUND(SUM(night_seconds)/3600.0, 2) AS night_hours,
                   SUM(takeoffs_day)+SUM(takeoffs_night) AS takeoffs,
                   SUM(landings_day)+SUM(landings_night) AS landings
            FROM flights WHERE is_sim = 0
            GROUP BY year ORDER BY year
        """).fetchall()
    ]

    by_month = [
        dict(r)
        for r in conn.execute("""
            SELECT substr(date,1,7) AS month,
                   COUNT(*) AS sectors,
                   ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
            FROM flights WHERE is_sim = 0
            GROUP BY month ORDER BY month
        """).fetchall()
    ]

    by_role = [
        dict(r)
        for r in conn.execute("""
            SELECT crew_role AS role,
                   COUNT(*) AS sectors,
                   ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
            FROM flights WHERE is_sim = 0
            GROUP BY crew_role ORDER BY block_hours DESC
        """).fetchall()
    ]

    by_type = [
        dict(r)
        for r in conn.execute("""
            SELECT aircraft_type,
                   COUNT(*) AS sectors,
                   ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
            FROM flights
            WHERE aircraft_type IS NOT NULL AND is_sim = 0
            GROUP BY aircraft_type ORDER BY block_hours DESC
        """).fetchall()
    ]

    airports_visited = conn.execute("""
        SELECT COUNT(DISTINCT icao) FROM (
            SELECT dep_icao AS icao FROM flights WHERE dep_icao IS NOT NULL
            UNION
            SELECT arr_icao FROM flights WHERE arr_icao IS NOT NULL
        )
    """).fetchone()[0]

    countries_visited = conn.execute("""
        SELECT COUNT(DISTINCT country) FROM airports
        WHERE icao IN (
            SELECT dep_icao FROM flights WHERE dep_icao IS NOT NULL
            UNION
            SELECT arr_icao FROM flights WHERE arr_icao IS NOT NULL
        )
    """).fetchone()[0]

    return LogbookStats(
        totals=totals,
        by_year=by_year,
        by_month=by_month,
        by_role=by_role,
        by_aircraft_type=by_type,
        airports_visited=airports_visited or 0,
        countries_visited=countries_visited or 0,
    )


# ─── Rich analytics ───────────────────────────────────────────────────────────

@router.get("/analytics")
def get_analytics(conn: DB):
    def _h(s) -> float:
        return round((s or 0) / 3600, 2)

    # Longest flight
    longest = conn.execute("""
        SELECT f.*, a1.city AS dep_city, a2.city AS arr_city
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.is_sim = 0 AND f.block_seconds > 0
        ORDER BY f.block_seconds DESC LIMIT 1
    """).fetchone()

    # Shortest flight (non-zero)
    shortest = conn.execute("""
        SELECT f.*, a1.city AS dep_city, a2.city AS arr_city
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.is_sim = 0 AND f.block_seconds > 0
        ORDER BY f.block_seconds ASC LIMIT 1
    """).fetchone()

    # Most flown route
    top_route = conn.execute("""
        SELECT dep_icao, arr_icao, dep_iata, arr_iata, COUNT(*) AS cnt,
               ROUND(SUM(block_seconds)/3600.0, 2) AS total_hours
        FROM flights WHERE dep_icao IS NOT NULL AND arr_icao IS NOT NULL AND is_sim = 0
        GROUP BY dep_icao, arr_icao ORDER BY cnt DESC LIMIT 1
    """).fetchone()

    # Most visited airport
    top_airport = conn.execute("""
        SELECT a.icao, a.iata, a.city, a.country, COUNT(*) AS visits
        FROM (
            SELECT dep_icao AS icao, date FROM flights WHERE dep_icao IS NOT NULL AND is_sim = 0
            UNION
            SELECT arr_icao, date FROM flights WHERE arr_icao IS NOT NULL AND is_sim = 0
        ) f
        JOIN airports a ON a.icao = f.icao
        GROUP BY a.icao ORDER BY visits DESC LIMIT 1
    """).fetchone()

    # Busiest month (most block hours)
    busiest_month = conn.execute("""
        SELECT substr(date,1,7) AS month, COUNT(*) AS sectors,
               ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
        FROM flights WHERE is_sim = 0
        GROUP BY month ORDER BY block_hours DESC LIMIT 1
    """).fetchone()

    # Year-over-year progression
    yoy = conn.execute("""
        SELECT substr(date,1,4) AS year,
               COUNT(*) AS sectors,
               ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours,
               ROUND(SUM(pic_seconds)/3600.0, 2) AS pic_hours,
               ROUND(SUM(night_seconds)/3600.0, 2) AS night_hours,
               COUNT(DISTINCT dep_icao) + COUNT(DISTINCT arr_icao) AS airports_active
        FROM flights WHERE is_sim = 0
        GROUP BY year ORDER BY year
    """).fetchall()

    # Countries visited
    countries = conn.execute("""
        SELECT DISTINCT a.country FROM airports a
        WHERE a.icao IN (
            SELECT dep_icao FROM flights WHERE dep_icao IS NOT NULL AND is_sim = 0
            UNION
            SELECT arr_icao FROM flights WHERE arr_icao IS NOT NULL AND is_sim = 0
        ) AND a.country IS NOT NULL
        ORDER BY a.country
    """).fetchall()

    # Top 5 destinations (arrivals)
    top_dests = conn.execute("""
        SELECT f.arr_icao, f.arr_iata, a.city, a.country, COUNT(*) AS visits
        FROM flights f LEFT JOIN airports a ON a.icao = f.arr_icao
        WHERE f.arr_icao IS NOT NULL AND f.is_sim = 0
        GROUP BY f.arr_icao ORDER BY visits DESC LIMIT 5
    """).fetchall()

    # Aircraft types breakdown
    aircraft = conn.execute("""
        SELECT aircraft_type, COUNT(*) AS sectors,
               ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
        FROM flights WHERE aircraft_type IS NOT NULL AND is_sim = 0
        GROUP BY aircraft_type ORDER BY block_hours DESC
    """).fetchall()

    # Average block hours per sector per year
    avg_sector = conn.execute("""
        SELECT substr(date,1,4) AS year,
               ROUND(AVG(block_seconds)/3600.0, 2) AS avg_block_hours
        FROM flights WHERE is_sim = 0 AND block_seconds > 0
        GROUP BY year ORDER BY year
    """).fetchall()

    # Top registrations (most flown airframes)
    top_regs = conn.execute("""
        SELECT aircraft_reg, aircraft_type, COUNT(*) AS sectors,
               ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
        FROM flights WHERE aircraft_reg IS NOT NULL AND is_sim = 0
        GROUP BY aircraft_reg ORDER BY sectors DESC LIMIT 10
    """).fetchall()

    # Fuel stats (where data exists)
    fuel_stats = conn.execute("""
        SELECT
            ROUND(AVG(fuel_burn_kg), 0) AS avg_burn_kg,
            ROUND(SUM(fuel_burn_kg), 0) AS total_burn_kg,
            ROUND(AVG(fuel_uplift_kg), 0) AS avg_uplift_kg,
            COUNT(*) AS flights_with_fuel
        FROM flights WHERE fuel_burn_kg IS NOT NULL AND is_sim = 0
    """).fetchone()

    # Burn efficiency by aircraft type
    burn_by_type = conn.execute("""
        SELECT aircraft_type,
               ROUND(AVG(fuel_burn_kg), 0) AS avg_burn_kg,
               ROUND(AVG(fuel_burn_kg / NULLIF(distance_nm, 0)), 2) AS kg_per_nm,
               COUNT(*) AS flights
        FROM flights
        WHERE fuel_burn_kg IS NOT NULL AND distance_nm > 0 AND is_sim = 0
        GROUP BY aircraft_type ORDER BY flights DESC
    """).fetchall()

    # Pax stats
    pax_stats = conn.execute("""
        SELECT
            ROUND(AVG(pax_total), 0) AS avg_pax,
            SUM(pax_total) AS total_pax,
            MAX(pax_total) AS max_pax,
            COUNT(*) AS flights_with_pax
        FROM flights WHERE pax_total IS NOT NULL AND is_sim = 0
    """).fetchone()

    # Delay stats
    delay_stats = conn.execute("""
        SELECT
            COUNT(*) AS delayed_flights,
            ROUND(AVG(delay_minutes), 0) AS avg_delay_min,
            MAX(delay_minutes) AS max_delay_min,
            SUM(delay_minutes) AS total_delay_min
        FROM flights WHERE delay_minutes > 0 AND is_sim = 0
    """).fetchone()

    # Delay by code (top codes)
    delay_by_code = conn.execute("""
        SELECT delay_code, COUNT(*) AS cnt,
               ROUND(AVG(delay_minutes), 0) AS avg_min
        FROM flights
        WHERE delay_minutes > 0 AND delay_code IS NOT NULL AND is_sim = 0
        GROUP BY delay_code ORDER BY cnt DESC LIMIT 10
    """).fetchall()

    # Night flying stats
    night_stats = conn.execute("""
        SELECT
            ROUND(SUM(night_seconds)/3600.0, 2)  AS night_hours,
            ROUND(SUM(block_seconds)/3600.0, 2)  AS block_hours,
            SUM(takeoffs_night)                  AS night_takeoffs,
            SUM(landings_night)                  AS night_landings,
            SUM(CASE WHEN night_seconds > 0 THEN 1 ELSE 0 END) AS night_sectors,
            SUM(CASE WHEN night_seconds >= COALESCE(block_seconds, airborne_seconds, 0)
                      AND night_seconds > 0 THEN 1 ELSE 0 END) AS full_night_sectors
        FROM flights WHERE is_sim = 0
    """).fetchone()

    # Month with most night hours
    darkest_month = conn.execute("""
        SELECT substr(date,1,7) AS month,
               ROUND(SUM(night_seconds)/3600.0, 2) AS night_hours,
               SUM(CASE WHEN night_seconds > 0 THEN 1 ELSE 0 END) AS night_sectors
        FROM flights WHERE is_sim = 0
        GROUP BY month HAVING night_hours > 0
        ORDER BY night_hours DESC LIMIT 1
    """).fetchone()

    # Flight with most night time
    most_night_flight = conn.execute("""
        SELECT f.*, a1.city AS dep_city, a2.city AS arr_city
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.is_sim = 0 AND f.night_seconds > 0
        ORDER BY f.night_seconds DESC LIMIT 1
    """).fetchone()

    # Operators breakdown
    operators = conn.execute("""
        SELECT COALESCE(operator, source) AS op_label,
               COUNT(*) AS sectors,
               ROUND(SUM(block_seconds)/3600.0, 2) AS block_hours
        FROM flights WHERE is_sim = 0
        GROUP BY op_label ORDER BY sectors DESC
    """).fetchall()

    def _flight_dict(r) -> dict | None:
        if not r:
            return None
        return {
            "id": r["id"],
            "date": r["date"],
            "dep_icao": r["dep_icao"],
            "arr_icao": r["arr_icao"],
            "dep_iata": r["dep_iata"],
            "arr_iata": r["arr_iata"],
            "block_seconds": r["block_seconds"],
            "dep_city": r["dep_city"],
            "arr_city": r["arr_city"],
        }

    night_stats_dict = None
    if night_stats and (night_stats["night_hours"] or 0) > 0:
        night_stats_dict = dict(night_stats)
        night_stats_dict["night_pct"] = round(
            night_stats["night_hours"] / night_stats["block_hours"] * 100, 1
        ) if night_stats["block_hours"] else 0
        night_stats_dict["darkest_month"] = dict(darkest_month) if darkest_month else None
        if most_night_flight:
            night_stats_dict["most_night_flight"] = {
                **(_flight_dict(most_night_flight) or {}),
                "night_seconds": most_night_flight["night_seconds"],
            }
        else:
            night_stats_dict["most_night_flight"] = None

    return {
        "longest_flight": _flight_dict(longest),
        "shortest_flight": _flight_dict(shortest),
        "top_route": dict(top_route) if top_route else None,
        "top_airport": dict(top_airport) if top_airport else None,
        "busiest_month": dict(busiest_month) if busiest_month else None,
        "year_over_year": [dict(r) for r in yoy],
        "countries": [r["country"] for r in countries],
        "top_destinations": [dict(r) for r in top_dests],
        "aircraft_breakdown": [dict(r) for r in aircraft],
        "avg_sector_by_year": [dict(r) for r in avg_sector],
        "top_registrations": [dict(r) for r in top_regs],
        "fuel_stats": dict(fuel_stats) if fuel_stats and fuel_stats["flights_with_fuel"] else None,
        "burn_by_type": [dict(r) for r in burn_by_type],
        "pax_stats": dict(pax_stats) if pax_stats and pax_stats["flights_with_pax"] else None,
        "night_stats": night_stats_dict,
        "operators": [dict(r) for r in operators],
        "delay_stats": dict(delay_stats) if delay_stats and delay_stats["delayed_flights"] else None,
        "delay_by_code": [dict(r) for r in delay_by_code],
    }


# ─── Currency ─────────────────────────────────────────────────────────────────

@router.get("/currency", response_model=CurrencyStatus)
def get_currency(
    conn: DB,
    reference_date: str | None = Query(None, description="YYYY-MM-DD (default: today)"),
):
    ref = reference_date or date.today().isoformat()
    cutoff = (date.fromisoformat(ref) - timedelta(days=90)).isoformat()

    row = conn.execute("""
        SELECT
            SUM(takeoffs_day)+SUM(takeoffs_night) AS tl_total,
            SUM(takeoffs_day)+SUM(takeoffs_night) AS tof_total,
            SUM(landings_day)+SUM(landings_night) AS ldg_total,
            SUM(takeoffs_night)                   AS tof_night,
            SUM(landings_night)                   AS ldg_night
        FROM flights
        WHERE date > ? AND date <= ?
    """, (cutoff, ref)).fetchone()

    tl = (row["tl_total"] or 0)
    tof = (row["tof_total"] or 0)
    ldg = (row["ldg_total"] or 0)
    tof_n = (row["tof_night"] or 0)
    ldg_n = (row["ldg_night"] or 0)

    # Find the date of the 3rd most recent takeoff or landing (currency requires 3 in 90 days)
    expiry = None
    if tl >= 3:
        # Find date of the oldest of the 3 most recent T/O+Ldg events
        rows_tl = conn.execute("""
            SELECT date FROM flights
            WHERE (takeoffs_day + takeoffs_night + landings_day + landings_night) > 0
              AND date > ? AND date <= ?
            ORDER BY date DESC LIMIT 3
        """, (cutoff, ref)).fetchall()
        if len(rows_tl) == 3:
            oldest_of_three = rows_tl[-1]["date"]
            expiry_dt = date.fromisoformat(oldest_of_three) + timedelta(days=90)
            expiry = expiry_dt.isoformat()

    # Night passenger currency: ≥1 night T/O and ≥1 night landing in the window.
    # Expires 90 days after the older of (latest night T/O, latest night landing).
    night_current = tof_n >= 1 and ldg_n >= 1
    night_expiry = None
    if night_current:
        last_n_tof = conn.execute(
            "SELECT MAX(date) FROM flights WHERE takeoffs_night > 0 AND date <= ?", (ref,)
        ).fetchone()[0]
        last_n_ldg = conn.execute(
            "SELECT MAX(date) FROM flights WHERE landings_night > 0 AND date <= ?", (ref,)
        ).fetchone()[0]
        if last_n_tof and last_n_ldg:
            anchor = min(last_n_tof, last_n_ldg)
            night_expiry = (date.fromisoformat(anchor) + timedelta(days=90)).isoformat()

    return CurrencyStatus(
        reference_date=ref,
        takeoffs_landings_90d=tl,
        takeoffs_90d=tof,
        landings_90d=ldg,
        night_takeoffs_90d=tof_n,
        night_landings_90d=ldg_n,
        next_expiry_date=expiry,
        night_current=night_current,
        night_expiry_date=night_expiry,
    )


# ─── Flight time limitations (EASA ORO.FTL.210) ──────────────────────────────

@router.get("/limits", response_model=FlightTimeLimits)
def get_limits(
    conn: DB,
    reference_date: str | None = Query(None, description="YYYY-MM-DD (default: today)"),
):
    ref = reference_date or date.today().isoformat()
    ref_d = date.fromisoformat(ref)

    def _block_hours(start: str, end: str) -> float:
        row = conn.execute(
            "SELECT SUM(block_seconds) FROM flights WHERE is_sim = 0 AND date >= ? AND date <= ?",
            (start, end),
        ).fetchone()
        return round((row[0] or 0) / 3600, 1)

    d28_start = (ref_d - timedelta(days=27)).isoformat()
    y_start = date(ref_d.year, 1, 1).isoformat()
    m12_start = (ref_d - timedelta(days=364)).isoformat()

    return FlightTimeLimits(
        reference_date=ref,
        days_28=LimitWindow(
            label="28 days", hours=_block_hours(d28_start, ref), limit_hours=100,
            window_start=d28_start, window_end=ref,
        ),
        calendar_year=LimitWindow(
            label="Calendar year", hours=_block_hours(y_start, ref), limit_hours=900,
            window_start=y_start, window_end=ref,
        ),
        months_12=LimitWindow(
            label="12 months", hours=_block_hours(m12_start, ref), limit_hours=1000,
            window_start=m12_start, window_end=ref,
        ),
    )


# ─── Route map data ───────────────────────────────────────────────────────────

@router.get("/routes", response_model=list[RouteFrequency])
def get_routes(conn: DB, year: str | None = Query(None, description="4-digit year filter")):
    filters = "WHERE f.dep_icao IS NOT NULL AND f.arr_icao IS NOT NULL"
    params: list = []
    if year:
        filters += " AND substr(f.date,1,4) = ?"
        params.append(year)
    rows = conn.execute(f"""
        SELECT f.dep_icao, f.arr_icao, f.dep_iata, f.arr_iata,
               COUNT(*) AS count,
               ROUND(SUM(f.block_seconds)/3600.0, 2) AS total_block_hours,
               a1.latitude AS dep_lat, a1.longitude AS dep_lon,
               a2.latitude AS arr_lat, a2.longitude AS arr_lon,
               f.operator, f.source
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        {filters}
        GROUP BY f.dep_icao, f.arr_icao, f.operator, f.source
        ORDER BY count DESC
    """, params).fetchall()
    return [
        RouteFrequency(
            dep_icao=r["dep_icao"],
            arr_icao=r["arr_icao"],
            dep_iata=r["dep_iata"],
            arr_iata=r["arr_iata"],
            dep_lat=r["dep_lat"],
            dep_lon=r["dep_lon"],
            arr_lat=r["arr_lat"],
            arr_lon=r["arr_lon"],
            count=r["count"],
            total_block_hours=r["total_block_hours"],
            operator=r["operator"],
            source=r["source"],
        )
        for r in rows
    ]


@router.get("/airports", response_model=list[AirportVisit])
def get_airport_visits(conn: DB, year: str | None = Query(None, description="4-digit year filter")):
    year_clause = "AND substr(date,1,4) = ?" if year else ""
    params = [year] if year else []
    rows = conn.execute(f"""
        SELECT a.icao, a.iata, a.name, a.city, a.country, a.latitude, a.longitude,
               COUNT(*) AS visit_count,
               MIN(f.date) AS first_visit,
               MAX(f.date) AS last_visit
        FROM (
            SELECT dep_icao AS icao, date FROM flights WHERE dep_icao IS NOT NULL {year_clause}
            UNION
            SELECT arr_icao, date FROM flights WHERE arr_icao IS NOT NULL {year_clause}
        ) f
        JOIN airports a ON a.icao = f.icao
        GROUP BY a.icao
        ORDER BY visit_count DESC
    """, params + params).fetchall()
    return [
        AirportVisit(
            icao=r["icao"],
            iata=r["iata"],
            name=r["name"],
            city=r["city"],
            country=r["country"],
            latitude=r["latitude"],
            longitude=r["longitude"],
            visit_count=r["visit_count"],
            first_visit=r["first_visit"],
            last_visit=r["last_visit"],
        )
        for r in rows
    ]


# ─── Airport autocomplete (must be BEFORE /airports/{icao}/flights) ───────────

@router.get("/airports/search")
def search_airports(
    conn: DB,
    q: str = Query(..., min_length=1),
    limit: int = Query(10, le=50),
):
    qu = q.upper()
    pattern = f"{qu}%"
    rows = conn.execute("""
        SELECT icao, iata, name, city, country, latitude, longitude
        FROM airports
        WHERE icao LIKE ? OR iata LIKE ? OR city LIKE ?
        ORDER BY
            CASE WHEN icao = ? OR iata = ? THEN 0
                 WHEN icao LIKE ? OR iata LIKE ? THEN 1
                 ELSE 2 END,
            icao
        LIMIT ?
    """, (pattern, pattern, pattern, qu, qu, pattern, pattern, limit)).fetchall()
    return [dict(r) for r in rows]


# ─── Airport detail (all flights through an airport) ─────────────────────────

@router.get("/airports/{icao}/flights")
def airport_flights(icao: str, conn: DB):
    """Return all flights departing or arriving at an airport. Accepts ICAO or IATA code."""
    code = icao.upper().strip()
    # Try ICAO first, then IATA fallback
    airport = conn.execute(
        "SELECT * FROM airports WHERE icao = ?", (code,)
    ).fetchone()
    if airport is None:
        airport = conn.execute(
            "SELECT * FROM airports WHERE iata = ?", (code,)
        ).fetchone()
    if airport is None:
        raise HTTPException(status_code=404, detail=f"Airport {code} not found")

    icao_code = airport["icao"]
    rows = conn.execute("""
        SELECT f.id, f.date, f.dep_icao, f.arr_icao, f.flight_number,
               f.aircraft_type, f.aircraft_reg, f.crew_role, f.pic_name,
               f.block_seconds, f.night_seconds, f.off_block_utc, f.on_block_utc,
               f.takeoffs_day, f.takeoffs_night, f.landings_day, f.landings_night,
               a1.iata AS dep_iata_a, a1.name AS dep_name, a1.city AS dep_city,
               a2.iata AS arr_iata_a, a2.name AS arr_name, a2.city AS arr_city
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE (f.dep_icao = ? OR f.arr_icao = ?) AND f.is_sim = 0
        ORDER BY f.date, f.off_block_utc
    """, (icao_code, icao_code)).fetchall()

    flights = [dict(r) for r in rows]
    deps = [f for f in flights if f["dep_icao"] == icao_code]
    arrs = [f for f in flights if f["arr_icao"] == icao_code]
    total_block = sum(r["block_seconds"] or 0 for r in rows)
    total_night = sum(r["night_seconds"] or 0 for r in rows)
    night_movements = sum(
        1 for f in flights
        if (f["dep_icao"] == icao_code and (f["takeoffs_night"] or 0) > 0)
        or (f["arr_icao"] == icao_code and (f["landings_night"] or 0) > 0)
    )

    return {
        "icao": airport["icao"],
        "iata": airport["iata"],
        "name": airport["name"],
        "city": airport["city"],
        "country": airport["country"],
        "latitude": airport["latitude"],
        "longitude": airport["longitude"],
        "total_movements": len(rows),
        "departures": len(deps),
        "arrivals": len(arrs),
        "total_block_seconds": total_block,
        "total_night_seconds": total_night,
        "night_movements": night_movements,
        "first_visit": rows[0]["date"] if rows else None,
        "last_visit": rows[-1]["date"] if rows else None,
        "flights": flights,
    }


# ─── Export ───────────────────────────────────────────────────────────────────

@router.get("/export/easa")
def export_easa(conn: DB):
    from domains.aviation.exporters.easa_export import generate_easa_csv
    content = generate_easa_csv(conn)

    def _iter():
        yield content

    return StreamingResponse(
        _iter(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="logbook_easa.csv"'},
    )


@router.get("/export/excel")
def export_excel(conn: DB):
    from domains.aviation.exporters.excel_export import generate_excel
    content = generate_excel(conn)

    def _iter():
        yield content

    return StreamingResponse(
        _iter(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="logbook.xlsx"'},
    )


@router.get("/export/pdf")
def export_pdf(conn: DB, theme: str = Query("dark", description="dark | light")):
    from domains.aviation.exporters.pdf_export import generate_pdf
    content = generate_pdf(conn, theme=theme)
    fname = "logbook.pdf" if theme == "light" else "logbook_dark.pdf"

    def _iter():
        yield content

    return StreamingResponse(
        _iter(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/export/csv")
def export_generic_csv(conn: DB):
    from domains.aviation.exporters.generic_csv_export import generate_generic_csv
    content = generate_generic_csv(conn)

    def _iter():
        yield content

    return StreamingResponse(
        _iter(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="logbook.csv"'},
    )


# ─── Captains list (for add-flight form autocomplete) ────────────────────────

@router.get("/captains")
def list_captains(conn: DB):
    """Return distinct pic_names seen across all flights."""
    rows = conn.execute("""
        SELECT DISTINCT pic_name FROM flights
        WHERE pic_name IS NOT NULL AND pic_name != '' AND is_sim = 0
        ORDER BY pic_name
    """).fetchall()
    return [{"raw": r["pic_name"], "display": r["pic_name"]} for r in rows]


@router.get("/captains/{name}")
def captain_history(name: str, conn: DB):
    """Return all flights flown with a specific captain (pic_name match)."""
    rows = conn.execute("""
        SELECT f.id, f.date, f.dep_icao, f.arr_icao, f.flight_number,
               f.aircraft_type, f.aircraft_reg, f.crew_role,
               f.block_seconds, f.night_seconds, f.off_block_utc, f.on_block_utc, f.pic_name,
               a1.iata AS dep_iata_a, a1.name AS dep_name, a1.city AS dep_city,
               a2.iata AS arr_iata_a, a2.name AS arr_name, a2.city AS arr_city
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.pic_name = ? AND f.is_sim = 0
        ORDER BY f.date, f.off_block_utc
    """, (name,)).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"No flights found with captain {name!r}")
    flights = [dict(r) for r in rows]
    total_block = sum(r["block_seconds"] or 0 for r in rows)
    total_night = sum(r["night_seconds"] or 0 for r in rows)
    # Distinct aircraft types flown together
    types = list({r["aircraft_type"] for r in rows if r["aircraft_type"]})
    return {
        "name": name,
        "total_flights": len(rows),
        "total_block_seconds": total_block,
        "total_night_seconds": total_night,
        "first_flight": rows[0]["date"],
        "last_flight": rows[-1]["date"],
        "aircraft_types": types,
        "flights": flights,
    }


# ─── Aircraft lookup ──────────────────────────────────────────────────────────

@router.get("/aircraft/{registration}")
def aircraft_history(registration: str, conn: DB):
    """Return all flights on a specific registration."""
    reg = registration.upper().strip()
    rows = conn.execute("""
        SELECT f.id, f.date, f.dep_icao, f.arr_icao, f.flight_number,
               f.aircraft_type, f.aircraft_reg, f.crew_role,
               f.block_seconds, f.night_seconds, f.off_block_utc, f.on_block_utc,
               a1.iata AS dep_iata_a, a1.name AS dep_name, a1.city AS dep_city,
               a2.iata AS arr_iata_a, a2.name AS arr_name, a2.city AS arr_city
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE UPPER(f.aircraft_reg) = ?
        ORDER BY f.date, f.off_block_utc
    """, (reg,)).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"No flights found for {reg}")
    flights = [dict(r) for r in rows]
    total_block = sum(r["block_seconds"] or 0 for r in rows)
    total_night = sum(r["night_seconds"] or 0 for r in rows)
    return {
        "registration": reg,
        "aircraft_type": rows[0]["aircraft_type"],
        "total_flights": len(rows),
        "total_block_seconds": total_block,
        "total_night_seconds": total_night,
        "first_flight": rows[0]["date"],
        "last_flight": rows[-1]["date"],
        "flights": flights,
    }


# ─── Single flight ────────────────────────────────────────────────────────────

@router.get("/{flight_id}", response_model=FlightDetail)
def get_flight(flight_id: str, conn: DB):
    row = conn.execute("SELECT * FROM flights WHERE id = ?", (flight_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Flight {flight_id!r} not found")

    summary = _row_to_summary(row)
    dep_airport = _airport_info(conn, row["dep_icao"])
    arr_airport = _airport_info(conn, row["arr_icao"])

    return FlightDetail(
        **summary.model_dump(),
        takeoff_utc=row["takeoff_utc"],
        landing_utc=row["landing_utc"],
        takeoff_crew=row["takeoff_crew"],
        landing_crew=row["landing_crew"],
        sim_type=row["sim_type"],
        ifr_seconds=row["ifr_seconds"] or 0,
        pax_total=row["pax_total"],
        pax_adult=row["pax_adult"],
        pax_child=row["pax_child"],
        pax_infant=row["pax_infant"],
        freight_kg=row["freight_kg"],
        baggage_kg=row["baggage_kg"] if "baggage_kg" in row.keys() else None,
        fuel_block_kg=row["fuel_block_kg"],
        fuel_trip_kg=row["fuel_trip_kg"],
        fuel_reserves_kg=row["fuel_reserves_kg"],
        fuel_uplift_kg=row["fuel_uplift_kg"],
        fuel_burn_kg=row["fuel_burn_kg"],
        fuel_burn_diff_kg=row["fuel_burn_diff_kg"],
        delay_minutes=row["delay_minutes"],
        delay_code=row["delay_code"],
        delay_reason=row["delay_reason"],
        notes=row["notes"],
        remarks=row["remarks"] if "remarks" in row.keys() else None,
        dep_airport=dep_airport,
        arr_airport=arr_airport,
    )


# ─── Create (manual entry) ────────────────────────────────────────────────────

@router.post("", response_model=FlightSummary, status_code=201)
def create_flight(flight: FlightIn, conn: DB):
    from domains.aviation.compute import great_circle_nm, night_seconds as compute_night_seconds

    dep_icao = (flight.dep_icao or "").upper() or None
    arr_icao = (flight.arr_icao or "").upper() or None

    # Auto-fill IATA codes and distance from airports table
    dep_iata = flight.dep_iata
    arr_iata = flight.arr_iata
    dist_nm = None
    dep_row = conn.execute("SELECT * FROM airports WHERE icao = ?", (dep_icao,)).fetchone() if dep_icao else None
    arr_row = conn.execute("SELECT * FROM airports WHERE icao = ?", (arr_icao,)).fetchone() if arr_icao else None
    if dep_row:
        if not dep_iata:
            dep_iata = dep_row["iata"]
        if arr_row and dep_row["latitude"] and arr_row["latitude"]:
            dist_nm = round(
                great_circle_nm(dep_row["latitude"], dep_row["longitude"], arr_row["latitude"], arr_row["longitude"]),
                1,
            )

    # Normalise aircraft type
    aircraft_type = _normalise_aircraft_type(flight.aircraft_type)

    # Auto-calculate block_seconds from off_block/on_block if not explicitly provided
    block_s_explicit = flight.block_seconds
    if block_s_explicit is None and flight.off_block_utc and flight.on_block_utc:
        block_s_explicit = _utc_diff_seconds(flight.off_block_utc, flight.on_block_utc)

    # Auto-calculate airborne_seconds from takeoff/landing UTC if not explicitly provided
    airborne_s_explicit = flight.airborne_seconds
    if airborne_s_explicit is None and flight.takeoff_utc and flight.landing_utc:
        airborne_s_explicit = _utc_diff_seconds(flight.takeoff_utc, flight.landing_utc)

    # Auto-calculate night_seconds from takeoff/landing UTC + airport coords.
    # Falls back to off/on-block times if takeoff/landing not provided.
    computed_night = flight.night_seconds  # prefer explicit if user provided
    if computed_night is None and dep_row and dep_row["latitude"]:
        try:
            def _parse_hhmm(date_str: str, hhmm: str | None) -> datetime | None:
                if not hhmm:
                    return None
                # Accept "HH:MM" or ISO "2026-06-18T14:30" / "2026-06-18T14:30:00"
                t = hhmm[11:16] if len(hhmm) > 5 else hhmm
                if ":" not in t:
                    return None
                try:
                    h, m = map(int, t.split(":"))
                    d = datetime.fromisoformat(date_str)
                    return datetime(d.year, d.month, d.day, h, m, tzinfo=timezone.utc)
                except Exception:
                    return None

            # Prefer takeoff/landing; fall back to off/on-block
            tof_dt = _parse_hhmm(flight.date, flight.takeoff_utc or flight.off_block_utc)
            ldg_dt = _parse_hhmm(flight.date, flight.landing_utc or flight.on_block_utc)
            if ldg_dt and tof_dt and ldg_dt <= tof_dt:
                ldg_dt = ldg_dt + timedelta(days=1)  # midnight crossing
            if tof_dt and ldg_dt:
                computed_night = compute_night_seconds(
                    dep_lat=dep_row["latitude"],
                    dep_lon=dep_row["longitude"],
                    takeoff_utc=tof_dt,
                    landing_utc=ldg_dt,
                    arr_lat=arr_row["latitude"] if arr_row else None,
                    arr_lon=arr_row["longitude"] if arr_row else None,
                )
        except Exception:
            pass

    # Derive PIC/SIC seconds from role and block_seconds
    block_s = block_s_explicit or 0
    if flight.crew_role == "pic":
        pic_s, sic_s = block_s, 0
    else:
        pic_s, sic_s = 0, block_s

    dep_part = dep_icao or "SIM"
    arr_part = arr_icao or "SIM"
    flight_id = f"manual_{flight.date}_{dep_part}_{arr_part}_{uuid.uuid4().hex[:8]}"

    _ensure_day(conn, flight.date)
    conn.execute("""
        INSERT INTO flights (
            id, date, source, raw_payload,
            dep_icao, arr_icao, dep_iata, arr_iata,
            off_block_utc, on_block_utc, takeoff_utc, landing_utc,
            block_seconds, airborne_seconds,
            flight_number, aircraft_reg, aircraft_type, operator,
            crew_role, is_sim, sim_type,
            pic_seconds, sic_seconds, night_seconds, ifr_seconds, distance_nm,
            takeoffs_day, takeoffs_night, landings_day, landings_night,
            pax_total, pax_adult, pax_child, pax_infant,
            freight_kg, baggage_kg,
            fuel_uplift_kg, fuel_block_kg, fuel_burn_kg,
            delay_minutes, delay_code, delay_reason,
            notes, remarks, pic_name
        ) VALUES (
            :id, :date, 'manual', '{}',
            :dep_icao, :arr_icao, :dep_iata, :arr_iata,
            :off_block_utc, :on_block_utc, :takeoff_utc, :landing_utc,
            :block_seconds, :airborne_seconds,
            :flight_number, :aircraft_reg, :aircraft_type, :operator,
            :crew_role, :is_sim, :sim_type,
            :pic_seconds, :sic_seconds, :night_seconds, :ifr_seconds, :distance_nm,
            :takeoffs_day, :takeoffs_night, :landings_day, :landings_night,
            :pax_total, :pax_adult, :pax_child, :pax_infant,
            :freight_kg, :baggage_kg,
            :fuel_uplift_kg, :fuel_block_kg, :fuel_burn_kg,
            :delay_minutes, :delay_code, :delay_reason,
            :notes, :remarks, :pic_name
        )
    """, {
        "id": flight_id,
        "date": flight.date,
        "dep_icao": dep_icao,
        "arr_icao": arr_icao,
        "dep_iata": dep_iata,
        "arr_iata": arr_iata or (arr_row["iata"] if arr_row else None),
        "off_block_utc": flight.off_block_utc,
        "on_block_utc": flight.on_block_utc,
        "takeoff_utc": flight.takeoff_utc,
        "landing_utc": flight.landing_utc,
        "block_seconds": block_s_explicit,
        "airborne_seconds": airborne_s_explicit,
        "flight_number": flight.flight_number,
        "aircraft_reg": flight.aircraft_reg,
        "aircraft_type": aircraft_type,
        "operator": flight.operator,
        "crew_role": flight.crew_role,
        "is_sim": int(flight.is_sim),
        "sim_type": flight.sim_type,
        "pic_seconds": pic_s,
        "sic_seconds": sic_s,
        "night_seconds": computed_night or 0,
        "ifr_seconds": block_s if (flight.operator or "").lower() in ("norwegian",) else 0,
        "distance_nm": dist_nm,
        "takeoffs_day": flight.takeoffs_day,
        "takeoffs_night": flight.takeoffs_night,
        "landings_day": flight.landings_day,
        "landings_night": flight.landings_night,
        "pax_total": flight.pax_total,
        "pax_adult": flight.pax_adult,
        "pax_child": flight.pax_child,
        "pax_infant": flight.pax_infant,
        "freight_kg": flight.freight_kg,
        "baggage_kg": flight.baggage_kg,
        "fuel_uplift_kg": flight.fuel_uplift_kg,
        "fuel_block_kg": flight.fuel_block_kg,
        "fuel_burn_kg": flight.fuel_burn_kg,
        "delay_minutes": flight.delay_minutes,
        "delay_code": flight.delay_code,
        "delay_reason": flight.delay_reason,
        "notes": flight.notes,
        "remarks": flight.remarks,
        "pic_name": flight.pic_name,
    })
    conn.commit()

    row = conn.execute("SELECT * FROM flights WHERE id = ?", (flight_id,)).fetchone()
    return _row_to_summary(row)


# ─── Update ───────────────────────────────────────────────────────────────────

@router.patch("/{flight_id}", response_model=FlightSummary)
def patch_flight(flight_id: str, patch: FlightPatch, conn: DB):
    row = conn.execute("SELECT * FROM flights WHERE id = ?", (flight_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    updates: dict[str, object] = {}
    for field, value in patch.model_dump(exclude_none=True).items():
        updates[field] = value

    # Re-derive pic/sic if role or block_seconds changed
    if "crew_role" in updates or "block_seconds" in updates:
        block_s = updates.get("block_seconds", row["block_seconds"]) or 0
        role = updates.get("crew_role", row["crew_role"])
        if role == "pic":
            updates["pic_seconds"] = block_s
            updates["sic_seconds"] = 0
        else:
            updates["pic_seconds"] = 0
            updates["sic_seconds"] = block_s

    if not updates:
        return _row_to_summary(row)

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["flight_id"] = flight_id
    conn.execute(f"UPDATE flights SET {set_clause} WHERE id = :flight_id", updates)
    conn.commit()

    row = conn.execute("SELECT * FROM flights WHERE id = ?", (flight_id,)).fetchone()
    return _row_to_summary(row)


# ─── Delete (manual only) ─────────────────────────────────────────────────────

@router.delete("/{flight_id}", status_code=204)
def delete_flight(flight_id: str, conn: DB):
    row = conn.execute("SELECT source FROM flights WHERE id = ?", (flight_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    if row["source"] != "manual":
        raise HTTPException(status_code=403, detail="Only manual flights can be deleted")
    conn.execute("DELETE FROM flights WHERE id = ?", (flight_id,))
    conn.commit()
