"""
Plan ahead — goals with automatic progress, tasks, notes that resurface,
birthdays, and a calendar feed of all of it.

GET    /goals                — goals with computed progress (?year=)
POST   /goals                — new goal
PATCH  /goals/{id}           — edit / mark done / drop
DELETE /goals/{id}
GET    /tasks                — ?status=open|done|all  &kind=task|note  &done_on=YYYY-MM-DD
POST   /tasks
PATCH  /tasks/{id}           — edit; done_at=null re-opens
POST   /tasks/{id}/complete  — done (a repeating task re-arms at its next date)
DELETE /tasks/{id}
GET    /birthdays            — everyone with a birthday, soonest first
GET    /agenda               — the Today strip: overdue / today / coming up / notes / birthdays / goals
GET    /calendar.ics         — subscribe in Calendar (webcal://…/calendar.ics)
"""

import sqlite3
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from domains.plans import agenda as agenda_mod
from domains.plans import goals as goals_mod
from domains.plans import ics as ics_mod
from infrastructure.api.db import get_db
from infrastructure.api.models.plans import (
    AgendaOut, BirthdayOut, GoalIn, GoalOut, GoalPatch, GoalsBrief,
    TaskComplete, TaskIn, TaskOut, TaskPatch,
)

router = APIRouter(tags=["plans"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

GOAL_STATUSES = ("active", "done", "dropped")


def _iso(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")


def _net_worth() -> float | None:
    """Same figure as Money → total net worth (holdings + liquid accounts).
    None if money.db can't be read — the goal then just shows no number."""
    from infrastructure.api.routers.money import portfolio_overview
    from infrastructure.db.money_connection import get_money_connection
    try:
        conn = get_money_connection()
        try:
            return portfolio_overview(conn).total_net_worth_eur
        finally:
            conn.close()
    except Exception:
        return None


def _goal_out(conn: sqlite3.Connection, goal_id: int) -> GoalOut:
    row = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return GoalOut(**goals_mod.progress(conn, dict(row), date.today(), _net_worth))


def _check_goal(fields: dict) -> None:
    if "metric" in fields and fields["metric"] not in goals_mod.METRICS:
        raise HTTPException(status_code=422, detail=f"metric must be one of {', '.join(goals_mod.METRICS)}")
    if fields.get("metric") == "tag_days" and not fields.get("metric_param"):
        raise HTTPException(status_code=422, detail="tag_days needs metric_param (a tag slug)")
    if "status" in fields and fields["status"] not in GOAL_STATUSES:
        raise HTTPException(status_code=422, detail="status must be active, done or dropped")
    if "title" in fields and not (fields["title"] or "").strip():
        raise HTTPException(status_code=422, detail="title cannot be empty")


def _check_task(fields: dict) -> None:
    if "kind" in fields and fields["kind"] not in agenda_mod.KINDS:
        raise HTTPException(status_code=422, detail="kind must be task or note")
    if fields.get("repeat") is not None and fields["repeat"] not in agenda_mod.REPEATS:
        raise HTTPException(status_code=422, detail="repeat must be weekly, monthly or yearly")
    if fields.get("repeat") and not fields.get("due_date", True):
        raise HTTPException(status_code=422, detail="a repeating task needs a due date")
    if "title" in fields and not (fields["title"] or "").strip():
        raise HTTPException(status_code=422, detail="title cannot be empty")


# ── Goals ────────────────────────────────────────────────────────────────────

@router.get("/goals", response_model=list[GoalOut])
def list_goals(conn: DB, year: int | None = Query(None)):
    return [GoalOut(**g) for g in goals_mod.list_with_progress(conn, date.today(), _net_worth, year)]


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalIn, conn: DB):
    fields = body.model_dump()
    _check_goal(fields)
    start = date.fromisoformat(_iso(body.start_date, "start_date") or date(date.today().year, 1, 1).isoformat())
    deadline = _iso(body.deadline, "deadline") or goals_mod.period_end(start).isoformat()
    if deadline < start.isoformat():
        raise HTTPException(status_code=422, detail="deadline is before start_date")
    cur = conn.execute(
        """INSERT INTO goals (title, emoji, area, priority, start_date, deadline, metric,
                              metric_param, target, baseline, current, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (body.title.strip(), body.emoji, body.area, body.priority, start.isoformat(), deadline,
         body.metric, body.metric_param, body.target, body.baseline, body.current, body.notes),
    )
    conn.commit()
    return _goal_out(conn, cur.lastrowid)


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalPatch, conn: DB):
    row = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    updates = body.model_dump(exclude_unset=True)
    _check_goal({**dict(row), **updates} if "metric" in updates or "metric_param" in updates else updates)
    for f in ("start_date", "deadline"):
        if f in updates:
            updates[f] = _iso(updates[f], f)
    if "status" in updates:
        updates["completed_at"] = date.today().isoformat() if updates["status"] == "done" else None
    if updates:
        conn.execute(
            f"UPDATE goals SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",
            [*updates.values(), goal_id],
        )
        conn.commit()
    return _goal_out(conn, goal_id)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, conn: DB):
    conn.execute("DELETE FROM goals WHERE id=?", (goal_id,))
    conn.commit()


# ── Tasks ────────────────────────────────────────────────────────────────────

def _task_out(conn: sqlite3.Connection, task_id: int) -> TaskOut:
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskOut(**dict(row))


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    conn: DB,
    status: str = Query("open", pattern="^(open|done|all)$"),
    kind: str | None = Query(None, pattern="^(task|note)$"),
    done_on: str | None = Query(None, description="Only tasks completed on this date"),
):
    where, params = [], []
    if done_on:
        where.append("done_at = ?")
        params.append(_iso(done_on, "done_on"))
    elif status == "open":
        where.append("done_at IS NULL")
    elif status == "done":
        where.append("done_at IS NOT NULL")
    if kind:
        where.append("kind = ?")
        params.append(kind)
    sql = "SELECT * FROM tasks" + (f" WHERE {' AND '.join(where)}" if where else "")
    order = " ORDER BY done_at DESC, id DESC" if status == "done" or done_on else \
            " ORDER BY due_date IS NULL, due_date, id"
    return [TaskOut(**dict(r)) for r in conn.execute(sql + order, params).fetchall()]


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskIn, conn: DB):
    fields = body.model_dump()
    _check_task(fields)
    cur = conn.execute(
        """INSERT INTO tasks (title, notes, kind, due_date, remind_days, repeat, area, goal_id)
           VALUES (?,?,?,?,?,?,?,?)""",
        (body.title.strip(), body.notes, body.kind, _iso(body.due_date, "due_date"),
         body.remind_days, body.repeat, body.area, body.goal_id),
    )
    conn.commit()
    return _task_out(conn, cur.lastrowid)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskPatch, conn: DB):
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = body.model_dump(exclude_unset=True)
    _check_task({**dict(row), **updates})
    for f in ("due_date", "done_at"):
        if f in updates:
            updates[f] = _iso(updates[f], f)
    if updates:
        conn.execute(
            f"UPDATE tasks SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?",
            [*updates.values(), task_id],
        )
        conn.commit()
    return _task_out(conn, task_id)


@router.post("/tasks/{task_id}/complete", response_model=TaskOut)
def complete_task(task_id: int, body: TaskComplete, conn: DB):
    on = date.fromisoformat(_iso(body.date, "date") or date.today().isoformat())
    row = agenda_mod.complete(conn, task_id, on)
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskOut(**row)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, conn: DB):
    conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()


# ── Birthdays / agenda / calendar ────────────────────────────────────────────

@router.get("/birthdays", response_model=list[BirthdayOut])
def list_birthdays(conn: DB):
    return [BirthdayOut(**b) for b in agenda_mod.birthdays(conn, date.today())]


@router.get("/agenda", response_model=AgendaOut)
def get_agenda(conn: DB, day: str | None = Query(None, alias="date")):
    today = date.fromisoformat(_iso(day, "date") or date.today().isoformat())
    a = agenda_mod.agenda(conn, today)

    # Only goals running now: on-track count, the ones slipping, deadlines within 30 days.
    soon = (today + timedelta(days=30)).isoformat()
    live = [g for g in goals_mod.list_with_progress(conn, today, _net_worth, today.year)
            if g["status"] == "active" and g["start_date"] <= today.isoformat()]
    brief = GoalsBrief(
        on_track=sum(g["state"] in ("on_track", "achieved") for g in live),
        behind=[GoalOut(**g) for g in live if g["state"] in ("behind", "overdue")],
        due_soon=[GoalOut(**g) for g in live
                  if g["deadline"] and today.isoformat() <= g["deadline"] <= soon
                  and g["state"] not in ("achieved", "behind", "overdue")],
    )
    return AgendaOut(**a, goals=brief)


@router.get("/calendar.ics")
def calendar_feed(conn: DB):
    return Response(
        content=ics_mod.build(conn),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="daybook.ics"'},
    )
