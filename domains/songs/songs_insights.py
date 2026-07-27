"""Song-of-the-day analytics — pure SQL over the songs table in daybook.db."""

import sqlite3
from datetime import date as _date


def songs_per_year(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        "SELECT substr(date,1,4) AS y, COUNT(*) AS n FROM songs GROUP BY y ORDER BY y"
    ).fetchall()
    return {r["y"]: r["n"] for r in rows}


def songs_per_month(conn: sqlite3.Connection, year: int) -> dict:
    rows = conn.execute(
        "SELECT substr(date,1,7) AS m, COUNT(*) AS n FROM songs WHERE substr(date,1,4)=? GROUP BY m ORDER BY m",
        (str(year),),
    ).fetchall()
    return {r["m"]: r["n"] for r in rows}


def top_artists(conn: sqlite3.Connection, year: int | None = None, limit: int = 8) -> list:
    clause, params = "", []
    if year:
        clause = "WHERE substr(date,1,4)=?"
        params.append(str(year))
    rows = conn.execute(
        f"""SELECT artist, COUNT(*) AS songs FROM songs
            {clause} {'AND' if year else 'WHERE'} artist IS NOT NULL AND TRIM(artist) != ''
            GROUP BY artist ORDER BY songs DESC, artist LIMIT ?""",
        (*params, limit),
    ).fetchall()
    return [{"artist": r["artist"], "songs": r["songs"]} for r in rows]


def current_year_progress(conn: sqlite3.Connection) -> dict:
    year = str(_date.today().year)
    row = conn.execute(
        """SELECT COUNT(*) AS songs,
                  COUNT(DISTINCT artist) AS artists,
                  COUNT(DISTINCT date) AS days,
                  SUM(CASE WHEN url IS NOT NULL AND TRIM(url) != '' THEN 1 ELSE 0 END) AS with_links
           FROM songs WHERE substr(date,1,4)=?""",
        (year,),
    ).fetchone()
    return {
        "year": year,
        "songs": row["songs"] or 0,
        "distinct_artists": row["artists"] or 0,
        "days_covered": row["days"] or 0,
        "with_links": row["with_links"] or 0,
    }
