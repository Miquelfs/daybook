from __future__ import annotations

from pydantic import BaseModel, Field


class GoalIn(BaseModel):
    title: str
    emoji: str | None = None
    area: str | None = None
    priority: int = Field(2, ge=1, le=3)
    start_date: str | None = None          # default: 1 Jan this year
    deadline: str | None = None            # default: 31 Dec of the start year
    metric: str = "manual"
    metric_param: str | None = None
    target: float | None = None
    baseline: float | None = None
    current: float | None = None
    notes: str | None = None


class GoalPatch(BaseModel):
    title: str | None = None
    emoji: str | None = None
    area: str | None = None
    priority: int | None = Field(None, ge=1, le=3)
    start_date: str | None = None
    deadline: str | None = None
    metric: str | None = None
    metric_param: str | None = None
    target: float | None = None
    baseline: float | None = None
    current: float | None = None
    status: str | None = None              # active | done | dropped
    notes: str | None = None


class GoalOut(BaseModel):
    id: int
    title: str
    emoji: str | None = None
    area: str | None = None
    priority: int
    start_date: str
    deadline: str | None = None
    metric: str
    metric_param: str | None = None
    target: float | None = None
    baseline: float | None = None
    current: float | None = None
    status: str
    notes: str | None = None
    completed_at: str | None = None
    created_at: str
    # computed
    state: str
    kind: str                              # sum | ceiling | avg | level | best | streak | manual
    unit: str
    actual: float | None = None
    pct: int | None = None
    expected: float | None = None
    compare: float | None = None           # ceiling: last year · streak: current run · level: start value
    lower_is_better: bool = False
    needed_per_week: float | None = None
    days_left: int | None = None
    param_label: str | None = None         # the tag / person / distance the goal is tied to
    param_icon: str | None = None          # the tag's (or person's) emoji


class TaskIn(BaseModel):
    title: str
    notes: str | None = None
    kind: str = "task"                     # task | note
    due_date: str | None = None
    remind_days: int | None = Field(None, ge=0, le=365)
    repeat: str | None = None              # weekly | monthly | yearly
    area: str | None = None
    goal_id: int | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    notes: str | None = None
    kind: str | None = None
    due_date: str | None = None
    remind_days: int | None = Field(None, ge=0, le=365)
    repeat: str | None = None
    area: str | None = None
    goal_id: int | None = None
    done_at: str | None = None             # null re-opens


class TaskOut(BaseModel):
    id: int
    title: str
    notes: str | None = None
    kind: str
    due_date: str | None = None
    remind_days: int | None = None
    repeat: str | None = None
    area: str | None = None
    goal_id: int | None = None
    done_at: str | None = None
    created_at: str
    days_until: int | None = None


class TaskComplete(BaseModel):
    date: str | None = None                # default: today


class BirthdayOut(BaseModel):
    contact_id: int
    name: str
    emoji: str | None = None
    group_: str | None = None
    birthday: str
    date: str
    days_until: int
    turning: int | None = None
    last_seen: str | None = None
    days_since_seen: int | None = None
    days_together_this_year: int = 0


class MetricOut(BaseModel):
    key: str
    label: str
    area: str
    unit: str
    kind: str
    hint: str
    param: str | None = None               # tag | contact | distance
    lower_is_better: bool = False


class GoalsMeta(BaseModel):
    metrics: list[MetricOut]
    years: list[int]


class GoalsBrief(BaseModel):
    on_track: int = 0
    total: int = 0
    behind: list[GoalOut] = []
    due_soon: list[GoalOut] = []           # active, deadline within 30 days


class AgendaOut(BaseModel):
    date: str
    overdue: list[TaskOut]
    today: list[TaskOut]
    upcoming: list[TaskOut]
    notes: list[TaskOut]
    inbox_count: int
    birthdays: list[BirthdayOut]
    goals: GoalsBrief


class AreaPlanOut(BaseModel):
    area: str
    tasks: list[TaskOut]
    goals: list[GoalOut]
