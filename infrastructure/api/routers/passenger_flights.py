"""Passenger-flight logbook API — flights taken as a passenger, separate from the
pilot/roster flight log. CRUD + a MyFlightRadar-style analytics rollup that reuses
the shared `airports` table for geo + distances. Logging a flight auto-tags the
day with the user's `traveling` tag (best-effort)."""

import sqlite3
from datetime import date as _date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.passenger_flights import (
    PassengerFlightIn, PassengerFlightOut, PassengerFlightPatch, PassengerFlightStats,
)
from domains.travel.flight_geo import geo_for, normalize_aircraft

router = APIRouter(prefix="/passenger-flights", tags=["passenger-flights"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

KM_PER_MILE = 1.609344
CO2_KG_PER_KM = 0.133   # short-haul economy pax estimate (~matches FR24's figures)

_COLS = (
    "date, flight_number, origin, destination, dep_icao, arr_icao, airline, airline_code, "
    "aircraft, aircraft_code, registration, price_paid, reason, commuting, companion, seat, "
    "seat_type, flight_class, dep_time, arr_time, duration_hours, distance_km, notes"
)


def ensure_traveling_tag(conn: sqlite3.Connection, date: str) -> None:
    """Tag the day as 'traveling' when a passenger flight is logged.

    Best-effort and add-only: matches the user's existing tag by slug or name.
    If no such tag exists we leave the day untouched (no silent tag creation)."""
    tag = conn.execute(
        "SELECT id FROM tags WHERE slug='traveling' OR LOWER(name)='traveling' LIMIT 1"
    ).fetchone()
    if not tag:
        return
    conn.execute(
        "INSERT OR IGNORE INTO day_tags (date, tag_id) VALUES (?, ?)", (date, tag["id"])
    )


def _row(r: sqlite3.Row) -> PassengerFlightOut:
    g = r.keys()
    def v(k):
        return r[k] if k in g else None
    return PassengerFlightOut(
        id=r["id"], date=r["date"], flight_number=v("flight_number"),
        origin=v("origin"), destination=v("destination"),
        dep_icao=v("dep_icao"), arr_icao=v("arr_icao"),
        airline=v("airline"), airline_code=v("airline_code"),
        aircraft=v("aircraft"), aircraft_code=v("aircraft_code"),
        registration=v("registration"), price_paid=v("price_paid"), reason=v("reason"),
        commuting=bool(v("commuting")), companion=v("companion"), seat=v("seat"),
        seat_type=v("seat_type"), flight_class=v("flight_class"),
        dep_time=v("dep_time"), arr_time=v("arr_time"),
        duration_hours=v("duration_hours"), distance_km=v("distance_km"),
        notes=v("notes"), created_at=r["created_at"], updated_at=r["updated_at"],
    )


@router.get("/stats", response_model=PassengerFlightStats)
def get_stats(conn: DB):
    agg = conn.execute(
        """SELECT COUNT(*) AS total,
                  COALESCE(SUM(price_paid),0)     AS spent,
                  COALESCE(SUM(duration_hours),0) AS hours,
                  COUNT(DISTINCT airline)         AS airlines
           FROM passenger_flights"""
    ).fetchone()
    airports = conn.execute(
        """SELECT COUNT(*) AS n FROM (
             SELECT origin AS a FROM passenger_flights WHERE origin IS NOT NULL AND origin != ''
             UNION SELECT destination FROM passenger_flights WHERE destination IS NOT NULL AND destination != ''
           )"""
    ).fetchone()
    per_year = {
        r["y"]: r["n"] for r in conn.execute(
            "SELECT substr(date,1,4) AS y, COUNT(*) AS n FROM passenger_flights GROUP BY y ORDER BY y DESC"
        )
    }
    top_airlines = [
        {"airline": r["airline"], "flights": r["n"]}
        for r in conn.execute(
            "SELECT airline, COUNT(*) AS n FROM passenger_flights "
            "WHERE airline IS NOT NULL AND airline != '' GROUP BY airline ORDER BY n DESC LIMIT 5"
        )
    ]
    top_routes = [
        {"route": r["route"], "flights": r["n"]}
        for r in conn.execute(
            "SELECT (origin || '→' || destination) AS route, COUNT(*) AS n "
            "FROM passenger_flights WHERE origin IS NOT NULL AND destination IS NOT NULL "
            "GROUP BY route ORDER BY n DESC LIMIT 5"
        )
    ]
    year = str(_date.today().year)
    cy = conn.execute(
        """SELECT COUNT(*) AS flights, COALESCE(SUM(price_paid),0) AS spent,
                  COALESCE(SUM(duration_hours),0) AS hours
           FROM passenger_flights WHERE substr(date,1,4)=?""",
        (year,),
    ).fetchone()
    return PassengerFlightStats(
        total=agg["total"] or 0,
        total_spent=round(agg["spent"] or 0, 2),
        distinct_airlines=agg["airlines"] or 0,
        distinct_airports=airports["n"] or 0,
        total_hours=round(agg["hours"] or 0, 1),
        flights_per_year=per_year,
        top_airlines=top_airlines,
        top_routes=top_routes,
        current_year={"year": year, "flights": cy["flights"] or 0,
                      "spent": round(cy["spent"] or 0, 2), "hours": round(cy["hours"] or 0, 1)},
    )


@router.get("/analytics")
def get_analytics(conn: DB):
    """MyFlightRadar-style rollup: totals, top lists, per-year, breakdowns, and
    geo arrays for the world map."""
    tot = conn.execute(
        """SELECT COUNT(*) AS flights,
                  COALESCE(SUM(distance_km),0)    AS km,
                  COALESCE(SUM(duration_hours),0) AS hours,
                  COALESCE(SUM(price_paid),0)     AS spent,
                  COUNT(DISTINCT airline)         AS airlines,
                  COUNT(DISTINCT COALESCE(aircraft_code, aircraft)) AS aircraft
           FROM passenger_flights"""
    ).fetchone()

    km = round(tot["km"] or 0)
    years = [r["y"] for r in conn.execute(
        "SELECT DISTINCT substr(date,1,4) AS y FROM passenger_flights WHERE date IS NOT NULL")]
    years_flying = (int(max(years)) - int(min(years)) + 1) if years else 0

    # Domestic vs international (needs both airports' countries)
    dom = conn.execute(
        """SELECT SUM(CASE WHEN d.country = a.country THEN 1 ELSE 0 END) AS domestic,
                  SUM(CASE WHEN d.country != a.country THEN 1 ELSE 0 END) AS intl
           FROM passenger_flights f
           JOIN airports d ON d.icao = f.dep_icao
           JOIN airports a ON a.icao = f.arr_icao"""
    ).fetchone()

    def _visits():
        return conn.execute(
            """SELECT a.icao, a.iata, a.name, a.city, a.country, a.latitude, a.longitude,
                      COUNT(*) AS visit_count, MIN(f.date) AS first_visit, MAX(f.date) AS last_visit
               FROM (
                 SELECT dep_icao AS icao, date FROM passenger_flights WHERE dep_icao IS NOT NULL
                 UNION ALL
                 SELECT arr_icao, date FROM passenger_flights WHERE arr_icao IS NOT NULL
               ) f
               JOIN airports a ON a.icao = f.icao
               GROUP BY a.icao ORDER BY visit_count DESC""").fetchall()

    airports_geo = [dict(r) for r in _visits()]

    routes_geo = [
        {
            "dep_icao": r["dep_icao"], "arr_icao": r["arr_icao"],
            "dep_iata": r["dep_iata"], "arr_iata": r["arr_iata"],
            "dep_lat": r["dep_lat"], "dep_lon": r["dep_lon"],
            "arr_lat": r["arr_lat"], "arr_lon": r["arr_lon"],
            "count": r["count"], "total_block_hours": round(r["hours"] or 0, 1),
            "operator": r["operator"], "source": "passenger",
        }
        for r in conn.execute(
            """SELECT f.dep_icao, f.arr_icao, d.iata AS dep_iata, a.iata AS arr_iata,
                      d.latitude AS dep_lat, d.longitude AS dep_lon,
                      a.latitude AS arr_lat, a.longitude AS arr_lon,
                      COUNT(*) AS count, SUM(f.duration_hours) AS hours,
                      MAX(f.airline) AS operator
               FROM passenger_flights f
               JOIN airports d ON d.icao = f.dep_icao
               JOIN airports a ON a.icao = f.arr_icao
               GROUP BY f.dep_icao, f.arr_icao ORDER BY count DESC"""
        )
    ]

    def _top(sql, params=()):
        return [dict(r) for r in conn.execute(sql, params)]

    top_airports = [
        {"code": r["iata"] or r["icao"], "city": r["city"], "country": r["country"], "count": r["visit_count"]}
        for r in airports_geo[:8]
    ]
    top_airlines = _top(
        "SELECT COALESCE(airline_code, airline) AS code, airline, COUNT(*) AS count "
        "FROM passenger_flights WHERE airline IS NOT NULL AND airline != '' "
        "GROUP BY airline ORDER BY count DESC LIMIT 8")
    top_aircraft = _top(
        "SELECT COALESCE(aircraft_code, aircraft) AS code, COUNT(*) AS count "
        "FROM passenger_flights WHERE COALESCE(aircraft_code, aircraft) IS NOT NULL "
        "GROUP BY code ORDER BY count DESC LIMIT 8")
    top_routes = _top(
        "SELECT (origin || '–' || destination) AS route, COUNT(*) AS count "
        "FROM passenger_flights WHERE origin IS NOT NULL AND destination IS NOT NULL "
        "GROUP BY route ORDER BY count DESC LIMIT 8")
    top_countries = _top(
        """SELECT country, COUNT(*) AS count FROM (
             SELECT d.country AS country FROM passenger_flights f JOIN airports d ON d.icao=f.dep_icao
             UNION ALL
             SELECT a.country FROM passenger_flights f JOIN airports a ON a.icao=f.arr_icao
           ) GROUP BY country ORDER BY count DESC LIMIT 8""")

    per_year = {r["y"]: r["n"] for r in conn.execute(
        "SELECT substr(date,1,4) AS y, COUNT(*) AS n FROM passenger_flights GROUP BY y ORDER BY y")}

    def _breakdown(col):
        return {r["k"]: r["n"] for r in conn.execute(
            f"SELECT {col} AS k, COUNT(*) AS n FROM passenger_flights "
            f"WHERE {col} IS NOT NULL AND {col} != '' GROUP BY k ORDER BY n DESC")}

    return {
        "totals": {
            "flights": tot["flights"] or 0,
            "distance_km": km,
            "distance_mi": round(km / KM_PER_MILE),
            "hours": round(tot["hours"] or 0, 1),
            "spent": round(tot["spent"] or 0, 2),
            "co2_tons": round(km * CO2_KG_PER_KM / 1000, 1),
            "distinct_airports": len(airports_geo),
            "distinct_airlines": tot["airlines"] or 0,
            "distinct_aircraft": tot["aircraft"] or 0,
            "distinct_countries": len({a["country"] for a in airports_geo if a["country"]}),
            "distinct_routes": len(routes_geo),
            "domestic": (dom["domestic"] or 0) if dom else 0,
            "international": (dom["intl"] or 0) if dom else 0,
            "years_flying": years_flying,
        },
        "top_airports": top_airports,
        "top_airlines": top_airlines,
        "top_aircraft": top_aircraft,
        "top_routes": top_routes,
        "top_countries": top_countries,
        "flights_per_year": per_year,
        "class_breakdown": _breakdown("flight_class"),
        "seat_breakdown": _breakdown("seat_type"),
        "reason_breakdown": _breakdown("reason"),
        "routes_geo": routes_geo,
        "airports_geo": airports_geo,
    }


@router.get("", response_model=list[PassengerFlightOut])
def list_flights(
    year: Optional[int] = Query(None),
    date: Optional[str] = Query(None),
    conn: DB = None,
):
    clauses, params = [], []
    if date:
        clauses.append("date=?")
        params.append(date)
    elif year:
        clauses.append("substr(date,1,4)=?")
        params.append(str(year))
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM passenger_flights {where} ORDER BY date DESC, id DESC", params
    ).fetchall()
    return [_row(r) for r in rows]


@router.get("/{flight_id}", response_model=PassengerFlightOut)
def get_flight(flight_id: int, conn: DB):
    row = conn.execute("SELECT * FROM passenger_flights WHERE id=?", (flight_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Flight not found")
    return _row(row)


def _enrich(conn, body_dict: dict) -> dict:
    """Fill dep_icao/arr_icao/distance + normalise the aircraft code."""
    g = geo_for(conn, body_dict.get("origin"), body_dict.get("destination"))
    body_dict["dep_icao"] = g["dep_icao"]
    body_dict["arr_icao"] = g["arr_icao"]
    body_dict["distance_km"] = g["distance_km"]
    if not body_dict.get("aircraft_code") and body_dict.get("aircraft"):
        body_dict["aircraft_code"] = normalize_aircraft(body_dict["aircraft"])
    return body_dict


@router.post("", response_model=PassengerFlightOut, status_code=201)
def create_flight(body: PassengerFlightIn, conn: DB):
    d = _enrich(conn, body.model_dump())
    cur = conn.execute(
        f"""INSERT INTO passenger_flights ({_COLS})
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (d["date"], d["flight_number"], d["origin"], d["destination"], d["dep_icao"], d["arr_icao"],
         d["airline"], d["airline_code"], d["aircraft"], d["aircraft_code"], d["registration"],
         d["price_paid"], d["reason"], int(d["commuting"]), d["companion"], d["seat"],
         d["seat_type"], d["flight_class"], d["dep_time"], d["arr_time"], d["duration_hours"],
         d["distance_km"], d["notes"]),
    )
    ensure_traveling_tag(conn, d["date"])
    conn.commit()
    row = conn.execute("SELECT * FROM passenger_flights WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row(row)


@router.patch("/{flight_id}", response_model=PassengerFlightOut)
def update_flight(flight_id: int, body: PassengerFlightPatch, conn: DB):
    existing = conn.execute("SELECT * FROM passenger_flights WHERE id=?", (flight_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Flight not found")

    updates = body.model_dump(exclude_unset=True)
    # If the route changed, re-resolve geo + distance.
    if "origin" in updates or "destination" in updates:
        origin = updates.get("origin", existing["origin"])
        destination = updates.get("destination", existing["destination"])
        g = geo_for(conn, origin, destination)
        updates["dep_icao"], updates["arr_icao"], updates["distance_km"] = (
            g["dep_icao"], g["arr_icao"], g["distance_km"])
    if "aircraft" in updates and not updates.get("aircraft_code"):
        updates["aircraft_code"] = normalize_aircraft(updates["aircraft"])
    if "commuting" in updates:
        updates["commuting"] = int(updates["commuting"])
    if not updates:
        return _row(existing)

    set_clause = ", ".join(f"{k}=?" for k in updates)
    set_clause += ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE passenger_flights SET {set_clause} WHERE id=?", [*updates.values(), flight_id]
    )
    conn.commit()
    row = conn.execute("SELECT * FROM passenger_flights WHERE id=?", (flight_id,)).fetchone()
    return _row(row)


@router.delete("/{flight_id}", status_code=204)
def delete_flight(flight_id: int, conn: DB):
    conn.execute("DELETE FROM passenger_flights WHERE id=?", (flight_id,))
    conn.commit()
