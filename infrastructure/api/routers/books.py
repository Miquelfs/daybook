"""Books API router — reading log."""

import sqlite3
import threading
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.books import BookIn, BookOut, BookPatch, BooksStats
from domains.books.cover_fetch import fetch_cover_url
from domains.books.books_insights import (
    books_per_year,
    books_per_month,
    pages_per_year,
    genre_breakdown,
    language_breakdown,
    top_authors,
    current_year_progress,
    reading_pace,
)

router = APIRouter(prefix="/books", tags=["books"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _row_to_book(row: sqlite3.Row) -> BookOut:
    return BookOut(
        id=row["id"],
        title=row["title"],
        author=row["author"],
        date_finished=row["date_finished"],
        genre=row["genre"],
        language=row["language"],
        location=row["location"],
        ownership=row["ownership"],
        pages=row["pages"],
        rating=row["rating"],
        notes=row["notes"],
        gift_from=row["gift_from"],
        cover_url=row["cover_url"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/stats", response_model=BooksStats)
def get_stats(year: Optional[int] = Query(None), conn: DB = None):
    from datetime import date as _date
    month_year = year or _date.today().year
    return BooksStats(
        books_per_year=books_per_year(conn),
        pages_per_year=pages_per_year(conn),
        books_per_month=books_per_month(conn, month_year),
        genre_breakdown=genre_breakdown(conn, year),
        language_breakdown=language_breakdown(conn, year),
        top_authors=top_authors(conn),
        current_year=current_year_progress(conn),
        reading_pace=reading_pace(conn),
    )


@router.get("", response_model=list[BookOut])
def list_books(
    year: Optional[int] = Query(None),
    genre: Optional[str] = Query(None),
    author: Optional[str] = Query(None),
    conn: DB = None,
):
    clauses, params = [], []
    if year:
        clauses.append("substr(date_finished,1,4)=?")
        params.append(str(year))
    if genre:
        clauses.append("genre=?")
        params.append(genre)
    if author:
        clauses.append("author LIKE ?")
        params.append(f"%{author}%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM books {where} ORDER BY date_finished DESC",
        params,
    ).fetchall()
    return [_row_to_book(r) for r in rows]


@router.get("/{book_id}", response_model=BookOut)
def get_book(book_id: int, conn: DB):
    row = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Book not found")
    return _row_to_book(row)


def _bg_fetch_cover(book_id: int, title: str, author: str) -> None:
    """Fetch a cover URL in a background thread and write it to the DB."""
    url = fetch_cover_url(title, author)
    if not url:
        return
    from infrastructure.db.connection import get_connection
    conn = get_connection()
    conn.execute(
        "UPDATE books SET cover_url=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
        (url, book_id),
    )
    conn.commit()
    conn.close()


@router.post("", response_model=BookOut, status_code=201)
def create_book(body: BookIn, conn: DB):
    cur = conn.execute(
        """INSERT INTO books
            (title, author, date_finished, genre, language, location,
             ownership, pages, rating, notes, gift_from)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (body.title, body.author, body.date_finished, body.genre, body.language,
         body.location, body.ownership, body.pages, body.rating, body.notes,
         body.gift_from),
    )
    conn.commit()
    book_id = cur.lastrowid
    row = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()

    # Kick off cover fetch without blocking the response
    threading.Thread(
        target=_bg_fetch_cover,
        args=(book_id, body.title, body.author),
        daemon=True,
    ).start()

    return _row_to_book(row)


@router.patch("/{book_id}", response_model=BookOut)
def update_book(book_id: int, body: BookPatch, conn: DB):
    existing = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Book not found")

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not updates:
        return _row_to_book(existing)

    set_clause = ", ".join(f"{k}=?" for k in updates)
    set_clause += ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE books SET {set_clause} WHERE id=?",
        [*updates.values(), book_id],
    )
    conn.commit()
    row = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
    return _row_to_book(row)


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, conn: DB):
    conn.execute("DELETE FROM books WHERE id=?", (book_id,))
    conn.commit()
