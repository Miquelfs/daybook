"""
Books insights: aggregated reading statistics derived from the books table.
All functions accept a sqlite3 Connection and return plain dicts/lists.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from sqlite3 import Connection


def books_per_year(conn: Connection) -> dict[str, int]:
    rows = conn.execute(
        "SELECT substr(date_finished,1,4) as y, count(*) as n "
        "FROM books WHERE date_finished IS NOT NULL "
        "GROUP BY y ORDER BY y"
    ).fetchall()
    return {r["y"]: r["n"] for r in rows}


def pages_per_year(conn: Connection) -> dict[str, int]:
    rows = conn.execute(
        "SELECT substr(date_finished,1,4) as y, sum(pages) as p "
        "FROM books WHERE date_finished IS NOT NULL AND pages IS NOT NULL "
        "GROUP BY y ORDER BY y"
    ).fetchall()
    return {r["y"]: r["p"] for r in rows}


def genre_breakdown(conn: Connection, year: int | None = None) -> dict[str, int]:
    if year:
        rows = conn.execute(
            "SELECT genre, count(*) as n FROM books "
            "WHERE genre IS NOT NULL AND substr(date_finished,1,4)=? "
            "GROUP BY genre ORDER BY n DESC",
            (str(year),),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT genre, count(*) as n FROM books WHERE genre IS NOT NULL "
            "GROUP BY genre ORDER BY n DESC"
        ).fetchall()
    return {r["genre"]: r["n"] for r in rows}


def language_breakdown(conn: Connection, year: int | None = None) -> dict[str, int]:
    if year:
        rows = conn.execute(
            "SELECT language, count(*) as n FROM books "
            "WHERE language IS NOT NULL AND substr(date_finished,1,4)=? "
            "GROUP BY language ORDER BY n DESC",
            (str(year),),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT language, count(*) as n FROM books WHERE language IS NOT NULL "
            "GROUP BY language ORDER BY n DESC"
        ).fetchall()
    return {r["language"]: r["n"] for r in rows}


def top_authors(conn: Connection, limit: int = 5) -> list[dict]:
    rows = conn.execute(
        "SELECT author, count(*) as n, avg(rating) as avg_rating "
        "FROM books GROUP BY author ORDER BY n DESC, avg_rating DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [
        {"author": r["author"], "books": r["n"],
         "avg_rating": round(r["avg_rating"], 1) if r["avg_rating"] else None}
        for r in rows
    ]


def books_per_month(conn: Connection, year: int) -> dict[str, int]:
    """Return {YYYY-MM: count} for every month in the given year that has books."""
    rows = conn.execute(
        "SELECT substr(date_finished,1,7) as ym, count(*) as n "
        "FROM books WHERE date_finished IS NOT NULL AND substr(date_finished,1,4)=? "
        "GROUP BY ym ORDER BY ym",
        (str(year),),
    ).fetchall()
    return {r["ym"]: r["n"] for r in rows}


def current_year_progress(conn: Connection) -> dict:
    today = date.today()
    this_year = str(today.year)
    last_year = str(today.year - 1)

    # How far through the year are we? (day-of-year / 365)
    day_of_year = today.timetuple().tm_yday
    days_in_year = 366 if today.year % 4 == 0 else 365
    year_fraction = day_of_year / days_in_year

    def _fetch_year(y):
        r = conn.execute(
            "SELECT count(*) as books, sum(pages) as pages FROM books "
            "WHERE substr(date_finished,1,4)=?",
            (y,),
        ).fetchone()
        return r["books"] or 0, r["pages"] or 0

    def _fetch_up_to_same_point_last_year(y):
        """Count books finished in year y up to the same calendar day."""
        cutoff = f"{y}-{today.strftime('%m-%d')}"
        r = conn.execute(
            "SELECT count(*) as books, sum(pages) as pages FROM books "
            "WHERE substr(date_finished,1,4)=? AND date_finished<=?",
            (y, cutoff),
        ).fetchone()
        return r["books"] or 0, r["pages"] or 0

    this_books, this_pages = _fetch_year(this_year)
    last_books_same_point, last_pages_same_point = _fetch_up_to_same_point_last_year(last_year)

    books_delta_pct = (
        round((this_books - last_books_same_point) / last_books_same_point * 100, 1)
        if last_books_same_point else None
    )
    pages_delta_pct = (
        round((this_pages - last_pages_same_point) / last_pages_same_point * 100, 1)
        if last_pages_same_point else None
    )

    return {
        "year": this_year,
        "books": this_books,
        "pages": this_pages,
        "vs_last_year_books_pct": books_delta_pct,
        "vs_last_year_pages_pct": pages_delta_pct,
        "note": f"vs same point last year ({today.strftime('%b %-d')})",
    }


def reading_pace(conn: Connection) -> dict:
    """Average days between finishing books and current reading streak."""
    rows = conn.execute(
        "SELECT date_finished FROM books WHERE date_finished IS NOT NULL "
        "ORDER BY date_finished"
    ).fetchall()
    dates = [datetime.fromisoformat(r["date_finished"]).date() for r in rows]

    if len(dates) < 2:
        return {"avg_days_between_books": None, "total_books": len(dates)}

    gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
    avg_gap = round(sum(gaps) / len(gaps), 1)

    # streak: consecutive months with at least one book
    today = date.today()
    streak = 0
    ym = (today.year, today.month)
    date_set = {(d.year, d.month) for d in dates}
    while ym in date_set:
        streak += 1
        m = ym[1] - 1
        y = ym[0]
        if m == 0:
            m = 12
            y -= 1
        ym = (y, m)

    return {
        "avg_days_between_books": avg_gap,
        "monthly_streak": streak,
        "total_books": len(dates),
    }
