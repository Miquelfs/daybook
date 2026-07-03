"""Injury tracking — body zone pain log."""

import sqlite3
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.injury import InjuryCreate, InjuryOut, InjuryPatch

router = APIRouter(prefix="/injuries", tags=["injuries"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _row_to_out(row: sqlite3.Row) -> InjuryOut:
    return InjuryOut(
        id=row["id"],
        zone=row["zone"],
        side=row["side"],
        pain_scale=row["pain_scale"],
        status=row["status"],
        onset_date=row["onset_date"],
        resolved_date=row["resolved_date"],
        notes=row["notes"],
        mechanism=row["mechanism"],
        activity_type=row["activity_type"],
        activity_id=row["activity_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[InjuryOut])
def list_injuries(
    conn: DB,
    status: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    activity_id: Optional[str] = Query(None),
):
    clauses, params = [], []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if zone:
        clauses.append("zone = ?")
        params.append(zone)
    if since:
        clauses.append("onset_date >= ?")
        params.append(since)
    if activity_id:
        clauses.append("activity_id = ?")
        params.append(activity_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM injuries {where} ORDER BY onset_date DESC, id DESC", params
    ).fetchall()
    return [_row_to_out(r) for r in rows]


@router.get("/recent-activities")
def recent_activities(conn: DB, limit: int = Query(30, le=100)):
    """Last N activities — used by the injury form activity picker."""
    rows = conn.execute(
        """
        SELECT id, name, activity_type, start_time, distance_meters
        FROM activities
        ORDER BY start_time DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/active-summary")
def active_summary(conn: DB):
    """Active + recovering injuries — minimal payload for the body diagram."""
    rows = conn.execute(
        """
        SELECT id, zone, side, pain_scale, status, onset_date
        FROM injuries
        WHERE status IN ('active', 'recovering')
        ORDER BY pain_scale DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("", response_model=InjuryOut, status_code=201)
def create_injury(body: InjuryCreate, conn: DB):
    try:
        date.fromisoformat(body.onset_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="onset_date must be YYYY-MM-DD")
    cur = conn.execute(
        """
        INSERT INTO injuries
            (zone, side, pain_scale, status, onset_date, resolved_date,
             notes, mechanism, activity_type, activity_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            body.zone, body.side, body.pain_scale, body.status, body.onset_date,
            body.resolved_date, body.notes, body.mechanism,
            body.activity_type, body.activity_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM injuries WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row_to_out(row)


@router.patch("/{injury_id}", response_model=InjuryOut)
def update_injury(injury_id: int, body: InjuryPatch, conn: DB):
    existing = conn.execute("SELECT * FROM injuries WHERE id=?", (injury_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Injury not found")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _row_to_out(existing)
    set_clause = ", ".join(f"{k}=?" for k in updates)
    set_clause += ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE injuries SET {set_clause} WHERE id=?",
        [*updates.values(), injury_id],
    )
    conn.commit()
    row = conn.execute("SELECT * FROM injuries WHERE id=?", (injury_id,)).fetchone()
    return _row_to_out(row)


@router.delete("/{injury_id}", status_code=204)
def delete_injury(injury_id: int, conn: DB):
    row = conn.execute("SELECT id FROM injuries WHERE id=?", (injury_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Injury not found")
    conn.execute("DELETE FROM injuries WHERE id=?", (injury_id,))
    conn.commit()
