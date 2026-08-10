"""Passenger-flight logbook API — flights taken as a passenger, separate from the
pilot/roster flight log. CRUD + rollup stats. Logging a flight auto-tags the day
with the user's `traveling` tag (best-effort)."""

import sqlite3
from datetime import date as _date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.passenger_flights import (
    PassengerFlightIn, PassengerFlightOut, PassengerFlightPatch, PassengerFlightStats,
)

router = APIRouter(prefix="/passenger-flights", tags=["passenger-flights"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

_COLS = (
    "date, flight_number, origin, destination, airline, aircraft, price_paid, "
    "reason, commuting, companion, seat, duration_hours, notes"
)


def ensure_traveling_tag(conn: sqlite3.Connection, date: str) -> None:
    """Tag the day as 'traveling' when a passenger flight is logged.

    Best-effort and add-only: matches the user's existing tag by slug or name.
    If no such tag exists we leave the day untouched (no silent tag creation).
    """
    tag = conn.execute(
        "SELECT id FROM tags WHERE slug='traveling' OR LOWER(name)='traveling' LIMIT 1"
    ).fetchone()
    if not tag:
        return
    conn.execute(
        "INSERT OR IGNORE INTO day_tags (date, tag_id) VALUES (?, ?)", (date, tag["id"])
    )


def _row(r: sqlite3.Row) -> PassengerFlightOut:
    return PassengerFlightOut(
        id=r["id"], date=r["date"], flight_number=r["flight_number"],
        origin=r["origin"], destination=r["destination"], airline=r["airline"],
        aircraft=r["aircraft"], price_paid=r["price_paid"], reason=r["reason"],
        commuting=bool(r["commuting"]), companion=r["companion"], seat=r["seat"],
        duration_hours=r["duration_hours"], notes=r["notes"],
        created_at=r["created_at"], updated_at=r["updated_at"],
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
            "SELECT substr(date,1,4) AS y, COUNT(*) AS n FROM passenger_flights "
            "GROUP BY y ORDER BY y DESC"
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
        current_year={
            "year": year,
            "flights": cy["flights"] or 0,
            "spent": round(cy["spent"] or 0, 2),
            "hours": round(cy["hours"] or 0, 1),
        },
    )


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


@router.post("", response_model=PassengerFlightOut, status_code=201)
def create_flight(body: PassengerFlightIn, conn: DB):
    cur = conn.execute(
        f"""INSERT INTO passenger_flights ({_COLS})
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (body.date, body.flight_number, body.origin, body.destination, body.airline,
         body.aircraft, body.price_paid, body.reason, int(body.commuting),
         body.companion, body.seat, body.duration_hours, body.notes),
    )
    ensure_traveling_tag(conn, body.date)
    conn.commit()
    row = conn.execute("SELECT * FROM passenger_flights WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row(row)


@router.patch("/{flight_id}", response_model=PassengerFlightOut)
def update_flight(flight_id: int, body: PassengerFlightPatch, conn: DB):
    existing = conn.execute("SELECT * FROM passenger_flights WHERE id=?", (flight_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Flight not found")

    updates = body.model_dump(exclude_unset=True)
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
