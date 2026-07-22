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
    source_id: Optional[str] = None  # external dedup key (e.g. FinanceKit tx UUID)


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
    is_fixed: bool = False # fixed recurring bill (rent, …) — pace alerts don't apply


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
    # Adjusted (discretionary-only) metrics — fixed bills amortised over the month
    adjusted_velocity: float = 0.0
    fixed_spent: float = 0.0
    fixed_budget: float = 0.0
    discretionary_spent: float = 0.0
    discretionary_budget: float = 0.0
    projected_month_end_adjusted: float = 0.0
    projected_savings_adjusted: float = 0.0


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


class SubcategoryBreakdown(BaseModel):
    subcategory: str
    total: float
    count: int
    variance_flag: bool = False  # (max−min) > 2× avg over >3 transactions

class CategoryStats(BaseModel):
    category: str
    total: float
    avg_per_month: float
    count: int
    min_tx: float
    max_tx: float
    pct_of_total: float
    subcategories: list[SubcategoryBreakdown] = []
    variance_flag: bool = False  # (max−min) > 2× avg over >3 transactions


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


# ── Money Intelligence (Track A-II) ───────────────────────────────────────────

class WaterfallItem(BaseModel):
    name: str
    amount: float


class WaterfallData(BaseModel):
    month: str
    income: float
    categories: list[WaterfallItem]   # expenses by category, descending
    savings: float                    # income − total expenses
    savings_rate: float               # 0-1 (0 when income is 0)


class EfficiencyRow(BaseModel):
    category: str
    avg_actual: float                 # avg monthly spend over the window
    budget: float
    aggressive_cap: float             # min(budget, 25th percentile of monthly spends)
    recoverable_per_month: float      # max(0, avg_actual − aggressive_cap)
    flag: str                         # 'over_budget' | 'recoverable' | 'efficient'


class EfficiencyData(BaseModel):
    window_months: int
    rows: list[EfficiencyRow]         # sorted by recoverable desc
    total_recoverable: float


class MonthlyAnomaly(BaseModel):
    month: str
    metric: str                       # 'expenses' | 'income' | 'savings'
    value: float
    mean: float
    std: float
    z_score: float
    severity: str                     # 'high' (|z|≥2.5) | 'medium' (2.0–2.5)


class MonthlySeriesPoint(BaseModel):
    month: str
    expenses: float
    income: float
    savings: float


class MonthlyAnomalyReport(BaseModel):
    window_months: int
    series: list[MonthlySeriesPoint]  # completed months, ascending
    anomalies: list[MonthlyAnomaly]   # sorted by |z| desc


class SeasonalMonth(BaseModel):
    month_num: int                    # 1..12
    label: str                        # 'Jan'..'Dec'
    avg_expenses: float
    avg_income: float
    avg_savings: float
    n_years: int                      # how many observations back this average


class SeasonalData(BaseModel):
    months: list[SeasonalMonth]
    most_expensive: Optional[str]     # label of hi month (None if no data)
    cheapest: Optional[str]


# ── Investment Portfolio (Track A-I) ─────────────────────────────────────────

AssetClass = Literal[
    "equity_etf", "stock", "crypto", "bond_etf", "cash", "commodity",
    # Manual-valuation classes (no market ticker; value set by hand):
    "fund", "real_estate", "pension", "private", "other",
]

# 'market' = priced nightly via yfinance; 'manual' = user sets the value
# (real estate, pension plans, unlisted funds, private equity…)
PricingMode = Literal["market", "manual"]


class HoldingCreate(BaseModel):
    account: str
    ticker: str
    isin: Optional[str] = None
    name: str
    asset_class: AssetClass
    currency: str = "EUR"
    quantity: float = Field(gt=0)
    cost_basis_eur: Optional[float] = None
    first_bought_at: Optional[str] = None
    notes: Optional[str] = None
    pricing_mode: PricingMode = "market"
    # Initial value for manual holdings (total EUR, not per unit)
    current_value_eur: Optional[float] = Field(default=None, gt=0)


class HoldingPatch(BaseModel):
    quantity: Optional[float] = None
    cost_basis_eur: Optional[float] = None
    name: Optional[str] = None
    ticker: Optional[str] = None
    isin: Optional[str] = None
    asset_class: Optional[AssetClass] = None
    account: Optional[str] = None
    first_bought_at: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class HoldingOut(BaseModel):
    id: str
    account: str
    ticker: str
    isin: Optional[str]
    name: str
    asset_class: AssetClass
    currency: str
    quantity: float
    cost_basis_eur: Optional[float]
    first_bought_at: Optional[str]
    notes: Optional[str]
    is_active: bool
    pricing_mode: PricingMode = "market"
    # Live computed:
    current_price_eur: Optional[float]          # None if no price cached yet
    market_value_eur: Optional[float]
    unrealized_pnl_eur: Optional[float]         # None if cost basis unknown
    unrealized_pnl_pct: Optional[float]
    day_change_eur: Optional[float]
    day_change_pct: Optional[float]
    ytd_change_pct: Optional[float]
    price_as_of: Optional[str]                  # date of the latest cached price
    allocation_pct: Optional[float]             # % of total portfolio


class SellHoldingBody(BaseModel):
    to_account: str                                    # liquid account receiving proceeds
    quantity: Optional[float] = Field(default=None, gt=0)   # None = sell everything
    price_eur: Optional[float] = Field(default=None, gt=0)  # None = latest cached close
    fee_eur: Optional[float] = Field(default=None, ge=0)    # broker/management fee, subtracted from proceeds
    date: Optional[str] = None                         # YYYY-MM-DD, default today
    notes: Optional[str] = None


