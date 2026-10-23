from pydantic import BaseModel, Field


class BudgetPlanRow(BaseModel):
    category: str
    emoji: str
    fixed: bool              # a bill (rent) — kept as is
    current: float           # this month's budget
    typical: float           # median month over the last 12 complete months
    average: float
    last: float              # last complete month
    months_active: int       # months with any spend
    suggested: float
    history: list[float]     # last 12 complete months, oldest first


class BudgetPlan(BaseModel):
    effective_month: str     # the suggestions are for this month (next month)
    months: list[str]        # the 12 months `history` covers
    goal: float
    avg_income: float
    current_total: float
    suggested_total: float
    rows: list[BudgetPlanRow]


class BudgetSave(BaseModel):
    effective_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    amounts: dict[str, float]


class MoneySettingsIn(BaseModel):
    savings_goal: float = Field(ge=0, le=100000)
