"""
Plan ahead — goals with automatic progress, tasks, notes that resurface, birthdays.

GET    /goals                — goals with computed progress (?year=)
GET    /goals/meta           — progress sources (metrics) and the years to offer
POST   /goals                — new goal
PATCH  /goals/{id}           — edit / mark done / drop
DELETE /goals/{id}
GET    /tasks                — ?status=open|done|all  &kind=task|note  &done_on=YYYY-MM-DD  &area=
POST   /tasks
PATCH  /tasks/{id}           — edit; done_at=null re-opens
POST   /tasks/{id}/complete  — done (a repeating task re-arms at its next date)
DELETE /tasks/{id}
GET    /plan/area/{area}     — open tasks, notes and this year's goals for one page (money, health, …)
GET    /habits               — tracked habits (pinned · goal · experiment): last 7 days, streaks, 30-day rate
GET    /habits/explore       — every tag ever logged, to look back at any of them
POST   /habits/{slug}/track  — pin a tag as a habit (DELETE unpins)
GET    /habits/{slug}        — one tag for a year (?year=): calendar, months, weekdays, streaks
GET    /companions/activity/{id}, /companions/trip/{start}/{end}  — who it was with (PUT {contact_ids})
GET    /people               — everyone, with days together this year / all time (for search)
GET    /people/{id}          — one person for a year (?year=): calendar, frequency, what you do together
GET    /planned-trips        — trips ahead (POST to plan one; PATCH / DELETE /planned-trips/{id})
GET    /birthdays            — everyone with a birthday, soonest first
GET    /agenda               — the Today strip: overdue / today / coming up / notes / birthdays / goals
"""

import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Annotated, Iterator

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from domains.plans import agenda as agenda_mod
from domains.plans import companions as companions_mod
from domains.plans import goals as goals_mod
from domains.plans import habits as habits_mod
from domains.plans import people as people_mod
from domains.plans import planned_trips as trips_mod
from domains.plans.metrics import METRICS, Ctx, catalog
from infrastructure.api.db import get_db
from infrastructure.api.models.plans import (
    AgendaOut, AreaPlanOut, BirthdayOut, GoalIn, GoalOut, GoalPatch, GoalsBrief, GoalsMeta,
    TaskComplete, TaskIn, TaskOut, TaskPatch,
)