class SellResult(BaseModel):
    holding: HoldingOut
    transaction_id: str
    quantity_sold: float
    price_eur: float
    fee_eur: float = 0.0
    proceeds_eur: float                       # net of fee — what actually lands in the account
    realized_pnl_eur: Optional[float] = None  # None when cost basis was unknown; already fee-adjusted


class RealizedTradeOut(BaseModel):
    """A completed sale — the gain/loss locked in at the moment of selling."""
    id: int
    holding_id: str
    ticker: str
    name: str
    account: str
    date: str
    quantity: float
    price_eur: float
    proceeds_eur: float
    cost_basis_sold_eur: Optional[float]
    realized_pnl_eur: Optional[float]


class BuyHoldingBody(BaseModel):
    from_account: str                                   # liquid account funding the purchase
    quantity: float = Field(gt=0)                        # units added
    price_eur: Optional[float] = Field(default=None, gt=0)   # None = fetch today's live price
    fee_eur: Optional[float] = Field(default=None, ge=0)     # broker/management fee, added to cost basis
    date: Optional[str] = None                           # YYYY-MM-DD, default today
    notes: Optional[str] = None


class BuyResult(BaseModel):
    holding: HoldingOut
    transaction_id: str
    quantity_bought: float
    price_eur: float
    fee_eur: float = 0.0
    cost_eur: float             # total debited, including fee — this is what the cost basis moves by


class AllocationSlice(BaseModel):
    label: str
    value_eur: float
    pct: float


class MoverOut(BaseModel):
    holding_id: str
    ticker: str
    name: str
    day_change_eur: float
    day_change_pct: float


class PortfolioOverview(BaseModel):
    as_of: str
    total_value_eur: float
    total_cost_basis_eur: float                 # sum of cost_basis where known
    total_pnl_eur: float                        # value − cost_basis (known)
    total_pnl_pct: float
    day_change_eur: float
    day_change_pct: float
    ytd_pnl_eur: float
    ytd_pnl_pct: float
    allocation_by_class: list[AllocationSlice]
    allocation_by_account: list[AllocationSlice]
    allocation_by_currency: list[AllocationSlice]
    top_movers_up: list[MoverOut]
    top_movers_down: list[MoverOut]
    top_holdings: list[HoldingOut]              # top 5 by market value
    holdings_count: int
    # Cash-only accounts (no holdings) — surfaced as a strip
    liquid_accounts: list[AccountBalance]
    # Total worth = investments + cash, so one number answers "what am I worth"
    total_liquid_eur: float = 0.0
    total_net_worth_eur: float = 0.0
    # Locked-in gains from sales (all-time / current year)
    realized_pnl_total_eur: float = 0.0
    realized_pnl_ytd_eur: float = 0.0


class PortfolioHistoryPoint(BaseModel):
    date: str
    total_value_eur: float
    invested_eur: float                         # cumulative net inflows (proxy)


class HoldingHistoryPoint(BaseModel):
    date: str
    quantity: float
    price_eur: float
    value_eur: float


class IsinCandidate(BaseModel):
    """One resolution of an ISIN to a tradeable ticker/exchange."""
    ticker: str          # yfinance-compatible symbol (e.g. VWCE.DE)
    name: Optional[str] = None
    exchange: Optional[str] = None
    exchange_code: Optional[str] = None
    currency: Optional[str] = None
    # Probed against yfinance: does this listing actually have price data?
    has_data: Optional[bool] = None       # None = not probed
    last_close_date: Optional[str] = None  # date of most recent close found


class IsinLookupResult(BaseModel):
    isin: str
    candidates: list[IsinCandidate]


class ManualValueBody(BaseModel):
    """Set today's value of a manually-priced holding (total EUR)."""
    value_eur: float = Field(gt=0)
    date: Optional[str] = None  # YYYY-MM-DD, default today


# ── Recurring Investment Plans (DCA) ─────────────────────────────────────────

Cadence = Literal["weekly", "biweekly", "monthly", "quarterly", "yearly"]


class InvestmentPlanCreate(BaseModel):
    holding_id: str
    source_account: str
    amount_eur: float = Field(gt=0)
    cadence: Cadence
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)     # Mon=0
    start_date: str                                                   # YYYY-MM-DD, first execution
    end_date: Optional[str] = None
    notes: Optional[str] = None


class InvestmentPlanPatch(BaseModel):
    amount_eur: Optional[float] = Field(default=None, gt=0)
    cadence: Optional[Cadence] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)
    source_account: Optional[str] = None
    end_date: Optional[str] = None
    next_execution_date: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class InvestmentPlanOut(BaseModel):
    id: int
    holding_id: str
    ticker: str                     # convenience
    holding_name: str               # convenience
    holding_account: str            # convenience
    source_account: str
    amount_eur: float
    cadence: Cadence
    day_of_month: Optional[int]
    day_of_week: Optional[int]
    start_date: str
    end_date: Optional[str]
    next_execution_date: str
    last_executed_at: Optional[str]
    is_active: bool
    notes: Optional[str]
    # Derived stats
    total_contributed_eur: float
    total_quantity_added: float
    executions_count: int
    monthly_equivalent_eur: float   # normalised per-month contribution rate


class PlanExecutionOut(BaseModel):
    id: int
    plan_id: int
    execution_date: str
    amount_eur: float
    price_eur: float
    quantity_added: float
    transaction_id: Optional[str]
    status: str
    notes: Optional[str]
    created_at: str


class PlanRunResult(BaseModel):
    executed: list[PlanExecutionOut]
    dry_run: bool


