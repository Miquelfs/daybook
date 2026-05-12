from datetime import date as _date
from typing import Optional
from pydantic import BaseModel, Field


class TransactionCreate(BaseModel):
    date: str = Field(default_factory=lambda: _date.today().isoformat())
    name: str
    amount: float = Field(gt=0, description="Always positive; router applies sign based on category")
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
