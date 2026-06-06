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

    return CurrencyStatus(
        reference_date=ref,
        takeoffs_landings_90d=tl,
        takeoffs_90d=tof,
        landings_90d=ldg,
        night_takeoffs_90d=tof_n,
        night_landings_90d=ldg_n,
        next_expiry_date=expiry,
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
def export_pdf(conn: DB):
    from domains.aviation.exporters.pdf_export import generate_pdf
    content = generate_pdf(conn)

    def _iter():
        yield content

    return StreamingResponse(
        _iter(),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="logbook.pdf"'},
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


# ─── Airport autocomplete ─────────────────────────────────────────────────────

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

    # Auto-calculate night_seconds from takeoff/landing UTC + airport coords
    computed_night = flight.night_seconds  # prefer explicit if user provided
    if computed_night is None and airborne_s_explicit and dep_row and dep_row["latitude"]:
        try:
            # Build datetime objects from date + HH:MM
            def _parse_hhmm(date_str: str, hhmm: str) -> datetime | None:
                if not hhmm or ":" not in hhmm:
                    return None
                try:
                    h, m = map(int, hhmm.split(":"))
                    d = datetime.fromisoformat(date_str)
                    return datetime(d.year, d.month, d.day, h, m, tzinfo=timezone.utc)
                except Exception:
                    return None

            tof_dt = _parse_hhmm(flight.date, flight.takeoff_utc)
            ldg_dt = _parse_hhmm(flight.date, flight.landing_utc) if flight.landing_utc else None
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
            notes, pic_name
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
            :notes, :pic_name
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
