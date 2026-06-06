"""
Life-in-Weeks API router.

Endpoints:
  GET/POST/PATCH  /life/profile
  GET/POST        /life/periods
  GET/PATCH/DELETE /life/periods/{id}
  GET/POST        /life/events
  GET/PATCH/DELETE /life/events/{id}
  POST            /life/events/{id}/photo
  GET             /life/grid
"""

import io
import sqlite3
from datetime import date as date_cls, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from infrastructure.api.db import get_db
from infrastructure.api.models.life import (
    AutoCappedPeriod,
    EventIn, EventOut, EventPatch,
    GridResponse, PeriodCreateResponse,
    PeriodIn, PeriodOut, PeriodPatch,
    ProfileIn, ProfileOut,
    WeekCell,
)

router = APIRouter(prefix="/life", tags=["life"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

PHOTOS_DIR = Path(__file__).parents[3] / "data" / "photos" / "life_events"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _row_to_period(row: sqlite3.Row) -> PeriodOut:
    return PeriodOut(
        id=row["id"],
        label=row["label"],
        category=row["category"],
        layer=row["layer"],
        color=row["color"],
        start_date=row["start_date"],
        end_date=row["end_date"],
        notes=row["notes"],
        sort_order=row["sort_order"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_event(row: sqlite3.Row) -> EventOut:
    photo_path = row["photo_path"]
    photo_url = f"/photos/life_events/{photo_path.split('/')[-1]}" if photo_path else None
    return EventOut(
        id=row["id"],
        event_date=row["event_date"],
        label=row["label"],
        type=row["type"],
        notes=row["notes"],
        photo_url=photo_url,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _auto_cap_overlaps(
    conn: sqlite3.Connection,
    category: str,
    layer: str,
    start_date: str,
    end_date: str | None,
    exclude_id: int | None = None,
) -> list[AutoCappedPeriod]:
    """
    Find periods of the same category+layer that overlap [start_date, end_date].
    Different categories (e.g. location vs work) can freely coexist — only
    same-category overlaps are auto-capped.
    """
    effective_end = end_date or "9999-12-31"
    params: list = [category, layer, effective_end, start_date]
    exclude_clause = ""
    if exclude_id is not None:
        exclude_clause = " AND id != ?"
        params.append(exclude_id)

    overlaps = conn.execute(
        f"""SELECT id, label, end_date FROM life_periods
            WHERE category = ?
              AND layer = ?
              AND start_date <= ?
              AND (end_date IS NULL OR end_date >= ?)
              {exclude_clause}
            ORDER BY start_date""",
        params,
    ).fetchall()

    if not overlaps:
        return []

    new_end = (date_cls.fromisoformat(start_date) - timedelta(days=1)).isoformat()
    capped: list[AutoCappedPeriod] = []
    for row in overlaps:
        conn.execute(
            "UPDATE life_periods SET end_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
            (new_end, row["id"]),
        )
        capped.append(AutoCappedPeriod(
            id=row["id"],
            label=row["label"],
            old_end_date=row["end_date"],
            new_end_date=new_end,
        ))
    return capped


def _week_start_for_age(birthdate: date_cls, age_years: int, week_col: int) -> date_cls:
    """Return the start date of (row=age_years, col=week_col) in the birthday-anchored grid."""
    year_start = date_cls(birthdate.year + age_years, birthdate.month, birthdate.day)
    return year_start + timedelta(weeks=week_col - 1)


# ─── Profile ──────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=ProfileOut)
def get_profile(conn: DB):
    row = conn.execute("SELECT * FROM user_profile WHERE id = 1").fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not set. POST /life/profile first.")
    return ProfileOut(
        birthdate=row["birthdate"],
        display_name=row["display_name"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("/profile", response_model=ProfileOut, status_code=201)
def upsert_profile(body: ProfileIn, conn: DB):
    # Validate birthdate is a real date
    try:
        date_cls.fromisoformat(body.birthdate)
    except ValueError:
        raise HTTPException(status_code=422, detail="birthdate must be a valid YYYY-MM-DD date")

    conn.execute(
        """INSERT INTO user_profile (id, birthdate, display_name,
               updated_at)
           VALUES (1, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
           ON CONFLICT(id) DO UPDATE SET
               birthdate    = excluded.birthdate,
               display_name = excluded.display_name,
               updated_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
        (body.birthdate, body.display_name),
    )
    conn.commit()
    return get_profile(conn)


# ─── Periods ──────────────────────────────────────────────────────────────────

@router.get("/periods", response_model=list[PeriodOut])
def list_periods(conn: DB):
    rows = conn.execute(
        "SELECT * FROM life_periods ORDER BY start_date, layer, sort_order"
    ).fetchall()
    return [_row_to_period(r) for r in rows]


@router.get("/periods/{period_id}", response_model=PeriodOut)
def get_period(period_id: int, conn: DB):
    row = conn.execute("SELECT * FROM life_periods WHERE id = ?", (period_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Period not found")
    return _row_to_period(row)


@router.post("/periods", response_model=PeriodCreateResponse, status_code=201)
def create_period(body: PeriodIn, conn: DB):
    try:
        start = date_cls.fromisoformat(body.start_date)
        if body.end_date:
            end = date_cls.fromisoformat(body.end_date)
            if end < start:
                raise HTTPException(status_code=422, detail="end_date must be >= start_date")
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date format")

    capped = _auto_cap_overlaps(conn, body.category, body.layer, body.start_date, body.end_date)

    cursor = conn.execute(
        """INSERT INTO life_periods (label, category, layer, color, start_date, end_date, notes, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.label, body.category, body.layer, body.color,
         body.start_date, body.end_date, body.notes, body.sort_order),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM life_periods WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return PeriodCreateResponse(period=_row_to_period(row), auto_capped=capped)


@router.patch("/periods/{period_id}", response_model=PeriodCreateResponse)
def patch_period(period_id: int, patch: PeriodPatch, conn: DB):
    existing = conn.execute("SELECT * FROM life_periods WHERE id = ?", (period_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="Period not found")

    updates = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not updates:
        return PeriodCreateResponse(period=_row_to_period(existing))

    # Merge with existing values to run overlap check on the final state
    merged_layer = updates.get("layer", existing["layer"])
    merged_start = updates.get("start_date", existing["start_date"])
    merged_end = updates.get("end_date", existing["end_date"])

    if "start_date" in updates or "end_date" in updates or "layer" in updates:
        try:
            start = date_cls.fromisoformat(merged_start)
            if merged_end:
                end = date_cls.fromisoformat(merged_end)
                if end < start:
                    raise HTTPException(status_code=422, detail="end_date must be >= start_date")
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format")
        merged_category = updates.get("category", existing["category"])
        capped = _auto_cap_overlaps(conn, merged_category, merged_layer, merged_start, merged_end, exclude_id=period_id)
    else:
        capped = []

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    set_clause += ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE life_periods SET {set_clause} WHERE id = ?",
        (*updates.values(), period_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM life_periods WHERE id = ?", (period_id,)).fetchone()
    return PeriodCreateResponse(period=_row_to_period(row), auto_capped=capped)


@router.delete("/periods/{period_id}", status_code=204)
def delete_period(period_id: int, conn: DB):
    result = conn.execute("DELETE FROM life_periods WHERE id = ?", (period_id,))
    conn.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Period not found")


# ─── Events ───────────────────────────────────────────────────────────────────

@router.get("/events/on-this-day", response_model=list[EventOut])
def events_on_this_day(date: str, conn: DB):
    """Return all events whose month-day matches the given YYYY-MM-DD date."""
    try:
        d = date_cls.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date")
    month_day = f"-{d.month:02d}-{d.day:02d}"
    rows = conn.execute(
        "SELECT * FROM life_events WHERE event_date LIKE ? ORDER BY event_date",
        (f"%{month_day}",),
    ).fetchall()
    return [_row_to_event(r) for r in rows]


@router.get("/events", response_model=list[EventOut])
def list_events(conn: DB):
    rows = conn.execute("SELECT * FROM life_events ORDER BY event_date").fetchall()
    return [_row_to_event(r) for r in rows]


@router.get("/events/{event_id}", response_model=EventOut)
def get_event(event_id: int, conn: DB):
    row = conn.execute("SELECT * FROM life_events WHERE id = ?", (event_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return _row_to_event(row)


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(body: EventIn, conn: DB):
    try:
        date_cls.fromisoformat(body.event_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid event_date")

    cursor = conn.execute(
        "INSERT INTO life_events (event_date, label, type, notes) VALUES (?, ?, ?, ?)",
        (body.event_date, body.label, body.type, body.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM life_events WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_event(row)


@router.patch("/events/{event_id}", response_model=EventOut)
def patch_event(event_id: int, patch: EventPatch, conn: DB):
    existing = conn.execute("SELECT * FROM life_events WHERE id = ?", (event_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="Event not found")

    updates = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not updates:
        return _row_to_event(existing)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    set_clause += ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE life_events SET {set_clause} WHERE id = ?",
        (*updates.values(), event_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM life_events WHERE id = ?", (event_id,)).fetchone()
    return _row_to_event(row)


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int, conn: DB):
    result = conn.execute("DELETE FROM life_events WHERE id = ?", (event_id,))
    conn.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Event not found")


@router.post("/events/{event_id}/photo")
def upload_event_photo(event_id: int, file: UploadFile, conn: DB):
    existing = conn.execute("SELECT id FROM life_events WHERE id = ?", (event_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="Event not found")

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        import pillow_heif
        import PIL.Image as Image
        from PIL import ImageOps
        pillow_heif.register_heif_opener()
        img = Image.open(io.BytesIO(content))
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        jpeg_bytes = buf.getvalue()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image conversion failed: {e}")

    filename = f"{event_id}.jpg"
    (PHOTOS_DIR / filename).write_bytes(jpeg_bytes)

    photo_path = f"life_events/{filename}"
    conn.execute(
        "UPDATE life_events SET photo_path = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
        (photo_path, event_id),
    )
    conn.commit()
    return JSONResponse({"photo_url": f"/photos/{photo_path}"})


# ─── Grid ─────────────────────────────────────────────────────────────────────

@router.get("/grid", response_model=GridResponse)
def get_grid(conn: DB):
    """
    Return the full 90×52 grid in a single pass.

    Algorithm:
    1. Fetch profile (need birthdate).
    2. Fetch all periods in one query.
    3. Fetch all events in one query.
    4. Build a period lookup: for each period, iterate the weeks it spans and
       assign it to the correct (row, col, layer) slot.
    5. Build an event lookup: map each event to its (row, col).
    6. Emit all 4680 cells (90 years × 52 weeks).
    """
    profile = conn.execute("SELECT * FROM user_profile WHERE id = 1").fetchone()
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not set. POST /life/profile first.")

    birthdate = date_cls.fromisoformat(profile["birthdate"])
    today = date_cls.today()

    # Load all periods once
    period_rows = conn.execute(
        "SELECT * FROM life_periods ORDER BY start_date, layer, sort_order"
    ).fetchall()
    periods = [_row_to_period(r) for r in period_rows]

    # Load all events once
    event_rows = conn.execute(
        "SELECT * FROM life_events ORDER BY event_date"
    ).fetchall()
    events = [_row_to_event(r) for r in event_rows]

    # Ongoing periods cap at current_week_start - 1 week (never bleed into current week).
    current_week_cap = today - timedelta(days=today.weekday() + 7)

    # Build period lookup: (row, col) -> list[PeriodOut]
    #
    # Instead of stepping week-by-week (which can skip cells when p_end lands
    # between two cursor steps), iterate every (age_year, week_col) cell and
    # test whether the period overlaps the cell's [week_start, week_end] window.
    # This is O(periods × 90 × 52) ≈ 4 680 × n_periods — fast enough for <200 periods.
    period_map: dict[tuple[int, int], list[PeriodOut]] = {}
    for p in periods:
        p_start = date_cls.fromisoformat(p.start_date)
        p_end   = date_cls.fromisoformat(p.end_date) if p.end_date else current_week_cap

        seen_cells: set[tuple[int, int]] = set()
        for age_years in range(90):
            year_start = date_cls(birthdate.year + age_years, birthdate.month, birthdate.day)
            year_end   = date_cls(birthdate.year + age_years + 1, birthdate.month, birthdate.day) - timedelta(days=1)

            # Quick reject: period doesn't touch this year at all
            if p_end < year_start or p_start > year_end:
                continue

            for week_col in range(1, 53):
                cell_start = year_start + timedelta(weeks=week_col - 1)
                cell_end   = cell_start + timedelta(days=6)

                # Period overlaps cell if they share at least one day
                if p_start <= cell_end and p_end >= cell_start:
                    key = (age_years, week_col)
                    if key not in seen_cells:
                        seen_cells.add(key)
                        period_map.setdefault(key, []).append(p)

    # Build event lookup: (row, col) -> list[EventOut]
    event_map: dict[tuple[int, int], list[EventOut]] = {}
    for e in events:
        ev_date = date_cls.fromisoformat(e.event_date)
        age_years = (ev_date - birthdate).days // 365
        if age_years < 0 or age_years > 89:
            continue
        year_start = date_cls(birthdate.year + age_years, birthdate.month, birthdate.day)
        days_into_year = (ev_date - year_start).days
        week_col = min(days_into_year // 7 + 1, 52)
        key = (age_years, week_col)
        event_map.setdefault(key, []).append(e)

    # Emit all cells
    cells: list[WeekCell] = []
    for age_years in range(90):
        year_start = date_cls(birthdate.year + age_years, birthdate.month, birthdate.day)
        for week_col in range(1, 53):
            week_start = year_start + timedelta(weeks=week_col - 1)
            week_end = week_start + timedelta(days=6)
            key2d = (age_years, week_col)
            cells.append(WeekCell(
                row=age_years,
                col=week_col,
                week_start=week_start.isoformat(),
                week_end=week_end.isoformat(),
                is_past=week_end < today,
                is_current=(week_start <= today <= week_end),
                periods=period_map.get(key2d, []),
                events=event_map.get(key2d, []),
            ))

    return GridResponse(
        birthdate=profile["birthdate"],
        today=today.isoformat(),
        cells=cells,
    )
