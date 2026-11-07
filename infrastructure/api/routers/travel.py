"""
Travel journal — moments of a trip, its story and its export (domains/travel/).

GET    /travel/story?start&end          the trip day by day: moments + route, cities, km, activities,
                                        restaurants, spend, mood, the plan's line, photo of the day
PUT    /travel/story?start&end          {summary?, cover_photo_id?} — the trip in a few lines, its cover
POST   /travel/moments                  {date, time? (HH:MM local), title?, story?, place?}
PATCH  /travel/moments/{id}             same fields; DELETE removes it with its photos
POST   /travel/moments/{id}/photos      multipart `file` — one photo into this moment
POST   /travel/photos                   multipart `file` + `date` — a photo that finds its own moment
                                        (EXIF time → where you were → same hour & place, or a new one)
PATCH  /travel/photos/{id}              {caption?, moment_id?, sort?}; DELETE removes the file too
GET    /travel/book?start&end           the trip as a printable HTML book (photos from the Pi)
GET    /travel/export?start&end         zip: index.html book + photos/ + route.gpx + trip.json

Moments are keyed by day, not by trip, so a moment logged on a planned trip is still there once
the nightly detection finds the real one (and the planned and detected pages show the same story).
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated, Iterator
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from domains.travel import book, journal, photos, place
from infrastructure.api.db import get_db

router = APIRouter(prefix="/travel", tags=["travel"])
DB = Annotated[sqlite3.Connection, Depends(get_db)]
_LOCATIONS_DB = Path(__file__).parents[2] / "db" / "locations.db"
MAX_DAYS = 120


def _tz() -> str:
    from infrastructure.db.usertime import current_tz
    return current_tz()


@contextmanager
def _loc() -> Iterator[sqlite3.Connection | None]:
    if not _LOCATIONS_DB.exists():
        yield None
        return
    c = sqlite3.connect(_LOCATIONS_DB, check_same_thread=False)
    try:
        yield c
    finally:
        c.close()


@contextmanager
def _money() -> Iterator[sqlite3.Connection | None]:
    try:
        from infrastructure.db.money_connection import get_money_connection
        c = get_money_connection()
    except Exception:
        yield None
        return
    try:
        yield c
    finally:
        c.close()


def _range(start: str, end: str) -> tuple[str, str]:
    try:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(422, "start and end must be YYYY-MM-DD")
    if e < s:
        s, e = e, s
    if (e - s).days > MAX_DAYS:
        raise HTTPException(422, f"a trip is at most {MAX_DAYS} days")
    return s.isoformat(), e.isoformat()


def _day_tz(loc: sqlite3.Connection | None, day: str) -> str:
    """The timezone you were in that day (first Overland fix), else where you are now."""
    if loc is not None:
        try:
            r = loc.execute("SELECT lat, lng FROM overland_locations WHERE date = ? ORDER BY recorded_at LIMIT 1",
                            (day,)).fetchone()
        except sqlite3.OperationalError:
            r = None
        if r:
            return place.tz_at(r[0], r[1], _tz()) or _tz()
    return _tz()


def _taken_at(loc: sqlite3.Connection | None, day: str, hhmm: str | None) -> str | None:
    """Local HH:MM on `day` → UTC. No time given and it's today → now."""
    if hhmm:
        try:
            h, m = (int(x) for x in hhmm.split(":")[:2])
            local = datetime.fromisoformat(day).replace(hour=h, minute=m, tzinfo=ZoneInfo(_day_tz(loc, day)))
        except (ValueError, KeyError):
            raise HTTPException(422, "time must be HH:MM")
        return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    now = datetime.now(ZoneInfo(_tz()))
    if now.date().isoformat() == day:
        return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def _moment_out(conn: sqlite3.Connection, moment_id: int) -> dict:
    m = journal.get_moment(conn, moment_id)
    if m is None:
        raise HTTPException(404, "Moment not found")
    return m


# ── Story ──────────────────────────────────────────────────────────────────────

def _story(conn: sqlite3.Connection, start: str, end: str) -> dict:
    with _loc() as loc, _money() as money:
        return journal.story(conn, loc, money, start, end, fallback_tz=_tz())


@router.get("/story")
def get_story(conn: DB, start: str = Query(...), end: str = Query(...)):
    s, e = _range(start, end)
    return _story(conn, s, e)


class StoryIn(BaseModel):
    summary: str | None = None
    cover_photo_id: int | None = None


@router.put("/story")
def put_story(body: StoryIn, conn: DB, start: str = Query(...), end: str = Query(...)):
    s, e = _range(start, end)
    fields = body.model_dump(exclude_unset=True)
    if "summary" in fields:
        fields["summary"] = (fields["summary"] or "").strip() or None
    journal.save_story(conn, s, e, fields)
    return {"status": "ok"}


