"""Shows/movies API router — watch log."""

import sqlite3
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.shows import ShowIn, ShowOut, ShowPatch, ShowStats

router = APIRouter(prefix="/shows", tags=["shows"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _row_to_show(row: sqlite3.Row) -> ShowOut:
    return ShowOut(
        id=row["id"],
        title=row["title"],
        date_watched=row["date_watched"],
        type=row["type"],
        genre=row["genre"],
        platform=row["platform"],
        companions=row["companions"],
        rating_mf=row["rating_mf"],
        rating_ad=row["rating_ad"],
        notes=row["notes"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS shows (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            date_watched TEXT,
            type         TEXT,
            genre        TEXT,
            platform     TEXT,
            companions   TEXT,
            rating_mf    INTEGER,
            rating_ad    INTEGER,
            notes        TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()


@router.get("/stats", response_model=ShowStats)
def get_stats(year: Optional[int] = Query(None), conn: DB = None):
    _ensure_table(conn)
    year_clause = "AND substr(date_watched,1,4)=?" if year else ""
    year_params: tuple = (str(year),) if year else ()

    total = conn.execute(
        f"SELECT COUNT(*) FROM shows WHERE date_watched IS NOT NULL {year_clause}",
        year_params,
    ).fetchone()[0]

    by_year: dict = {}
    for row in conn.execute(
        "SELECT substr(date_watched,1,4) AS y, COUNT(*) AS c FROM shows "
        "WHERE date_watched IS NOT NULL GROUP BY y ORDER BY y DESC"
    ).fetchall():
        by_year[row["y"]] = row["c"]

    by_type: dict = {}
    for row in conn.execute(
        f"SELECT type, COUNT(*) AS c FROM shows WHERE type IS NOT NULL {year_clause} GROUP BY type",
        year_params,
    ).fetchall():
        by_type[row["type"]] = row["c"]

    by_genre: dict = {}
    for row in conn.execute(
        f"SELECT genre, COUNT(*) AS c FROM shows WHERE genre IS NOT NULL {year_clause} GROUP BY genre ORDER BY c DESC",
        year_params,
    ).fetchall():
        by_genre[row["genre"]] = row["c"]

    by_platform: dict = {}
    for row in conn.execute(
        f"SELECT platform, COUNT(*) AS c FROM shows WHERE platform IS NOT NULL {year_clause} GROUP BY platform ORDER BY c DESC",
        year_params,
    ).fetchall():
        by_platform[row["platform"]] = row["c"]

    avg_row = conn.execute(
        f"SELECT ROUND(AVG(rating_mf),1) FROM shows WHERE rating_mf IS NOT NULL {year_clause}",
        year_params,
    ).fetchone()
    avg_rating_mf = avg_row[0] if avg_row else None

    top_rated = [
        {"id": r["id"], "title": r["title"], "type": r["type"], "rating_mf": r["rating_mf"]}
        for r in conn.execute(
            f"SELECT id, title, type, rating_mf FROM shows "
            f"WHERE rating_mf IS NOT NULL {year_clause} ORDER BY rating_mf DESC LIMIT 10",
            year_params,
        ).fetchall()
    ]

    return ShowStats(
        total=total,
        by_year=by_year,
        by_type=by_type,
        by_genre=by_genre,
        by_platform=by_platform,
        avg_rating_mf=avg_rating_mf,
        top_rated=top_rated,
    )


@router.get("", response_model=list[ShowOut])
def list_shows(
    year: Optional[int] = Query(None),
    date: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    conn: DB = None,
):
    _ensure_table(conn)
    clauses, params = [], []
    if date:
        clauses.append("date_watched=?")
        params.append(date)
    elif year:
        clauses.append("substr(date_watched,1,4)=?")
        params.append(str(year))
    if type:
        clauses.append("type=?")
        params.append(type)
    if genre:
        clauses.append("genre LIKE ?")
        params.append(f"%{genre}%")
    if platform:
        clauses.append("platform=?")
        params.append(platform)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM shows {where} ORDER BY date_watched DESC NULLS LAST",
        params,
    ).fetchall()
    return [_row_to_show(r) for r in rows]


@router.get("/{show_id}", response_model=ShowOut)
def get_show(show_id: int, conn: DB = None):
    _ensure_table(conn)
    row = conn.execute("SELECT * FROM shows WHERE id=?", (show_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Show not found")
    return _row_to_show(row)


@router.post("", response_model=ShowOut, status_code=201)
def create_show(body: ShowIn, conn: DB = None):
    _ensure_table(conn)
    cur = conn.execute(
        """INSERT INTO shows
            (title, date_watched, type, genre, platform,
             companions, rating_mf, rating_ad, notes)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (body.title, body.date_watched, body.type, body.genre, body.platform,
         body.companions, body.rating_mf, body.rating_ad, body.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM shows WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row_to_show(row)


@router.patch("/{show_id}", response_model=ShowOut)
def update_show(show_id: int, body: ShowPatch, conn: DB = None):
    _ensure_table(conn)
    existing = conn.execute("SELECT * FROM shows WHERE id=?", (show_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Show not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return _row_to_show(existing)
    set_clause = ", ".join(f"{k}=?" for k in updates) + ", updated_at=datetime('now')"
    conn.execute(
        f"UPDATE shows SET {set_clause} WHERE id=?",
        [*updates.values(), show_id],
    )
    conn.commit()
    row = conn.execute("SELECT * FROM shows WHERE id=?", (show_id,)).fetchone()
    return _row_to_show(row)


@router.delete("/{show_id}", status_code=204)
def delete_show(show_id: int, conn: DB = None):
    _ensure_table(conn)
    conn.execute("DELETE FROM shows WHERE id=?", (show_id,))
    conn.commit()
