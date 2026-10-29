"""
Learning plans — a curriculum in weeks (the robot-builder roadmap), followed on Today.

GET    /learning/plans              — every plan with where it stands this week
GET    /learning/plans/{id}         — phases + items (with state), hours per week, totals
PATCH  /learning/plans/{id}         — start date, weekly hours target, status
PATCH  /learning/phases/{id}        — pass / re-open a gate
POST   /learning/items              — add an item (DELETE /learning/items/{id})
PATCH  /learning/items/{id}         — edit, move to another week, done / skipped / todo
GET    /learning/day/{date}         — the Today lane: this week's items, time logged
POST   /learning/logs               — log study time (DELETE /learning/logs/{id})
"""

import sqlite3
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from domains.learning import plan as lp
from infrastructure.api.db import get_db
from infrastructure.api.models.learning import (
    LearningItemIn, LearningItemPatch, LearningLogIn, LearningPhasePatch, LearningPlanPatch,
)

router = APIRouter(prefix="/learning", tags=["learning"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _day(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(422, f"{field} must be YYYY-MM-DD")


def _today(today: str | None) -> date:
    return _day(today, "today") if today else date.today()


def _one(conn, table: str, id_: int) -> dict:
    r = conn.execute(f"SELECT * FROM {table} WHERE id=?", (id_,)).fetchone()
    if not r:
        raise HTTPException(404, "not found")
    return dict(r)


def _check_item(fields: dict) -> None:
    if "kind" in fields and fields["kind"] not in lp.KINDS:
        raise HTTPException(422, f"kind must be one of {lp.KINDS}")
    if "tier" in fields and fields["tier"] not in lp.TIERS:
        raise HTTPException(422, f"tier must be one of {lp.TIERS}")
    if "status" in fields and fields["status"] not in lp.ITEM_STATUSES:
        raise HTTPException(422, f"status must be one of {lp.ITEM_STATUSES}")
    if "title" in fields and not (fields["title"] or "").strip():
        raise HTTPException(422, "title can't be empty")


def _update(conn, table: str, id_: int, fields: dict) -> None:
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE {table} SET {sets} WHERE id=?", (*fields.values(), id_))
        conn.commit()


@router.get("/plans")
def list_plans(conn: DB, today: str | None = Query(None)):
    d = _today(today)
    plans = [dict(r) for r in conn.execute("SELECT id FROM learning_plans ORDER BY status != 'active', id")]
    return [lp.detail(conn, p["id"], d) for p in plans]


@router.get("/plans/{plan_id}")
def plan_detail(plan_id: int, conn: DB, today: str | None = Query(None)):
    out = lp.detail(conn, plan_id, _today(today))
    if out is None:
        raise HTTPException(404, "not found")
    return out


@router.patch("/plans/{plan_id}")
def update_plan(plan_id: int, body: LearningPlanPatch, conn: DB):
    _one(conn, "learning_plans", plan_id)
    fields = body.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] not in lp.PLAN_STATUSES:
        raise HTTPException(422, f"status must be one of {lp.PLAN_STATUSES}")
    if "start_date" in fields:
        d = _day(fields["start_date"], "start_date")
        fields["start_date"] = (d - timedelta(days=d.weekday())).isoformat()     # weeks start Monday
    _update(conn, "learning_plans", plan_id, fields)
    return lp.detail(conn, plan_id, date.today())


@router.patch("/phases/{phase_id}")
def update_phase(phase_id: int, body: LearningPhasePatch, conn: DB):
    _one(conn, "learning_phases", phase_id)
    fields = body.model_dump(exclude_unset=True)
    if fields.get("gate_passed_at"):
        _day(fields["gate_passed_at"], "gate_passed_at")
    _update(conn, "learning_phases", phase_id, fields)
    return _one(conn, "learning_phases", phase_id)


@router.post("/items", status_code=201)
def create_item(body: LearningItemIn, conn: DB):
    _one(conn, "learning_plans", body.plan_id)
    fields = body.model_dump()
    _check_item(fields)
    fields["title"] = fields["title"].strip()
    if fields["phase_id"] is None and fields["week"] is not None:
        phases = [dict(r) for r in conn.execute("SELECT * FROM learning_phases WHERE plan_id=? ORDER BY ord",
                                                (body.plan_id,))]
        ph = lp.phase_for(phases, fields["week"])
        fields["phase_id"] = ph["id"] if ph else None
    fields["ord"] = conn.execute("SELECT COALESCE(MAX(ord), 0) + 1 FROM learning_items WHERE plan_id=?",
                                 (body.plan_id,)).fetchone()[0]
    cols = ", ".join(fields)
    cur = conn.execute(f"INSERT INTO learning_items ({cols}) VALUES ({', '.join('?' * len(fields))})",
                       tuple(fields.values()))
    conn.commit()
    return _one(conn, "learning_items", cur.lastrowid)


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: LearningItemPatch, conn: DB):
    _one(conn, "learning_items", item_id)
    fields = body.model_dump(exclude_unset=True)
    _check_item(fields)
    if "status" in fields:
        if fields["status"] == "done":
            fields["done_at"] = _day(fields.get("done_at") or date.today().isoformat(), "done_at").isoformat()
        else:
            fields["done_at"] = None
    elif "done_at" in fields:
        raise HTTPException(422, "done_at goes with status")
    _update(conn, "learning_items", item_id, fields)
    return _one(conn, "learning_items", item_id)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, conn: DB):
    conn.execute("DELETE FROM learning_items WHERE id=?", (item_id,))
    conn.commit()


@router.get("/day/{day}")
def learning_day(day: str, conn: DB):
    return lp.day(conn, _day(day, "date"))


@router.post("/logs", status_code=201)
def create_log(body: LearningLogIn, conn: DB):
    _one(conn, "learning_plans", body.plan_id)
    _day(body.date, "date")
    if body.item_id is not None:
        _one(conn, "learning_items", body.item_id)
    cur = conn.execute("INSERT INTO learning_logs (plan_id, item_id, date, minutes, note) VALUES (?,?,?,?,?)",
                       (body.plan_id, body.item_id, body.date, body.minutes, (body.note or "").strip() or None))
    conn.commit()
    return _one(conn, "learning_logs", cur.lastrowid)


@router.delete("/logs/{log_id}", status_code=204)
def delete_log(log_id: int, conn: DB):
    conn.execute("DELETE FROM learning_logs WHERE id=?", (log_id,))
    conn.commit()