# ── Moments ────────────────────────────────────────────────────────────────────

class MomentIn(BaseModel):
    date: str | None = None
    time: str | None = None          # HH:MM, local to where you were that day
    title: str | None = None
    story: str | None = None
    place: str | None = None


def _clean(body: MomentIn) -> dict:
    f = body.model_dump(exclude_unset=True)
    for k in ("title", "story", "place"):
        if k in f:
            f[k] = (f[k] or "").strip() or None
    return f


@router.post("/moments")
def create_moment(body: MomentIn, conn: DB):
    f = _clean(body)
    if not f.get("date"):
        raise HTTPException(422, "date is required")
    _range(f["date"], f["date"])
    with _loc() as loc:
        f["taken_at"] = _taken_at(loc, f["date"], f.pop("time", None))
        mid = journal.create_moment(conn, f)
        place.resolve(conn, loc, mid, allow_network=True)
    return _moment_out(conn, mid)


@router.patch("/moments/{moment_id}")
def patch_moment(moment_id: int, body: MomentIn, conn: DB):
    cur = journal.get_moment(conn, moment_id)
    if cur is None:
        raise HTTPException(404, "Moment not found")
    f = _clean(body)
    with _loc() as loc:
        if "time" in f:
            day = f.get("date") or cur["date"]
            t = f.pop("time")
            f["taken_at"] = _taken_at(loc, day, t) if t else None
        elif f.get("date") and f["date"] != cur["date"] and cur["taken_at"]:
            # Same clock time on the new day.
            hhmm = place.local(cur["taken_at"], _day_tz(loc, cur["date"])).strftime("%H:%M")
            f["taken_at"] = _taken_at(loc, f["date"], hhmm)
        journal.update_moment(conn, moment_id, f)
        place.resolve(conn, loc, moment_id, allow_network=True)
    return _moment_out(conn, moment_id)


@router.delete("/moments/{moment_id}", status_code=204)
def delete_moment(moment_id: int, conn: DB):
    photos.remove(journal.delete_moment(conn, moment_id))


# ── Photos ─────────────────────────────────────────────────────────────────────

def _read(file: UploadFile) -> dict:
    content = file.file.read()
    try:
        return photos.store(content, fallback_tz=_tz())
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/moments/{moment_id}/photos")
def add_photo(moment_id: int, conn: DB, file: UploadFile = File(...)):
    if journal.get_moment(conn, moment_id) is None:
        raise HTTPException(404, "Moment not found")
    stored = _read(file)
    journal.add_photo(conn, moment_id, stored)
    with _loc() as loc:
        place.resolve(conn, loc, moment_id, allow_network=True)
    return _moment_out(conn, moment_id)


@router.post("/photos")
def drop_photo(conn: DB, file: UploadFile = File(...), date_: str = Form(..., alias="date")):
    _range(date_, date_)
    stored = _read(file)
    with _loc() as loc:
        mid = journal.place_photo(conn, loc, stored, fallback_date=date_, fallback_tz=_tz())
    return _moment_out(conn, mid)


class PhotoPatch(BaseModel):
    caption: str | None = None
    moment_id: int | None = None
    sort: int | None = None


@router.patch("/photos/{photo_id}")
def patch_photo(photo_id: int, body: PhotoPatch, conn: DB):
    f = body.model_dump(exclude_unset=True)
    if "caption" in f:
        f["caption"] = (f["caption"] or "").strip() or None
    if f.get("moment_id") is not None and journal.get_moment(conn, f["moment_id"]) is None:
        raise HTTPException(404, "Moment not found")
    journal.update_photo(conn, photo_id, f)
    return {"status": "ok"}


@router.delete("/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: int, conn: DB):
    photos.remove(journal.delete_photo(conn, photo_id))


# ── Keep it: the book and the export ──────────────────────────────────────────

@router.get("/book", response_class=HTMLResponse)
def get_book(conn: DB, start: str = Query(...), end: str = Query(...), name: str | None = None):
    s, e = _range(start, end)
    st = _story(conn, s, e)
    return HTMLResponse(book.render(st, lambda p: f"/api/photos/{p}", name))


@router.get("/export")
def export(background: BackgroundTasks, conn: DB, start: str = Query(...), end: str = Query(...),
           name: str | None = None):
    s, e = _range(start, end)
    with _loc() as loc, _money() as money:
        st = journal.story(conn, loc, money, s, e, fallback_tz=_tz())
        path = book.export_zip(st, loc, name)
    background.add_task(path.unlink, missing_ok=True)
    return FileResponse(path, media_type="application/zip", filename=book.filename(st, name),
                        background=background)
