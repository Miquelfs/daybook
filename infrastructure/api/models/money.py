from datetime import date as _date
from typing import Literal, Optional
from pydantic import BaseModel, Field


class TransactionCreate(BaseModel):
    date: str = Field(default_factory=lambda: _date.today().isoformat())
    name: str
    amount: float = Field(gt=0, description="Always positive; router applies sign based on category and sign field")
    sign: Literal["-", "+"] = "-"   # "-" = expense (default), "+" = reimbursement / income
    category: str
    subcategory: Optional[str] = None
    account: Optional[str] = None
    notes: Optional[str] = None


class TransactionOut(BaseModel):
    id: str
    source: str
    date: str
    name: str
    amount: float          # raw sign (neg=expense, pos=income) — preserved from DB
    account: Optional[str]
    category: Optional[str]
    subcategory: Optional[str]
    transaction_type: str
    notes: Optional[str]
    created_at: str


class TransactionPatch(BaseModel):
    date: Optional[str] = None
    name: Optional[str] = None
    amount: Optional[float] = None
    sign: Optional[Literal["-", "+"]] = None  # if provided alongside amount, overrides sign convention
    category: Optional[str] = None
    subcategory: Optional[str] = None
    account: Optional[str] = None
    notes: Optional[str] = None


class CategoryBudget(BaseModel):
    category: str
    spent: float
    budget: float
    remaining: float
    velocity: float        # (spent/budget) / (days_elapsed/days_in_month); >1 = over pace
    status: str            # 'OK' | 'Over Pace' | 'Over Budget' | 'No Budget'


class MonthSummary(BaseModel):
    month: str
    total_spent: float
    total_income: float
    total_budget: float
    days_elapsed: int
    days_in_month: int
    velocity: float
    categories: list[CategoryBudget]


class MerchantSuggestion(BaseModel):
    name: str
    last_used: str
    category: Optional[str]


class CategoryMeta(BaseModel):
    key: str
    emoji: str


class MoneyMeta(BaseModel):
    categories: list[CategoryMeta]
    accounts: list[str]
    defaults: dict[str, str]    # {"account": "...", "category": "..."}


class MonthHistory(BaseModel):
    month: str
    total_spent: float
    total_income: float
    savings: float
    savings_rate: float         # 0-1
    total_budget: float
    on_budget: bool             # savings >= MONTHLY_SAVINGS_GOAL


class SavingsStreak(BaseModel):
    current_streak: int
    best_streak: int
    success_rate: float         # 0-1, months on budget / total months


class TrendsData(BaseModel):
    months: list[MonthHistory]
    savings_streak: SavingsStreak
    avg_monthly_spent: float
    avg_monthly_income: float
    avg_savings_rate: float


class CategoryMonthSpend(BaseModel):
    category: str
    month: str
    spent: float


class CategoryTrendsData(BaseModel):
    items: list[CategoryMonthSpend]
    months: list[str]       # sorted list of month strings for chart x-axis
    categories: list[str]   # all categories present


class BudgetAlert(BaseModel):
    category: str
    velocity: float
    spent: float
    budget: float
    status: str  # "Over Budget" | "Over Pace"


class MonthOverview(BaseModel):
    month: str
    total_spent: float
    total_income: float
    total_budget: float
    days_elapsed: int
    days_in_month: int
    velocity: float
    daily_burn_rate: float
    projected_month_end: float
    projected_savings: float
    categories: list[CategoryBudget]
    alerts: list[BudgetAlert]


class MonthDetail(BaseModel):
    month: str
    income: float
    spent: float
    savings: float
    savings_rate: float
    mom_income_pct: Optional[float]
    mom_expenses_pct: Optional[float]
    yoy_income_pct: Optional[float]
    yoy_expenses_pct: Optional[float]


class HistoricalData(BaseModel):
    months: list[MonthDetail]
    avg_monthly_income: float
    avg_monthly_spent: float
    avg_savings_rate: float


class ForecastData(BaseModel):
    predicted_spent: float
    predicted_income: float
    predicted_savings: float
    based_on_months: list[str]


class AccountBalance(BaseModel):
    name: str
    balance: float
    account_type: str  # "Investment" | "Checking" | "Savings" | "Crypto Investment" | "Unknown"


class PortfolioSummary(BaseModel):
    accounts: list[AccountBalance]
    total_net_worth: float
    total_investments: float
    total_liquid: float
    investment_pct: float
    liquid_pct: float


class DaySpend(BaseModel):
    day_name: str
    total: float


class WeekSpend(BaseModel):
    week_num: int
    total: float


class SpendingPatterns(BaseModel):
    by_day: list[DaySpend]
    by_week: list[WeekSpend]


class CategoryStats(BaseModel):
    category: str
    total: float
    avg_per_month: float
    count: int
    min_tx: float
    max_tx: float
    pct_of_total: float


class LargeTxAnomaly(BaseModel):
    id: str
    date: str
    name: str
    amount: float
    category: str | None
    account: str | None
    ratio: float  # how many × the category avg this transaction is


class CategorySpikeAnomaly(BaseModel):
    category: str
    current_spent: float
    avg_spent: float
    ratio: float  # current_spent / avg_spent


class AnomalyReport(BaseModel):
    month: str
    large_transactions: list[LargeTxAnomaly]
    category_spikes: list[CategorySpikeAnomaly]


