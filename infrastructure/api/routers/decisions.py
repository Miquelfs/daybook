"""
Horizon 3 — Decision Log.

POST  /decisions           — log a new decision with predicted outcome + confidence
GET   /decisions           — list all decisions (optionally filtered by date or pending)
GET   /decisions/pending   — decisions whose horizon_date has passed, not yet resolved
GET   /decisions/{id}      — single decision
PATCH /decisions/{id}      — resolve a decision (actual_outcome + outcome_score)
DELETE /decisions/{id}     — remove a decision
"""

import sqlite3
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db import get_db
from infrastructure.api.models.decisions import DecisionCreate, DecisionOut, DecisionResolve

router = APIRouter(prefix="/decisions", tags=["decisions"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _row_to_out(row: sqlite3.Row) -> DecisionOut:
    return DecisionOut(
        id=row["id"],
        date=row["date"],
        description=row["description"],
        expected_outcome=row["expected_outcome"],
        confidence=row["confidence"],
        horizon_date=row["horizon_date"],
        actual_outcome=row["actual_outcome"],
        outcome_score=row["outcome_score"],
        created_at=row["created_at"],
        resolved_at=row["resolved_at"],
    )


@router.post("", response_model=DecisionOut, status_code=201)
def create_decision(body: DecisionCreate, conn: DB):
    try:
        date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    if body.horizon_date:
        try:
            date.fromisoformat(body.horizon_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="horizon_date must be YYYY-MM-DD")

    decision_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO decisions (id, date, description, expected_outcome, confidence, horizon_date)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (decision_id, body.date, body.description, body.expected_outcome, body.confidence, body.horizon_date),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
    return _row_to_out(row)


@router.get("", response_model=list[DecisionOut])
def list_decisions(
    conn: DB,
    day: str | None = Query(None, description="Filter by date YYYY-MM-DD"),
    unresolved: bool = Query(False, description="Only show decisions without actual_outcome"),
):
    if day:
        try:
            date.fromisoformat(day)
        except ValueError:
            raise HTTPException(status_code=422, detail="day must be YYYY-MM-DD")
        rows = conn.execute(
            "SELECT * FROM decisions WHERE date=? ORDER BY created_at DESC", (day,)
        ).fetchall()
    elif unresolved:
        rows = conn.execute(
            "SELECT * FROM decisions WHERE actual_outcome IS NULL ORDER BY horizon_date ASC, created_at DESC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM decisions ORDER BY created_at DESC"
        ).fetchall()
    return [_row_to_out(r) for r in rows]


@router.get("/pending", response_model=list[DecisionOut])
def pending_decisions(conn: DB):
    today = date.today().isoformat()
    rows = conn.execute(
        """
        SELECT * FROM decisions
        WHERE actual_outcome IS NULL
          AND horizon_date IS NOT NULL
          AND horizon_date <= ?
        ORDER BY horizon_date ASC
        """,
        (today,),
    ).fetchall()
    return [_row_to_out(r) for r in rows]


@router.get("/{decision_id}", response_model=DecisionOut)
def get_decision(decision_id: str, conn: DB):
    row = conn.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    return _row_to_out(row)


@router.patch("/{decision_id}", response_model=DecisionOut)
def resolve_decision(decision_id: str, body: DecisionResolve, conn: DB):
    row = conn.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Decision not found")

    conn.execute(
        """
        UPDATE decisions
        SET actual_outcome = ?,
            outcome_score  = ?,
            resolved_at    = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
        """,
        (body.actual_outcome, body.outcome_score, decision_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
    return _row_to_out(row)


@router.delete("/{decision_id}", status_code=204)
def delete_decision(decision_id: str, conn: DB):
    row = conn.execute("SELECT id FROM decisions WHERE id=?", (decision_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    conn.execute("DELETE FROM decisions WHERE id=?", (decision_id,))
    conn.commit()
