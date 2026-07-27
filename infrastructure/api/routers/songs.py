"""Songs API router — the "song of the day" log + year-end playlist export."""

import csv as _csv
import io
import sqlite3
from datetime import date as _date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from infrastructure.api.db import get_db
from infrastructure.api.models.songs import SongIn, SongOut, SongPatch, SongsStats
from domains.songs.songs_insights import (
    songs_per_year,
    songs_per_month,
    top_artists,
    current_year_progress,
)

router = APIRouter(prefix="/songs", tags=["songs"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _row_to_song(row: sqlite3.Row) -> SongOut:
    return SongOut(
        id=row["id"],
        date=row["date"],
        title=row["title"],
        artist=row["artist"],
        album=row["album"],
        url=row["url"],
        rating=row["rating"],
        mood=row["mood"],
        notes=row["notes"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/stats", response_model=SongsStats)
def get_stats(year: Optional[int] = Query(None), conn: DB = None):
    stat_year = year or _date.today().year
    totals = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN url IS NOT NULL AND TRIM(url) != '' THEN 1 ELSE 0 END) AS with_links
           FROM songs"""
    ).fetchone()
    return SongsStats(
        songs_per_year=songs_per_year(conn),
        songs_per_month=songs_per_month(conn, stat_year),
        top_artists=top_artists(conn, year),
        current_year=current_year_progress(conn),
        total_songs=totals["total"] or 0,
        total_with_links=totals["with_links"] or 0,
    )


@router.get("/export")
def export_playlist(
    year: Optional[int] = Query(None, description="Restrict to a single year (YYYY)"),
    format: str = Query("m3u", pattern="^(m3u|csv)$"),
    conn: DB = None,
):
    """Download the year's songs as a playlist.

    - m3u: importable into most players; only songs that have a URL are included.
    - csv: full log (date, title, artist, album, url, rating, mood, notes).
    """
    clause, params = "", []
    if year:
        clause = "WHERE substr(date,1,4)=?"
        params.append(str(year))
    rows = conn.execute(
        f"SELECT * FROM songs {clause} ORDER BY date ASC, id ASC", params
    ).fetchall()

    label = str(year) if year else "all-time"

    if format == "csv":
        def gen_csv():
            buf = io.StringIO()
            w = _csv.writer(buf)
            w.writerow(["date", "title", "artist", "album", "url", "rating", "mood", "notes"])
            for r in rows:
                w.writerow([r["date"], r["title"], r["artist"] or "", r["album"] or "",
                            r["url"] or "", r["rating"] or "", r["mood"] or "", r["notes"] or ""])
            yield buf.getvalue()

        return StreamingResponse(
            gen_csv(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=songs_{label}.csv"},
        )

    # M3U — playlist of the songs that carry a URL.
    def gen_m3u():
        buf = io.StringIO()
        buf.write("#EXTM3U\n")
        for r in rows:
            if not (r["url"] and r["url"].strip()):
                continue
            artist = (r["artist"] or "").strip()
            display = f"{artist} - {r['title']}" if artist else r["title"]
            buf.write(f"#EXTINF:-1,{display}\n{r['url'].strip()}\n")
        yield buf.getvalue()

    return StreamingResponse(
        gen_m3u(),
        media_type="audio/x-mpegurl",
        headers={"Content-Disposition": f"attachment; filename=songs_{label}.m3u"},
    )


@router.get("", response_model=list[SongOut])
def list_songs(
    year: Optional[int] = Query(None),
    date: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
    conn: DB = None,
):
    clauses, params = [], []
    if date:
        clauses.append("date=?")
        params.append(date)
    elif year:
        clauses.append("substr(date,1,4)=?")
        params.append(str(year))
    if artist:
        clauses.append("artist LIKE ?")
        params.append(f"%{artist}%")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM songs {where} ORDER BY date DESC, id DESC", params
    ).fetchall()
    return [_row_to_song(r) for r in rows]


@router.get("/{song_id}", response_model=SongOut)
def get_song(song_id: int, conn: DB):
    row = conn.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Song not found")
    return _row_to_song(row)


@router.post("", response_model=SongOut, status_code=201)
def create_song(body: SongIn, conn: DB):
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Title is required")
    cur = conn.execute(
        """INSERT INTO songs (date, title, artist, album, url, rating, mood, notes)
           VALUES (?,?,?,?,?,?,?,?)""",
        (body.date, body.title.strip(), body.artist, body.album, body.url,
         body.rating, body.mood, body.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM songs WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row_to_song(row)


@router.patch("/{song_id}", response_model=SongOut)
def update_song(song_id: int, body: SongPatch, conn: DB):
    existing = conn.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Song not found")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _row_to_song(existing)

    set_clause = ", ".join(f"{k}=?" for k in updates)
    set_clause += ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE songs SET {set_clause} WHERE id=?", [*updates.values(), song_id]
    )
    conn.commit()
    row = conn.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
    return _row_to_song(row)


@router.delete("/{song_id}", status_code=204)
def delete_song(song_id: int, conn: DB):
    conn.execute("DELETE FROM songs WHERE id=?", (song_id,))
    conn.commit()