router = APIRouter(tags=["plans"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

GOAL_STATUSES = ("active", "done", "dropped")
FIRST_YEAR = 2026            # the daybook's first full year — no goals view before it
_LOCATIONS_DB = Path(__file__).parents[2] / "db" / "locations.db"


def _iso(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")


@contextmanager
def _ctx(conn: sqlite3.Connection) -> Iterator[Ctx]:
    """Progress context: money.db / locations.db open only if a goal needs them."""
    opened: dict[str, sqlite3.Connection | None] = {}

    def money():
        if "money" not in opened:
            from infrastructure.db.money_connection import get_money_connection
            try:
                opened["money"] = get_money_connection()
            except Exception:
                opened["money"] = None
        return opened["money"]

    def locations():
        if "loc" not in opened:
            opened["loc"] = None
            if _LOCATIONS_DB.exists() and _LOCATIONS_DB.stat().st_size > 0:
                c = sqlite3.connect(f"file:{_LOCATIONS_DB}?mode=ro", uri=True, timeout=10)
                c.row_factory = sqlite3.Row
                opened["loc"] = c
        return opened["loc"]

    def net_worth():
        """Same figure as Money → total net worth (holdings + liquid accounts)."""
        from infrastructure.api.routers.money import portfolio_overview
        m = money()
        return portfolio_overview(m).total_net_worth_eur if m is not None else None

    try:
        yield Ctx(conn, money=money, locations=locations, net_worth=net_worth)
    finally:
        for c in opened.values():
            if c is not None:
                c.close()


def _goal_out(conn: sqlite3.Connection, goal_id: int) -> GoalOut:
    row = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    with _ctx(conn) as ctx:
        return GoalOut(**goals_mod.progress(ctx, dict(row), date.today()))


def _check_goal(fields: dict) -> None:
    if "metric" in fields and fields["metric"] not in METRICS:
        raise HTTPException(status_code=422, detail=f"unknown metric {fields['metric']!r}")
    metric = METRICS.get(fields.get("metric") or "manual", METRICS["manual"])[0]
    if metric.param and not fields.get("metric_param"):
        raise HTTPException(status_code=422, detail=f"{metric.label} needs a {metric.param}")
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

@router.get("/goals/meta", response_model=GoalsMeta)
def goals_meta(conn: DB):
    return GoalsMeta(metrics=catalog(), years=goals_mod.years(conn, FIRST_YEAR, date.today()))


@router.get("/goals", response_model=list[GoalOut])
def list_goals(conn: DB, year: int | None = Query(None)):
    with _ctx(conn) as ctx:
        return [GoalOut(**g) for g in goals_mod.list_with_progress(ctx, date.today(), year)]


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalIn, conn: DB):
    _check_goal(body.model_dump())
    start = _iso(body.start_date, "start_date")                 # optional — no start → counts from 1 Jan
    deadline = _iso(body.deadline, "deadline") or goals_mod.period_end(
        date.fromisoformat(start) if start else date.today()).isoformat()
    if start and deadline < start:
        raise HTTPException(status_code=422, detail="deadline is before start_date")
    cur = conn.execute(
        """INSERT INTO goals (title, emoji, area, priority, start_date, deadline, metric,
                              metric_param, target, baseline, current, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (body.title.strip(), body.emoji, body.area, body.priority, start, deadline,
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
    area: str | None = Query(None),
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
    if area:
        where.append("area = ?")
        params.append(area)
    sql = "SELECT * FROM tasks" + (f" WHERE {' AND '.join(where)}" if where else "")
    order = " ORDER BY done_at DESC, id DESC" if status == "done" or done_on else \
            " ORDER BY due_date IS NULL, due_date, id"
    return [TaskOut(**dict(r)) for r in conn.execute(sql + order, params).fetchall()]


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskIn, conn: DB):
    _check_task(body.model_dump())
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


# ── Per-page plan / birthdays / agenda ───────────────────────────────────────

def _live_goals(ctx: Ctx, today: date) -> list[dict]:
    """Active goals running now (this year's, already started)."""
    return [g for g in goals_mod.list_with_progress(ctx, today, today.year)
            if g["status"] == "active" and goals_mod.effective_start(g, today) <= today]


@router.get("/plan/area/{area}", response_model=AreaPlanOut)
def area_plan(area: str, conn: DB):
    today = date.today()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE done_at IS NULL AND area=? ORDER BY due_date IS NULL, due_date, id", (area,)
    ).fetchall()
    with _ctx(conn) as ctx:
        goals = [g for g in _live_goals(ctx, today) if g["area"] == area]
    return AreaPlanOut(area=area, tasks=[TaskOut(**dict(r)) for r in rows], goals=[GoalOut(**g) for g in goals])


@router.get("/habits")
def list_habits(conn: DB):
    return habits_mod.overview(conn, date.today())


@router.get("/habits/explore")
def explore_habits(conn: DB):
    return habits_mod.explore(conn, date.today())


@router.post("/habits/{slug}/track", status_code=204)
def track_habit(slug: str, conn: DB):
    if not habits_mod.set_tracked(conn, slug, True):
        raise HTTPException(status_code=404, detail="Tag not found")


@router.delete("/habits/{slug}/track", status_code=204)
def untrack_habit(slug: str, conn: DB):
    if not habits_mod.set_tracked(conn, slug, False):
        raise HTTPException(status_code=404, detail="Tag not found")


@router.get("/habits/{slug}")
def habit_detail(slug: str, conn: DB, year: int | None = Query(None)):
    today = date.today()
    out = habits_mod.detail(conn, slug, year or today.year, today)
    if out is None:
        raise HTTPException(status_code=404, detail="Habit not found")
    return out


@router.get("/people")
def list_people(conn: DB):
    return people_mod.directory(conn, date.today())


@router.get("/people/{contact_id}")
def person(contact_id: int, conn: DB, year: int | None = Query(None)):
    today = date.today()
    out = people_mod.profile(conn, contact_id, year or today.year, today)
    if out is None:
        raise HTTPException(status_code=404, detail="Person not found")
    return out


class WithIn(BaseModel):
    contact_ids: list[int]


class PlannedTripIn(BaseModel):
    name: str | None = None
    destination: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    notes: str | None = None
    contact_ids: list[int] | None = None


def _check_trip(fields: dict) -> dict:
    for f in ("start_date", "end_date"):
        if f in fields:
            fields[f] = _iso(fields[f], f)
    if fields.get("start_date") and fields.get("end_date") and fields["end_date"] < fields["start_date"]:
        raise HTTPException(status_code=422, detail="end_date is before start_date")
    if "name" in fields and not (fields["name"] or "").strip():
        raise HTTPException(status_code=422, detail="name cannot be empty")
    return fields


@router.get("/planned-trips")
def list_planned_trips(conn: DB):
    return trips_mod.upcoming(conn, date.today())


@router.post("/planned-trips", status_code=201)
def create_planned_trip(body: PlannedTripIn, conn: DB):
    fields = _check_trip(body.model_dump(exclude={"contact_ids"}, exclude_none=True))
    if not all(fields.get(f) for f in ("name", "start_date", "end_date")):
        raise HTTPException(status_code=422, detail="name, start_date and end_date are required")
    pid = trips_mod.save(conn, fields, body.contact_ids)
    return trips_mod.get(conn, pid, date.today())


@router.patch("/planned-trips/{planned_id}")
def update_planned_trip(planned_id: int, body: PlannedTripIn, conn: DB):
    current = trips_mod.get(conn, planned_id, date.today())
    if current is None:
        raise HTTPException(status_code=404, detail="Planned trip not found")
    fields = body.model_dump(exclude={"contact_ids"}, exclude_unset=True)
    _check_trip({**{k: current[k] for k in ("start_date", "end_date")}, **fields})
    trips_mod.save(conn, _check_trip(fields), body.contact_ids, planned_id)
    return trips_mod.get(conn, planned_id, date.today())


@router.delete("/planned-trips/{planned_id}", status_code=204)
def delete_planned_trip(planned_id: int, conn: DB):
    trips_mod.delete(conn, planned_id)


@router.get("/companions/activity/{activity_id}")
def get_activity_with(activity_id: str, conn: DB):
    return companions_mod.activity_with(conn, activity_id)


@router.put("/companions/activity/{activity_id}")
def put_activity_with(activity_id: str, body: WithIn, conn: DB):
    out = companions_mod.set_activity_with(conn, activity_id, body.contact_ids)
    if out is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    return out


@router.get("/companions/trip/{start}/{end}")
def get_trip_with(start: str, end: str, conn: DB):
    return companions_mod.trip_with(conn, _iso(start, "start"), _iso(end, "end"))


@router.put("/companions/trip/{start}/{end}")
def put_trip_with(start: str, end: str, body: WithIn, conn: DB):
    return companions_mod.set_trip_with(conn, _iso(start, "start"), _iso(end, "end"), body.contact_ids)


@router.get("/birthdays", response_model=list[BirthdayOut])
def list_birthdays(conn: DB):
    return [BirthdayOut(**b) for b in agenda_mod.birthdays(conn, date.today())]


@router.get("/agenda", response_model=AgendaOut)
def get_agenda(conn: DB, day: str | None = Query(None, alias="date")):
    today = date.fromisoformat(_iso(day, "date") or date.today().isoformat())
    a = agenda_mod.agenda(conn, today)

    # Goals running now: on-track count, the ones slipping, deadlines within 30 days.
    soon = (today + timedelta(days=30)).isoformat()
    with _ctx(conn) as ctx:
        live = _live_goals(ctx, today)
    brief = GoalsBrief(
        on_track=sum(g["state"] in ("on_track", "achieved") for g in live),
        total=len(live),
        behind=[GoalOut(**g) for g in live if g["state"] in ("behind", "overdue")],
        due_soon=[GoalOut(**g) for g in live
                  if g["deadline"] and today.isoformat() <= g["deadline"] <= soon
                  and g["state"] not in ("achieved", "behind", "overdue")],
    )
    trips = [t for t in trips_mod.upcoming(conn, today) if t["days_until"] <= 60]
    return AgendaOut(**a, goals=brief, trips=trips)

