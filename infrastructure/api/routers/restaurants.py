"""Restaurants API router — dining log."""

import sqlite3
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.restaurants import (
    RestaurantIn,
    RestaurantOut,
    RestaurantPatch,
    RestaurantStats,
)

router = APIRouter(prefix="/restaurants", tags=["restaurants"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _row_to_restaurant(row: sqlite3.Row) -> RestaurantOut:
    return RestaurantOut(
        id=row["id"],
        name=row["name"],
        date_visited=row["date_visited"],
        city=row["city"],
        country=row["country"],
        cuisine=row["cuisine"],
        rating_mf=row["rating_mf"],
        rating_ad=row["rating_ad"],
        companions=row["companions"],
        google_maps_url=row["google_maps_url"],
        notes=row["notes"],
        trip_context=row["trip_context"],
        source=row["source"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS restaurants (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            date_visited    TEXT,
            city            TEXT,
            country         TEXT,
            cuisine         TEXT,
            rating_mf       INTEGER,
            rating_ad       INTEGER,
            companions      TEXT,
            google_maps_url TEXT,
            notes           TEXT,
            trip_context    TEXT,
            source          TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
    """)
    conn.commit()


@router.get("/stats", response_model=RestaurantStats)
def get_stats(year: Optional[int] = Query(None), conn: DB = None):
    _ensure_table(conn)

    year_clause = "AND substr(date_visited,1,4)=?" if year else ""
    params = [str(year)] if year else []

    total = conn.execute(
        f"SELECT COUNT(*) FROM restaurants WHERE date_visited IS NOT NULL {year_clause}",
        params,
    ).fetchone()[0]

    by_year_rows = conn.execute(
        "SELECT substr(date_visited,1,4) AS y, COUNT(*) AS cnt "
        "FROM restaurants WHERE date_visited IS NOT NULL "
        "GROUP BY y ORDER BY y DESC"
    ).fetchall()
    by_year = {r["y"]: r["cnt"] for r in by_year_rows if r["y"]}

    by_cuisine_rows = conn.execute(
        f"SELECT cuisine, COUNT(*) AS cnt FROM restaurants "
        f"WHERE cuisine IS NOT NULL {year_clause} GROUP BY cuisine ORDER BY cnt DESC",
        params,
    ).fetchall()
    by_cuisine = {r["cuisine"]: r["cnt"] for r in by_cuisine_rows}

    by_country_rows = conn.execute(
        f"SELECT country, COUNT(*) AS cnt FROM restaurants "
        f"WHERE country IS NOT NULL {year_clause} GROUP BY country ORDER BY cnt DESC",
        params,
    ).fetchall()
    by_country = {r["country"]: r["cnt"] for r in by_country_rows}

    by_city_rows = conn.execute(
        f"SELECT city, country, COUNT(*) AS cnt FROM restaurants "
        f"WHERE city IS NOT NULL {year_clause} GROUP BY city, country ORDER BY cnt DESC LIMIT 20",
        params,
    ).fetchall()
    by_city = [{"city": r["city"], "country": r["country"], "count": r["cnt"]} for r in by_city_rows]

    avg_row = conn.execute(
        f"SELECT AVG(rating_mf) AS mf, AVG(rating_ad) AS ad "
        f"FROM restaurants WHERE date_visited IS NOT NULL {year_clause}",
        params,
    ).fetchone()
    avg_mf = round(avg_row["mf"], 1) if avg_row["mf"] else None
    avg_ad = round(avg_row["ad"], 1) if avg_row["ad"] else None

    top_rows = conn.execute(
        f"SELECT id, name, city, country, cuisine, rating_mf, rating_ad FROM restaurants "
        f"WHERE rating_mf IS NOT NULL {year_clause} ORDER BY rating_mf DESC LIMIT 10",
        params,
    ).fetchall()
    top_rated = [dict(r) for r in top_rows]

    return RestaurantStats(
        total=total,
        by_year=by_year,
        by_cuisine=by_cuisine,
        by_country=by_country,
        by_city=by_city,
        avg_rating_mf=avg_mf,
        avg_rating_ad=avg_ad,
        top_rated=top_rated,
    )


@router.get("", response_model=list[RestaurantOut])
def list_restaurants(
    year: Optional[int] = Query(None),
    date: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    cuisine: Optional[str] = Query(None),
    conn: DB = None,
):
    _ensure_table(conn)
    clauses, params = [], []
    if date:
        clauses.append("date_visited=?")
        params.append(date)
    elif year:
        clauses.append("substr(date_visited,1,4)=?")
        params.append(str(year))
    if city:
        clauses.append("city LIKE ?")
        params.append(f"%{city}%")
    if country:
        clauses.append("country=?")
        params.append(country)
    if cuisine:
        clauses.append("cuisine LIKE ?")
        params.append(f"%{cuisine}%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM restaurants {where} ORDER BY date_visited DESC NULLS LAST",
        params,
    ).fetchall()
    return [_row_to_restaurant(r) for r in rows]


@router.get("/{restaurant_id}", response_model=RestaurantOut)
def get_restaurant(restaurant_id: int, conn: DB):
    _ensure_table(conn)
    row = conn.execute("SELECT * FROM restaurants WHERE id=?", (restaurant_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return _row_to_restaurant(row)


@router.post("", response_model=RestaurantOut, status_code=201)
def create_restaurant(body: RestaurantIn, conn: DB):
    _ensure_table(conn)
    cur = conn.execute(
        """INSERT INTO restaurants
            (name, date_visited, city, country, cuisine,
             rating_mf, rating_ad, companions, google_maps_url,
             notes, trip_context, source)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (body.name, body.date_visited, body.city, body.country, body.cuisine,
         body.rating_mf, body.rating_ad, body.companions, body.google_maps_url,
         body.notes, body.trip_context, body.source or "manual"),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM restaurants WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row_to_restaurant(row)


@router.patch("/{restaurant_id}", response_model=RestaurantOut)
def update_restaurant(restaurant_id: int, body: RestaurantPatch, conn: DB):
    _ensure_table(conn)
    existing = conn.execute("SELECT * FROM restaurants WHERE id=?", (restaurant_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not updates:
        return _row_to_restaurant(existing)

    set_clause = ", ".join(f"{k}=?" for k in updates)
    set_clause += ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE restaurants SET {set_clause} WHERE id=?",
        [*updates.values(), restaurant_id],
    )
    conn.commit()
    row = conn.execute("SELECT * FROM restaurants WHERE id=?", (restaurant_id,)).fetchone()
    return _row_to_restaurant(row)


@router.delete("/{restaurant_id}", status_code=204)
def delete_restaurant(restaurant_id: int, conn: DB):
    _ensure_table(conn)
    conn.execute("DELETE FROM restaurants WHERE id=?", (restaurant_id,))
    conn.commit()
