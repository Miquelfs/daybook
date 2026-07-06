"""
Money / Finance API router.
All analytics are pure SQL — no pandas dependency.
"""

import calendar
import csv as _csv
import io
import sqlite3
import uuid
from datetime import date, datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from infrastructure.api.db_money import get_money_db
from infrastructure.api.models.money import (
    AccountBalance, AllocationSlice, AnomalyReport, BudgetAlert,
    CategoryBudget, CategoryMeta, CategoryMonthSpend, CategorySpikeAnomaly, CategoryStats, CategoryTrendsData, SubcategoryBreakdown,
    DaySpend, EfficiencyData, EfficiencyRow, ForecastData, HistoricalData,
    MonthlyAnomaly, MonthlyAnomalyReport, MonthlySeriesPoint,
    SeasonalData, SeasonalMonth, WaterfallData, WaterfallItem,
    HoldingCreate, HoldingHistoryPoint, HoldingOut, HoldingPatch,
    InvestmentPlanCreate, InvestmentPlanOut, InvestmentPlanPatch,
    IsinCandidate, IsinLookupResult,
    LargeTxAnomaly, MerchantSuggestion, MoneyMeta,
    MonthDetail, MonthHistory, MonthOverview, MonthSummary,
    BuyHoldingBody, BuyResult,
    MoverOut, PlanExecutionOut, PlanRunResult,
    SellHoldingBody, SellResult,
    PortfolioHistoryPoint, PortfolioOverview, PortfolioSummary,
    SavingsStreak, SpendingPatterns, TrendsData,
    TransactionCreate, TransactionOut, TransactionPatch,
    WeekSpend,
)
from domains.money.money_config import (
    CATEGORY_EMOJI, EXPENSE_CATEGORIES, classify, get_budget_for_month,
    FIXED_RECURRING_CATEGORIES,
    INCOME_CATEGORIES, LIQUID_ACCOUNTS, INVESTMENT_ACCOUNTS,
)

router = APIRouter(prefix="/money", tags=["money"])

DB = Annotated[sqlite3.Connection, Depends(get_money_db)]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_txn(row: sqlite3.Row) -> TransactionOut:
    return TransactionOut(
        id=row["id"],
        source=row["source"],
        date=row["date"],
        name=row["name"],
        amount=row["amount"],
        account=row["account"],
        category=row["category"],
        subcategory=row["subcategory"],
        transaction_type=row["transaction_type"],
        notes=row["notes"],
        created_at=row["created_at"],
    )


def _days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _budget_status(spent: float, budget: float, velocity: float) -> str:
    if budget == 0:
        return "No Budget"
    if velocity > 1.2:
        return "Over Pace"
    if spent > budget:
        return "Over Budget"
    return "OK"


# ── Transactions ──────────────────────────────────────────────────────────────

@router.post("/transactions", response_model=TransactionOut)
def create_transaction(body: TransactionCreate, conn: DB):
    """Create a new locally-entered transaction."""
    txn_id = "local-" + str(uuid.uuid4())
    txn_type = classify(body.category)

    # Apply sign convention: Expense default negative, but "+" sign means reimbursement (positive)
    if txn_type == "Expense":
        stored_amount = abs(body.amount) if body.sign == "+" else -abs(body.amount)
    elif txn_type == "Income":
        stored_amount = abs(body.amount)
    else:
        # Transfer / Finance: apply sign explicitly (amount from UI is always positive)
        stored_amount = abs(body.amount) if body.sign == "+" else -abs(body.amount)

    conn.execute(
        """INSERT OR IGNORE INTO transactions
             (id, source, notion_id, date, name, amount, account, category,
              subcategory, transaction_type, notes, source_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (txn_id, "local", None, body.date, body.name, stored_amount,
         body.account, body.category, body.subcategory, txn_type, body.notes,
         body.source_id),
    )
    conn.commit()
    # If source_id already exists, IGNORE silently — return the existing row
    if body.source_id:
        existing = conn.execute(
            "SELECT * FROM transactions WHERE source_id=?", (body.source_id,)
        ).fetchone()
        if existing:
            return _row_to_txn(existing)
    row = conn.execute("SELECT * FROM transactions WHERE id=?", (txn_id,)).fetchone()
    return _row_to_txn(row)


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    conn: DB,
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    category: Optional[str] = Query(None),
    account: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    clauses = ["deleted_at IS NULL"]
    params: list = []

    if start:
        clauses.append("date >= ?")
        params.append(start)
    if end:
        clauses.append("date <= ?")
        params.append(end)
    if category:
        clauses.append("category = ?")
        params.append(category)
    if account:
        clauses.append("account = ?")
        params.append(account)

    where = " AND ".join(clauses)
    params += [limit, offset]

    rows = conn.execute(
        f"SELECT * FROM transactions WHERE {where} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    return [_row_to_txn(r) for r in rows]


@router.patch("/transactions/{txn_id}", response_model=TransactionOut)
def patch_transaction(txn_id: str, body: TransactionPatch, conn: DB):
    row = conn.execute(
        "SELECT * FROM transactions WHERE id=? AND deleted_at IS NULL", (txn_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return _row_to_txn(row)

    # Recalculate transaction_type if category changed
    if "category" in updates:
        updates["transaction_type"] = classify(updates["category"])

    # Apply sign convention for amount changes
    if "amount" in updates:
        txn_type = updates.get("transaction_type", row["transaction_type"])
        sign = updates.pop("sign", None)  # remove sign from DB updates; handle it here
        if txn_type == "Expense":
            updates["amount"] = abs(updates["amount"]) if sign == "+" else -abs(updates["amount"])
        elif txn_type == "Income":
            updates["amount"] = abs(updates["amount"])
        else:
            # Transfer / Finance: respect the sign if explicitly provided, otherwise keep as-is
            updates["amount"] = abs(updates["amount"]) if sign == "+" else -abs(updates["amount"]) if sign == "-" else updates["amount"]
    else:
        updates.pop("sign", None)  # sign without amount is a no-op — don't write it to DB

    # Editing any field marks the row as locally owned (Notion sync won't overwrite it)
    updates["source"] = "local"
    updates["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    _WRITABLE_COLS = {
        "date", "name", "amount", "category", "subcategory", "account",
        "notes", "transaction_type", "source", "updated_at",
    }
    updates = {k: v for k, v in updates.items() if k in _WRITABLE_COLS}

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    conn.execute(
        f"UPDATE transactions SET {set_clause} WHERE id = ?",
        (*updates.values(), txn_id),
    )
    conn.commit()
    return _row_to_txn(conn.execute("SELECT * FROM transactions WHERE id=?", (txn_id,)).fetchone())


@router.delete("/transactions/{txn_id}")
def delete_transaction(txn_id: str, conn: DB):
    row = conn.execute(
        "SELECT id FROM transactions WHERE id=? AND deleted_at IS NULL", (txn_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    conn.execute(
        "UPDATE transactions SET deleted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), source='local' WHERE id=?",
        (txn_id,),
    )
    conn.commit()
    return {"status": "deleted"}


# ── Autocomplete ───────────────────────────────────────────────────────────────

@router.get("/autocomplete/merchants", response_model=list[MerchantSuggestion])
def autocomplete_merchants(
    conn: DB,
    q: str = Query("", min_length=0),
):
    if not q:
        rows = conn.execute(
            """SELECT name, MAX(date) as last_used, category
               FROM transactions
               WHERE transaction_type = 'Expense' AND deleted_at IS NULL
               GROUP BY name
               ORDER BY last_used DESC
               LIMIT 10"""
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT name, MAX(date) as last_used, category
               FROM transactions
               WHERE name LIKE ? AND transaction_type = 'Expense' AND deleted_at IS NULL
               GROUP BY name
               ORDER BY last_used DESC
               LIMIT 10""",
            (f"{q}%",),
        ).fetchall()
    return [MerchantSuggestion(name=r["name"], last_used=r["last_used"] or "", category=r["category"]) for r in rows]


@router.get("/autocomplete/subcategories", response_model=list[str])
def autocomplete_subcategories(
    conn: DB,
    category: str = Query(...),
    q: str = Query("", min_length=0),
):
    """Return distinct subcategories for a given category, filtered by optional prefix."""
    if q:
        rows = conn.execute(
            """SELECT DISTINCT subcategory FROM transactions
               WHERE category = ? AND subcategory IS NOT NULL AND subcategory LIKE ? AND deleted_at IS NULL
               ORDER BY subcategory LIMIT 20""",
            (category, f"{q}%"),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT DISTINCT subcategory FROM transactions
               WHERE category = ? AND subcategory IS NOT NULL AND deleted_at IS NULL
               ORDER BY subcategory LIMIT 20""",
            (category,),
        ).fetchall()
    return [r["subcategory"] for r in rows]


# ── Meta / reference data ──────────────────────────────────────────────────────

@router.get("/meta", response_model=MoneyMeta)
def get_meta(conn: DB):
    # Distinct accounts from DB, ordered by most recent use
    account_rows = conn.execute(
        """SELECT account FROM transactions
           WHERE account IS NOT NULL AND deleted_at IS NULL
           GROUP BY account
           ORDER BY MAX(date) DESC"""
    ).fetchall()
    accounts = [r["account"] for r in account_rows]

    # Last-used category and account
    last_row = conn.execute(
        """SELECT category, account FROM transactions
           WHERE source = 'local' AND transaction_type = 'Expense' AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1"""
    ).fetchone()

    defaults = {
        "category": last_row["category"] if last_row else "Restaurant",
        "account": last_row["account"] if last_row else (accounts[0] if accounts else ""),
    }

    # Include special categories (Income, Transfer, etc.) after expense categories
    SPECIAL_UI_CATS = ["Income", "OMYRA", "Transfer", "Finance"]
    all_cats = list(EXPENSE_CATEGORIES) + [c for c in SPECIAL_UI_CATS if c not in EXPENSE_CATEGORIES]
    categories = [
        CategoryMeta(key=c, emoji=CATEGORY_EMOJI.get(c, "💳"))
        for c in all_cats
    ]

    return MoneyMeta(categories=categories, accounts=accounts, defaults=defaults)


# ── Month summary / budget ─────────────────────────────────────────────────────

@router.get("/summary/month", response_model=MonthSummary)
def month_summary(
    conn: DB,
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current month"),
):
    if not month:
        month = date.today().strftime("%Y-%m")

    year, mon = int(month[:4]), int(month[5:7])
    dim = _days_in_month(year, mon)
    today = date.today()
    days_elapsed = min(today.day, dim) if today.strftime("%Y-%m") == month else dim

    # Total spent (expenses only)
    spent_row = conn.execute(
        """SELECT COALESCE(-SUM(amount), 0) as total
           FROM transactions
           WHERE strftime('%Y-%m', date) = ?
             AND transaction_type = 'Expense'
             AND deleted_at IS NULL""",
        (month,),
    ).fetchone()
    total_spent = max(0.0, spent_row["total"])

    # Total income
    income_row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE strftime('%Y-%m', date) = ?
             AND transaction_type = 'Income'
             AND deleted_at IS NULL""",
        (month,),
    ).fetchone()
    total_income = income_row["total"]

    # Per-category spending
    cat_rows = conn.execute(
        """SELECT category, COALESCE(-SUM(amount), 0) as spent
           FROM transactions
           WHERE strftime('%Y-%m', date) = ?
             AND transaction_type = 'Expense'
             AND deleted_at IS NULL
           GROUP BY category
           ORDER BY spent DESC""",
        (month,),
    ).fetchall()

    budget = get_budget_for_month(month)
    total_budget = sum(budget.values())
    pct_time = days_elapsed / dim if dim > 0 else 1

    categories: list[CategoryBudget] = []
    for row in cat_rows:
        cat = row["category"] or "Other"
        spent = max(0.0, row["spent"])  # reimbursements can make net negative; floor at 0
        bgt = budget.get(cat, 0.0)
        remaining = bgt - spent
        vel = (spent / bgt / pct_time) if bgt > 0 and pct_time > 0 else 0.0
        categories.append(CategoryBudget(
            category=cat,
            spent=round(spent, 2),
            budget=round(bgt, 2),
            remaining=round(remaining, 2),
            velocity=round(vel, 2),
            status=_budget_status(spent, bgt, vel),
        ))

    # Overall velocity
    overall_vel = (total_spent / total_budget / pct_time) if total_budget > 0 and pct_time > 0 else 0.0

    return MonthSummary(
        month=month,
        total_spent=round(total_spent, 2),
        total_income=round(total_income, 2),
        total_budget=round(total_budget, 2),
        days_elapsed=days_elapsed,
        days_in_month=dim,
        velocity=round(overall_vel, 2),
        categories=categories,
    )


# ── Trends ────────────────────────────────────────────────────────────────────

from domains.money.money_config import MONTHLY_SAVINGS_GOAL  # noqa: E402


@router.get("/trends", response_model=TrendsData)
def get_trends(
    conn: DB,
    months: int = Query(12, ge=1, le=60, description="How many completed months to include"),
):
    """Historical month-by-month spending, income, savings, and streak data."""
    today = date.today()
    current_month = today.strftime("%Y-%m")

    # Gather all distinct months with data, excluding current (incomplete) month
    month_rows = conn.execute(
        """
        SELECT strftime('%Y-%m', date) AS month,
               COALESCE(-SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) AS spent,
               COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount         ELSE 0 END), 0) AS income
        FROM   transactions
        WHERE  deleted_at IS NULL
          AND  strftime('%Y-%m', date) < ?
        GROUP BY month
        ORDER BY month DESC
        LIMIT ?
        """,
        (current_month, months),
    ).fetchall()

    history: list[MonthHistory] = []
    for r in month_rows:
        m = r["month"]
        spent = round(r["spent"], 2)
        income = round(r["income"], 2)
        savings = round(income - spent, 2)
        savings_rate = round(savings / income, 4) if income > 0 else 0.0
        budget = get_budget_for_month(m)
        total_budget = sum(budget.values())
        on_budget = savings >= MONTHLY_SAVINGS_GOAL
        history.append(MonthHistory(
            month=m,
            total_spent=spent,
            total_income=income,
            savings=savings,
            savings_rate=savings_rate,
            total_budget=round(total_budget, 2),
            on_budget=on_budget,
        ))

    # Savings streak (consecutive months on budget, most-recent first)
    current_streak = 0
    for h in history:
        if h.on_budget:
            current_streak += 1
        else:
            break

    best_streak = 0
    run = 0
    for h in history:
        if h.on_budget:
            run += 1
            best_streak = max(best_streak, run)
        else:
            run = 0

    success_count = sum(1 for h in history if h.on_budget)
    success_rate = round(success_count / len(history), 4) if history else 0.0

    avg_spent = round(sum(h.total_spent for h in history) / len(history), 2) if history else 0.0
    avg_income = round(sum(h.total_income for h in history) / len(history), 2) if history else 0.0
    avg_savings_rate = round(sum(h.savings_rate for h in history) / len(history), 4) if history else 0.0

    return TrendsData(
        months=list(reversed(history)),  # chronological order for charts
        savings_streak=SavingsStreak(
            current_streak=current_streak,
            best_streak=best_streak,
            success_rate=success_rate,
        ),
        avg_monthly_spent=avg_spent,
        avg_monthly_income=avg_income,
        avg_savings_rate=avg_savings_rate,
    )


@router.get("/trends/categories", response_model=CategoryTrendsData)
def get_category_trends(
    conn: DB,
    months: int = Query(12, ge=1, le=60),
):
    """Historical per-category spending for the last N completed months."""
    today = date.today()
    current_month = today.strftime("%Y-%m")
    rows = conn.execute("""
        SELECT strftime('%Y-%m', date) AS month,
               category,
               COALESCE(-SUM(amount), 0) AS spent
        FROM transactions
        WHERE deleted_at IS NULL
          AND transaction_type = 'Expense'
          AND strftime('%Y-%m', date) < ?
        GROUP BY month, category
        ORDER BY month DESC
        LIMIT ?
    """, (current_month, months * 20)).fetchall()  # * 20 for multiple categories per month

    # Collect distinct months in DESC order, up to `months` count
    seen_months: list[str] = []
    for r in rows:
        if r["month"] not in seen_months:
            seen_months.append(r["month"])
        if len(seen_months) >= months:
            break

    month_set = set(seen_months)
    items = [
        CategoryMonthSpend(category=r["category"] or "Other", month=r["month"], spent=round(r["spent"], 2))
        for r in rows if r["month"] in month_set
    ]
    categories = sorted(set(i.category for i in items))
    return CategoryTrendsData(
        items=items,
        months=sorted(seen_months),
        categories=categories,
    )


# ── Month overview (deep-dive with burn rate & projections) ────────────────────

@router.get("/overview", response_model=MonthOverview)
def month_overview(
    conn: DB,
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current month"),
):
    """Current month deep-dive with burn rate, projections, and alerts."""
    if not month:
        month = date.today().strftime("%Y-%m")

    year, mon = int(month[:4]), int(month[5:7])
    dim = _days_in_month(year, mon)
    today = date.today()
    days_elapsed = min(today.day, dim) if today.strftime("%Y-%m") == month else dim
    if days_elapsed == 0:
        days_elapsed = 1

    spent_row = conn.execute(
        """SELECT COALESCE(-SUM(amount), 0) as total FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Expense' AND deleted_at IS NULL""",
        (month,)
    ).fetchone()
    total_spent = spent_row["total"]

    income_row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Income' AND deleted_at IS NULL""",
        (month,)
    ).fetchone()
    total_income = income_row["total"]

    cat_rows = conn.execute(
        """SELECT category, COALESCE(-SUM(amount), 0) as spent FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Expense' AND deleted_at IS NULL
           GROUP BY category ORDER BY spent DESC""",
        (month,)
    ).fetchall()

    budget = get_budget_for_month(month)
    total_budget = sum(budget.values())
    pct_time = days_elapsed / dim if dim > 0 else 1

    categories: list[CategoryBudget] = []
    alerts: list[BudgetAlert] = []
    fixed_spent = 0.0
    disc_spent = 0.0
    for row in cat_rows:
        cat = row["category"] or "Other"
        spent = max(0.0, row["spent"])  # floor at 0 when reimbursements exceed spending
        bgt = budget.get(cat, 0.0)
        remaining = bgt - spent
        is_fixed = cat in FIXED_RECURRING_CATEGORIES
        if is_fixed:
            fixed_spent += spent
            # A fixed bill is amortised over the whole month: pace is meaningless,
            # only exceeding the budget matters.
            vel = (spent / bgt) if bgt > 0 else 0.0
            status = "Over Budget" if bgt > 0 and spent > bgt else ("No Budget" if bgt == 0 else "OK")
        else:
            disc_spent += spent
            vel = (spent / bgt / pct_time) if bgt > 0 and pct_time > 0 else 0.0
            status = _budget_status(spent, bgt, vel)
        categories.append(CategoryBudget(
            category=cat, spent=round(spent, 2), budget=round(bgt, 2),
            remaining=round(remaining, 2), velocity=round(vel, 2), status=status,
            is_fixed=is_fixed,
        ))
        if status in ("Over Budget", "Over Pace"):
            alerts.append(BudgetAlert(
                category=cat, velocity=round(vel, 2), spent=round(spent, 2),
                budget=round(bgt, 2), status=status,
            ))

    fixed_budget = sum(v for k, v in budget.items() if k in FIXED_RECURRING_CATEGORIES)
    disc_budget = total_budget - fixed_budget

    overall_vel = (total_spent / total_budget / pct_time) if total_budget > 0 and pct_time > 0 else 0.0
    adj_vel = (disc_spent / disc_budget / pct_time) if disc_budget > 0 and pct_time > 0 else 0.0
    daily_burn = total_spent / days_elapsed if days_elapsed > 0 else 0.0
    projected = daily_burn * dim
    projected_savings = total_income - projected
    # Adjusted projection: discretionary extrapolates by pace; fixed bills count
    # as the full monthly amount (or actual, once it exceeds the budget).
    disc_burn = disc_spent / days_elapsed if days_elapsed > 0 else 0.0
    projected_adj = disc_burn * dim + max(fixed_spent, fixed_budget)
    projected_savings_adj = total_income - projected_adj

    return MonthOverview(
        month=month,
        total_spent=round(total_spent, 2),
        total_income=round(total_income, 2),
        total_budget=round(total_budget, 2),
        days_elapsed=days_elapsed,
        days_in_month=dim,
        velocity=round(overall_vel, 2),
        daily_burn_rate=round(daily_burn, 2),
        projected_month_end=round(projected, 2),
        projected_savings=round(projected_savings, 2),
        categories=categories,
        alerts=alerts,
        adjusted_velocity=round(adj_vel, 2),
        fixed_spent=round(fixed_spent, 2),
        fixed_budget=round(fixed_budget, 2),
        discretionary_spent=round(disc_spent, 2),
        discretionary_budget=round(disc_budget, 2),
        projected_month_end_adjusted=round(projected_adj, 2),
        projected_savings_adjusted=round(projected_savings_adj, 2),
    )


# ── Historical trends (MoM / YoY comparisons) ─────────────────────────────────

@router.get("/trends/historical", response_model=HistoricalData)
def get_historical(
    conn: DB,
    months: int = Query(24, ge=1, le=60),
):
    today = date.today()
    current_month = today.strftime("%Y-%m")

    rows = conn.execute(
        """SELECT strftime('%Y-%m', date) AS month,
                  COALESCE(-SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) AS spent,
                  COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount         ELSE 0 END), 0) AS income
           FROM transactions
           WHERE deleted_at IS NULL AND strftime('%Y-%m', date) < ?
           GROUP BY month ORDER BY month DESC LIMIT ?""",
        (current_month, months)
    ).fetchall()

    # Build dict for MoM/YoY lookups
    data: dict[str, dict] = {}
    for r in rows:
        m, spent, income = r["month"], round(r["spent"], 2), round(r["income"], 2)
        savings = round(income - spent, 2)
        data[m] = {"income": income, "spent": spent, "savings": savings,
                   "savings_rate": round(savings / income, 4) if income > 0 else 0.0}

    months_list = sorted(data.keys())

    details: list[MonthDetail] = []
    for i, m in enumerate(months_list):
        d = data[m]
        # MoM
        mom_inc = mom_exp = None
        if i > 0:
            prev = data[months_list[i - 1]]
            if prev["income"] > 0:
                mom_inc = round((d["income"] - prev["income"]) / prev["income"], 4)
            if prev["spent"] > 0:
                mom_exp = round((d["spent"] - prev["spent"]) / prev["spent"], 4)
        # YoY
        yoy_inc = yoy_exp = None
        yr, mn = m[:4], m[5:]
        prev_yr_m = f"{int(yr)-1}-{mn}"
        if prev_yr_m in data:
            pv = data[prev_yr_m]
            if pv["income"] > 0:
                yoy_inc = round((d["income"] - pv["income"]) / pv["income"], 4)
            if pv["spent"] > 0:
                yoy_exp = round((d["spent"] - pv["spent"]) / pv["spent"], 4)

        details.append(MonthDetail(
            month=m, income=d["income"], spent=d["spent"],
            savings=d["savings"], savings_rate=d["savings_rate"],
            mom_income_pct=mom_inc, mom_expenses_pct=mom_exp,
            yoy_income_pct=yoy_inc, yoy_expenses_pct=yoy_exp,
        ))

    avg_inc = round(sum(d["income"] for d in data.values()) / len(data), 2) if data else 0.0
    avg_sp = round(sum(d["spent"] for d in data.values()) / len(data), 2) if data else 0.0
    avg_sr = round(sum(d["savings_rate"] for d in data.values()) / len(data), 4) if data else 0.0

    return HistoricalData(months=details, avg_monthly_income=avg_inc,
                          avg_monthly_spent=avg_sp, avg_savings_rate=avg_sr)


# ── Forecast (3-month rolling average) ────────────────────────────────────────

@router.get("/trends/forecast", response_model=ForecastData)
def get_forecast(conn: DB):
    today = date.today()
    current_month = today.strftime("%Y-%m")

    rows = conn.execute(
        """SELECT strftime('%Y-%m', date) AS month,
                  COALESCE(-SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) AS spent,
                  COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount         ELSE 0 END), 0) AS income
           FROM transactions
           WHERE deleted_at IS NULL AND strftime('%Y-%m', date) < ?
           GROUP BY month ORDER BY month DESC LIMIT 3""",
        (current_month,)
    ).fetchall()

    if not rows:
        return ForecastData(predicted_spent=0, predicted_income=0, predicted_savings=0, based_on_months=[])

    months_used = [r["month"] for r in rows]
    avg_spent = round(sum(r["spent"] for r in rows) / len(rows), 2)
    avg_income = round(sum(r["income"] for r in rows) / len(rows), 2)

    return ForecastData(
        predicted_spent=avg_spent,
        predicted_income=avg_income,
        predicted_savings=round(avg_income - avg_spent, 2),
        based_on_months=months_used,
    )


# ── Portfolio / account balances ───────────────────────────────────────────────

@router.get("/portfolio", response_model=PortfolioSummary)
def get_portfolio(conn: DB):
    """Calculate account balances using Account Setup as reference point."""
    account_rows = conn.execute(
        """SELECT DISTINCT account FROM transactions
           WHERE account IS NOT NULL AND deleted_at IS NULL"""
    ).fetchall()

    accounts: list[AccountBalance] = []

    for ar in account_rows:
        acct = ar["account"]

        # Find latest Account Setup for this account
        setup = conn.execute(
            """SELECT amount, date FROM transactions
               WHERE account=? AND category='Account Setup' AND deleted_at IS NULL
               ORDER BY date DESC LIMIT 1""",
            (acct,)
        ).fetchone()

        if setup:
            initial = setup["amount"]
            cutoff = setup["date"]
            subsequent = conn.execute(
                """SELECT COALESCE(SUM(amount), 0) as net FROM transactions
                   WHERE account=? AND date > ? AND category != 'Account Setup' AND deleted_at IS NULL""",
                (acct, cutoff)
            ).fetchone()["net"]
            balance = initial + subsequent
        else:
            # No setup entry — sum all transactions
            balance = conn.execute(
                """SELECT COALESCE(SUM(amount), 0) as net FROM transactions
                   WHERE account=? AND category != 'Account Setup' AND deleted_at IS NULL""",
                (acct,)
            ).fetchone()["net"]

        # Classify account type
        if acct in INVESTMENT_ACCOUNTS:
            acct_type = INVESTMENT_ACCOUNTS[acct]
        elif acct in LIQUID_ACCOUNTS:
            acct_type = LIQUID_ACCOUNTS[acct]
        else:
            acct_type = "Unknown"

        accounts.append(AccountBalance(name=acct, balance=round(balance, 2), account_type=acct_type))

    # Sort by balance descending
    accounts.sort(key=lambda a: a.balance, reverse=True)

    total_net = sum(a.balance for a in accounts)
    total_inv = sum(a.balance for a in accounts if a.account_type in ("Investment", "Crypto Investment"))
    total_liq = sum(a.balance for a in accounts if a.account_type in ("Checking", "Savings"))

    return PortfolioSummary(
        accounts=accounts,
        total_net_worth=round(total_net, 2),
        total_investments=round(total_inv, 2),
        total_liquid=round(total_liq, 2),
        investment_pct=round(total_inv / total_net * 100, 1) if total_net > 0 else 0.0,
        liquid_pct=round(total_liq / total_net * 100, 1) if total_net > 0 else 0.0,
    )


# ── Spending patterns (by day-of-week and week-of-month) ──────────────────────

@router.get("/spending/patterns", response_model=SpendingPatterns)
def get_spending_patterns(
    conn: DB,
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current month"),
):
    if not month:
        month = date.today().strftime("%Y-%m")

    DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    day_rows = conn.execute(
        """SELECT strftime('%w', date) AS dow,
                  COALESCE(-SUM(amount), 0) AS total
           FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Expense' AND deleted_at IS NULL
           GROUP BY dow ORDER BY dow""",
        (month,)
    ).fetchall()

    by_day_map = {str(i): 0.0 for i in range(7)}
    for r in day_rows:
        by_day_map[r["dow"]] = round(r["total"], 2)

    by_day = [DaySpend(day_name=DAY_NAMES[i], total=by_day_map[str(i)]) for i in range(7)]

    week_rows = conn.execute(
        """SELECT CAST(strftime('%d', date) AS INTEGER) AS day_num,
                  COALESCE(-SUM(amount), 0) AS total
           FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Expense' AND deleted_at IS NULL
           GROUP BY day_num ORDER BY day_num""",
        (month,)
    ).fetchall()

    week_map: dict[int, float] = {}
    for r in week_rows:
        week_num = (r["day_num"] - 1) // 7 + 1
        week_map[week_num] = week_map.get(week_num, 0.0) + r["total"]

    by_week = [WeekSpend(week_num=wk, total=round(tot, 2)) for wk, tot in sorted(week_map.items())]

    return SpendingPatterns(by_day=by_day, by_week=by_week)


# ── Category lifetime stats ────────────────────────────────────────────────────

@router.get("/categories/stats", response_model=list[CategoryStats])
def get_category_stats(
    conn: DB,
    months: int = Query(12, ge=1, le=60),
):
    today = date.today()
    current_month = today.strftime("%Y-%m")
    start_month = today.replace(day=1)
    from datetime import timedelta
    for _ in range(months - 1):
        start_month = (start_month - timedelta(days=1)).replace(day=1)
    start_str = start_month.strftime("%Y-%m")

    rows = conn.execute(
        """SELECT category,
                  COALESCE(-SUM(amount), 0) AS total,
                  COUNT(*) AS cnt,
                  MIN(ABS(amount)) AS min_tx,
                  MAX(ABS(amount)) AS max_tx,
                  COUNT(DISTINCT strftime('%Y-%m', date)) AS num_months
           FROM transactions
           WHERE deleted_at IS NULL AND transaction_type='Expense'
             AND strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) < ?
           GROUP BY category ORDER BY total DESC""",
        (start_str, current_month)
    ).fetchall()

    # Subcategory breakdown per category
    sub_rows = conn.execute(
        """SELECT category, subcategory,
                  COALESCE(-SUM(amount), 0) AS total,
                  COUNT(*) AS cnt,
                  MIN(ABS(amount)) AS min_tx,
                  MAX(ABS(amount)) AS max_tx
           FROM transactions
           WHERE deleted_at IS NULL AND transaction_type='Expense'
             AND subcategory IS NOT NULL AND subcategory != ''
             AND strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) < ?
           GROUP BY category, subcategory ORDER BY total DESC""",
        (start_str, current_month)
    ).fetchall()

    def _variance_flag(min_tx: float, max_tx: float, count: int, total: float) -> bool:
        if count <= 3 or count == 0:
            return False
        avg = total / count
        return avg > 0 and (max_tx - min_tx) > 2 * avg

    subs_by_cat: dict[str, list[SubcategoryBreakdown]] = {}
    for s in sub_rows:
        cat = s["category"] or "Other"
        if cat not in subs_by_cat:
            subs_by_cat[cat] = []
        subs_by_cat[cat].append(SubcategoryBreakdown(
            subcategory=s["subcategory"],
            total=round(s["total"], 2),
            count=s["cnt"],
            variance_flag=_variance_flag(s["min_tx"], s["max_tx"], s["cnt"], s["total"]),
        ))

    grand_total = sum(r["total"] for r in rows) or 1.0

    result: list[CategoryStats] = []
    for r in rows:
        cat = r["category"] or "Other"
        total = round(r["total"], 2)
        nm = r["num_months"] if r["num_months"] > 0 else 1
        result.append(CategoryStats(
            category=cat,
            total=total,
            avg_per_month=round(total / nm, 2),
            count=r["cnt"],
            min_tx=round(r["min_tx"], 2),
            max_tx=round(r["max_tx"], 2),
            pct_of_total=round(total / grand_total * 100, 1),
            subcategories=subs_by_cat.get(cat, []),
            variance_flag=_variance_flag(r["min_tx"], r["max_tx"], r["cnt"], total),
        ))

    return result


# ── CSV Export ────────────────────────────────────────────────────────────────

@router.get("/transactions/export")
def export_transactions(conn: DB):
    """Download all transactions as CSV."""
    rows = conn.execute(
        """SELECT date, name, amount, category, account, transaction_type, notes, source
           FROM transactions
           WHERE deleted_at IS NULL
           ORDER BY date DESC, created_at DESC"""
    ).fetchall()

    def generate():
        buf = io.StringIO()
        writer = _csv.writer(buf)
        writer.writerow(["date", "name", "amount", "category", "account", "transaction_type", "notes", "source"])
        for r in rows:
            writer.writerow([r["date"], r["name"], r["amount"], r["category"] or "",
                             r["account"] or "", r["transaction_type"], r["notes"] or "", r["source"]])
        yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )


# ── Anomaly Detection ─────────────────────────────────────────────────────────

@router.get("/anomalies", response_model=AnomalyReport)
def get_anomalies(
    conn: DB,
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current month"),
):
    """Flag unusually large transactions and category spending spikes."""
    if not month:
        month = date.today().strftime("%Y-%m")

    # --- Per-category avg transaction size over last 12 completed months ---
    cat_avg_rows = conn.execute(
        """SELECT category, AVG(ABS(amount)) as avg_amt
           FROM transactions
           WHERE transaction_type = 'Expense'
             AND deleted_at IS NULL
             AND strftime('%Y-%m', date) < ?
           GROUP BY category""",
        (month,),
    ).fetchall()
    cat_avg: dict[str, float] = {r["category"]: r["avg_amt"] for r in cat_avg_rows if r["category"]}

    # --- Flag large transactions in target month (> 3× category avg) ---
    txn_rows = conn.execute(
        """SELECT id, date, name, amount, category, account
           FROM transactions
           WHERE transaction_type = 'Expense'
             AND deleted_at IS NULL
             AND strftime('%Y-%m', date) = ?""",
        (month,),
    ).fetchall()

    large_txns: list[LargeTxAnomaly] = []
    for r in txn_rows:
        cat = r["category"]
        avg = cat_avg.get(cat, 0.0)
        if avg > 0 and abs(r["amount"]) > 3 * avg:
            large_txns.append(LargeTxAnomaly(
                id=r["id"], date=r["date"], name=r["name"], amount=r["amount"],
                category=cat, account=r["account"],
                ratio=round(abs(r["amount"]) / avg, 1),
            ))

    # --- Per-category avg monthly spend over last 12 completed months ---
    hist_rows = conn.execute(
        """SELECT category,
                  strftime('%Y-%m', date) AS mon,
                  -SUM(amount) AS spent
           FROM transactions
           WHERE transaction_type = 'Expense'
             AND deleted_at IS NULL
             AND strftime('%Y-%m', date) < ?
           GROUP BY category, mon""",
        (month,),
    ).fetchall()

    # Build {category: [monthly_spent]} with at least 3 months of data
    from collections import defaultdict
    cat_history: dict[str, list[float]] = defaultdict(list)
    for r in hist_rows:
        if r["category"]:
            cat_history[r["category"]].append(max(0.0, r["spent"]))

    # Current month spending per category
    cur_rows = conn.execute(
        """SELECT category, -SUM(amount) AS spent
           FROM transactions
           WHERE transaction_type = 'Expense'
             AND deleted_at IS NULL
             AND strftime('%Y-%m', date) = ?
           GROUP BY category""",
        (month,),
    ).fetchall()

    spikes: list[CategorySpikeAnomaly] = []
    for r in cur_rows:
        cat = r["category"]
        if not cat:
            continue
        history = cat_history.get(cat, [])
        if len(history) < 3:
            continue  # not enough history
        avg = sum(history) / len(history)
        current = max(0.0, r["spent"])
        if avg > 0 and current > 1.5 * avg:
            spikes.append(CategorySpikeAnomaly(
                category=cat,
                current_spent=round(current, 2),
                avg_spent=round(avg, 2),
                ratio=round(current / avg, 2),
            ))

    spikes.sort(key=lambda s: s.ratio, reverse=True)

    return AnomalyReport(
        month=month,
        large_transactions=large_txns,
        category_spikes=spikes,
    )


# ── Intelligence layer (Track A-II) ───────────────────────────────────────────

def _month_shift(month: str, delta: int) -> str:
    """YYYY-MM shifted by delta months."""
    y, m = int(month[:4]), int(month[5:7])
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _completed_month_series(
    conn: sqlite3.Connection, window_months: int
) -> list[MonthlySeriesPoint]:
    """Expenses/income/savings per completed month, ascending, over the window."""
    current_month = date.today().strftime("%Y-%m")
    start = _month_shift(current_month, -window_months)
    rows = conn.execute(
        """SELECT strftime('%Y-%m', date) AS mon,
                  COALESCE(-SUM(CASE WHEN transaction_type='Expense' THEN amount END), 0) AS expenses,
                  COALESCE(SUM(CASE WHEN transaction_type='Income' THEN amount END), 0) AS income
           FROM transactions
           WHERE deleted_at IS NULL
             AND strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) < ?
           GROUP BY mon ORDER BY mon""",
        (start, current_month),
    ).fetchall()
    return [
        MonthlySeriesPoint(
            month=r["mon"],
            expenses=round(r["expenses"], 2),
            income=round(r["income"], 2),
            savings=round(r["income"] - r["expenses"], 2),
        )
        for r in rows
    ]


@router.get("/waterfall", response_model=WaterfallData)
def get_waterfall(
    conn: DB,
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current month"),
):
    """Income → per-category expenses → savings, for a waterfall chart."""
    if not month:
        month = date.today().strftime("%Y-%m")

    income_row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Income' AND deleted_at IS NULL""",
        (month,),
    ).fetchone()
    income = income_row["total"]

    cat_rows = conn.execute(
        """SELECT category, COALESCE(-SUM(amount), 0) AS spent FROM transactions
           WHERE strftime('%Y-%m', date)=? AND transaction_type='Expense' AND deleted_at IS NULL
           GROUP BY category HAVING spent > 0 ORDER BY spent DESC""",
        (month,),
    ).fetchall()

    categories = [
        WaterfallItem(name=r["category"] or "Other", amount=round(r["spent"], 2))
        for r in cat_rows
    ]
    total_expenses = sum(c.amount for c in categories)
    savings = income - total_expenses

    return WaterfallData(
        month=month,
        income=round(income, 2),
        categories=categories,
        savings=round(savings, 2),
        savings_rate=round(savings / income, 4) if income > 0 else 0.0,
    )


@router.get("/efficiency", response_model=EfficiencyData)
def get_efficiency(
    conn: DB,
    window: int = Query(12, ge=3, le=60, description="Window in completed months"),
):
    """Per-category recoverable savings: actual avg vs budget vs an aggressive cap
    (25th percentile of historical monthly spend)."""
    current_month = date.today().strftime("%Y-%m")
    start = _month_shift(current_month, -window)
    budget = get_budget_for_month(current_month)

    rows = conn.execute(
        """SELECT category, strftime('%Y-%m', date) AS mon, -SUM(amount) AS spent
           FROM transactions
           WHERE deleted_at IS NULL AND transaction_type='Expense'
             AND strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) < ?
           GROUP BY category, mon""",
        (start, current_month),
    ).fetchall()

    from collections import defaultdict
    per_cat: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        per_cat[r["category"] or "Other"].append(max(0.0, r["spent"]))

    def _p25(values: list[float]) -> float:
        s = sorted(values)
        if not s:
            return 0.0
        # Linear-interpolated 25th percentile
        k = 0.25 * (len(s) - 1)
        lo = int(k)
        hi = min(lo + 1, len(s) - 1)
        return s[lo] + (s[hi] - s[lo]) * (k - lo)

    out: list[EfficiencyRow] = []
    for cat, spends in per_cat.items():
        if len(spends) < 3:
            continue  # not enough history for a meaningful cap
        avg_actual = sum(spends) / len(spends)
        bgt = budget.get(cat, 0.0)
        cap = min(bgt, _p25(spends)) if bgt > 0 else _p25(spends)
        recoverable = max(0.0, avg_actual - cap)
        if bgt > 0 and avg_actual > bgt:
            flag = "over_budget"
        elif recoverable > 1.0:
            flag = "recoverable"
        else:
            flag = "efficient"
        out.append(EfficiencyRow(
            category=cat,
            avg_actual=round(avg_actual, 2),
            budget=round(bgt, 2),
            aggressive_cap=round(cap, 2),
            recoverable_per_month=round(recoverable, 2),
            flag=flag,
        ))

    out.sort(key=lambda r: r.recoverable_per_month, reverse=True)
    return EfficiencyData(
        window_months=window,
        rows=out,
        total_recoverable=round(sum(r.recoverable_per_month for r in out), 2),
    )


@router.get("/anomalies/monthly", response_model=MonthlyAnomalyReport)
def get_monthly_anomalies(
    conn: DB,
    window: int = Query(24, ge=6, le=60, description="Window in completed months"),
):
    """Whole-month outliers: expenses/income/savings vs the window mean (Z-score)."""
    series = _completed_month_series(conn, window)

    anomalies: list[MonthlyAnomaly] = []
    for metric in ("expenses", "income", "savings"):
        values = [getattr(p, metric) for p in series]
        if len(values) < 6:
            continue  # too little history for meaningful Z-scores
        mean = sum(values) / len(values)
        var = sum((v - mean) ** 2 for v in values) / len(values)
        std = var ** 0.5
        if std == 0:
            continue
        for p in series:
            z = (getattr(p, metric) - mean) / std
            if abs(z) >= 2.0:
                anomalies.append(MonthlyAnomaly(
                    month=p.month,
                    metric=metric,
                    value=getattr(p, metric),
                    mean=round(mean, 2),
                    std=round(std, 2),
                    z_score=round(z, 2),
                    severity="high" if abs(z) >= 2.5 else "medium",
                ))

    anomalies.sort(key=lambda a: abs(a.z_score), reverse=True)
    return MonthlyAnomalyReport(window_months=window, series=series, anomalies=anomalies)


@router.get("/seasonal", response_model=SeasonalData)
def get_seasonal(conn: DB):
    """Average expenses/income by calendar month across all completed months."""
    current_month = date.today().strftime("%Y-%m")
    rows = conn.execute(
        """SELECT strftime('%m', date) AS cal_mon,
                  strftime('%Y-%m', date) AS mon,
                  COALESCE(-SUM(CASE WHEN transaction_type='Expense' THEN amount END), 0) AS expenses,
                  COALESCE(SUM(CASE WHEN transaction_type='Income' THEN amount END), 0) AS income
           FROM transactions
           WHERE deleted_at IS NULL AND strftime('%Y-%m', date) < ?
           GROUP BY mon ORDER BY mon""",
        (current_month,),
    ).fetchall()

    LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    from collections import defaultdict
    exp_by_cal: dict[int, list[float]] = defaultdict(list)
    inc_by_cal: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        cal = int(r["cal_mon"])
        exp_by_cal[cal].append(r["expenses"])
        inc_by_cal[cal].append(r["income"])

    months: list[SeasonalMonth] = []
    for m in range(1, 13):
        exps = exp_by_cal.get(m, [])
        incs = inc_by_cal.get(m, [])
        avg_e = sum(exps) / len(exps) if exps else 0.0
        avg_i = sum(incs) / len(incs) if incs else 0.0
        months.append(SeasonalMonth(
            month_num=m,
            label=LABELS[m - 1],
            avg_expenses=round(avg_e, 2),
            avg_income=round(avg_i, 2),
            avg_savings=round(avg_i - avg_e, 2),
            n_years=len(exps),
        ))

    with_data = [m for m in months if m.n_years > 0]
    most_expensive = max(with_data, key=lambda m: m.avg_expenses).label if with_data else None
    cheapest = min(with_data, key=lambda m: m.avg_expenses).label if with_data else None

    return SeasonalData(months=months, most_expensive=most_expensive, cheapest=cheapest)


@router.get("/daily-totals")
def daily_totals(
    conn: DB,
    start: str = Query(...),
    end: str = Query(...),
):
    """
    Per-day spend totals for the week-charts view.
    Returns [{date, total_spend, by_category: {cat: amount}}] for each day in [start, end].
    Only expense transactions (amount < 0) are counted.
    """
    from datetime import datetime, timedelta as td

    rows = conn.execute(
        """
        SELECT date,
               ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) AS total_spend,
               category
        FROM transactions
        WHERE date BETWEEN ? AND ?
          AND deleted_at IS NULL
          AND transaction_type NOT IN ('income', 'transfer', 'finance')
        GROUP BY date, category
        ORDER BY date
        """,
        (start, end),
    ).fetchall()

    # Build spine
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    d1 = datetime.strptime(end, "%Y-%m-%d").date()
    dates = []
    cur = d0
    while cur <= d1:
        dates.append(cur.isoformat())
        cur += td(days=1)

    # Aggregate by date
    by_date: dict[str, dict] = {d: {"date": d, "total_spend": 0.0, "by_category": {}} for d in dates}
    for r in rows:
        dt = r["date"]
        if dt not in by_date:
            continue
        cat = r["category"] or "Other"
        spend = round(float(r["total_spend"] or 0), 2)
        by_date[dt]["by_category"][cat] = spend
        by_date[dt]["total_spend"] = round(by_date[dt]["total_spend"] + spend, 2)

    return list(by_date.values())


# ══════════════════════════════════════════════════════════════════════════════
# Investment Portfolio (Track A-I)
# ══════════════════════════════════════════════════════════════════════════════

def _slugify(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _latest_price_row(conn: sqlite3.Connection, ticker: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        """SELECT date, close_price_eur FROM price_history
           WHERE ticker = ? ORDER BY date DESC LIMIT 1""",
        (ticker,),
    ).fetchone()


def _price_on_or_before(conn: sqlite3.Connection, ticker: str, on_date: str) -> Optional[float]:
    row = conn.execute(
        """SELECT close_price_eur FROM price_history
           WHERE ticker = ? AND date <= ?
           ORDER BY date DESC LIMIT 1""",
        (ticker, on_date),
    ).fetchone()
    return row["close_price_eur"] if row else None


def _holding_row_to_out(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    total_portfolio_value: Optional[float] = None,
) -> HoldingOut:
    """Enrich a raw holdings row with live-computed price/pnl fields."""
    ticker = row["ticker"]
    qty = row["quantity"]
    cost_basis = row["cost_basis_eur"]

    latest = _latest_price_row(conn, ticker)
    current_price = latest["close_price_eur"] if latest else None
    price_as_of = latest["date"] if latest else None
    market_value = current_price * qty if current_price is not None else None

    # Day change: latest vs previous available close
    day_change_eur = None
    day_change_pct = None
    if latest:
        prev = conn.execute(
            """SELECT close_price_eur FROM price_history
               WHERE ticker = ? AND date < ?
               ORDER BY date DESC LIMIT 1""",
            (ticker, latest["date"]),
        ).fetchone()
        if prev and prev["close_price_eur"]:
            prev_price = prev["close_price_eur"]
            day_change_eur = (current_price - prev_price) * qty
            day_change_pct = (current_price / prev_price - 1.0) * 100.0

    # YTD change
    ytd_change_pct = None
    if latest:
        year_start = latest["date"][:4] + "-01-01"
        ytd_row = conn.execute(
            """SELECT close_price_eur FROM price_history
               WHERE ticker = ? AND date >= ?
               ORDER BY date ASC LIMIT 1""",
            (ticker, year_start),
        ).fetchone()
        if ytd_row and ytd_row["close_price_eur"]:
            ytd_change_pct = (current_price / ytd_row["close_price_eur"] - 1.0) * 100.0

    unrealized_pnl_eur = None
    unrealized_pnl_pct = None
    if market_value is not None and cost_basis is not None and cost_basis > 0:
        unrealized_pnl_eur = market_value - cost_basis
        unrealized_pnl_pct = (market_value / cost_basis - 1.0) * 100.0

    allocation_pct = None
    if total_portfolio_value and total_portfolio_value > 0 and market_value is not None:
        allocation_pct = market_value / total_portfolio_value * 100.0

    return HoldingOut(
        id=row["id"],
        account=row["account"],
        ticker=ticker,
        isin=row["isin"] if "isin" in row.keys() else None,
        name=row["name"],
        asset_class=row["asset_class"],
        currency=row["currency"],
        quantity=qty,
        cost_basis_eur=cost_basis,
        first_bought_at=row["first_bought_at"],
        notes=row["notes"],
        is_active=bool(row["is_active"]),
        current_price_eur=current_price,
        market_value_eur=market_value,
        unrealized_pnl_eur=unrealized_pnl_eur,
        unrealized_pnl_pct=unrealized_pnl_pct,
        day_change_eur=day_change_eur,
        day_change_pct=day_change_pct,
        ytd_change_pct=ytd_change_pct,
        price_as_of=price_as_of,
        allocation_pct=allocation_pct,
    )


@router.get("/portfolio/isin-lookup", response_model=IsinLookupResult)
def isin_lookup(isin: str = Query(..., min_length=12, max_length=12)):
    """Resolve an ISIN to yfinance-compatible ticker candidates via OpenFIGI (free, no key).

    Preferred exchanges are ranked first so the user sees a sensible default.
    """
    import re
    import requests

    isin_up = isin.upper().strip()
    if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin_up):
        raise HTTPException(status_code=400, detail="Invalid ISIN format")

    try:
        resp = requests.post(
            "https://api.openfigi.com/v3/mapping",
            json=[{"idType": "ID_ISIN", "idValue": isin_up}],
            headers={"Content-Type": "application/json"},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenFIGI request failed: {e}") from e

    candidates: list[IsinCandidate] = []
    if data and isinstance(data, list) and data[0].get("data"):
        # Preferred exchange codes → yfinance suffix map (major EU + US)
        EXCHANGE_MAP = {
            "GY": ".DE", "GR": ".DE", "GF": ".F", "GM": ".MU", "GD": ".DU",  # Germany
            "SW": ".SW",  # Switzerland
            "SM": ".MC", "SQ": ".MC",  # Spain
            "IX": ".IR",  # Ireland
            "FP": ".PA",  # Paris (Euronext)
            "NA": ".AS",  # Amsterdam
            "BB": ".BR",  # Brussels
            "IM": ".MI",  # Milan
            "LN": ".L",   # London
            "PL": ".LS",  # Lisbon
            "US": "",     # US → no suffix
            "UN": "",     # NYSE
            "UW": "",     # Nasdaq
            "UP": "",
        }
        for item in data[0]["data"]:
            ticker = item.get("ticker")
            if not ticker:
                continue
            exch = item.get("exchCode")
            suffix = EXCHANGE_MAP.get(exch)
            if suffix is None:
                continue  # unknown exchange — skip so we don't send junk to yfinance
            yf_ticker = f"{ticker}{suffix}"
            candidates.append(IsinCandidate(
                ticker=yf_ticker,
                name=item.get("name") or item.get("securityDescription"),
                exchange=item.get("exchCode"),
                exchange_code=exch,
                currency=item.get("currency"),
            ))

        # Rank: EUR-quoted first, then Germany (XETRA), then anything else
        def _rank(c: IsinCandidate) -> tuple:
            eur = 0 if (c.currency or "").upper() == "EUR" else 1
            de = 0 if c.exchange_code in ("GY", "GR") else 1
            return (eur, de)
        candidates.sort(key=_rank)

    return IsinLookupResult(isin=isin_up, candidates=candidates)


@router.get("/portfolio/holdings", response_model=list[HoldingOut])
def list_holdings(
    conn: DB,
    account: Optional[str] = Query(None),
    asset_class: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
):
    where = []
    params: list = []
    if not include_inactive:
        where.append("is_active = 1")
    if account:
        where.append("account = ?")
        params.append(account)
    if asset_class:
        where.append("asset_class = ?")
        params.append(asset_class)
    sql = "SELECT * FROM holdings"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY name"

    rows = conn.execute(sql, params).fetchall()

    # Compute total once so allocation_pct is stable across the list
    enriched_prelim = [_holding_row_to_out(conn, r) for r in rows]
    total = sum((h.market_value_eur or 0.0) for h in enriched_prelim)

    return [_holding_row_to_out(conn, r, total) for r in rows]


@router.post("/portfolio/holdings", response_model=HoldingOut, status_code=201)
def create_holding(body: HoldingCreate, conn: DB):
    holding_id = f"{_slugify(body.account)}-{_slugify(body.ticker)}"
    existing = conn.execute("SELECT id FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"Holding {holding_id} already exists")

    conn.execute(
        """INSERT INTO holdings (id, account, ticker, isin, name, asset_class, currency,
                                 quantity, cost_basis_eur, first_bought_at, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (holding_id, body.account, body.ticker.upper(),
         body.isin.upper() if body.isin else None,
         body.name, body.asset_class,
         body.currency.upper(), body.quantity, body.cost_basis_eur,
         body.first_bought_at, body.notes),
    )
    conn.commit()

    # Fetch today's price synchronously so the holding shows a real value
    # immediately, rather than waiting for the nightly price_sync cron.
    # Best-effort: a slow/failed yfinance call never blocks holding creation.
    from domains.money.price_sync import sync_price_now
    sync_price_now(conn, body.ticker.upper(), body.currency.upper())

    row = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    return _holding_row_to_out(conn, row)


@router.patch("/portfolio/holdings/{holding_id}", response_model=HoldingOut)
def patch_holding(holding_id: str, body: HoldingPatch, conn: DB):
    existing = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Holding not found")

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return _holding_row_to_out(conn, existing)

    if "is_active" in fields:
        fields["is_active"] = 1 if fields["is_active"] else 0

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    params = list(fields.values()) + [holding_id]
    conn.execute(
        f"UPDATE holdings SET {set_clause}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
        params,
    )
    conn.commit()
    row = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    return _holding_row_to_out(conn, row)


@router.post("/portfolio/holdings/{holding_id}/sell", response_model=SellResult)
def sell_holding(holding_id: str, body: SellHoldingBody, conn: DB):
    """Sell part or all of a holding: reduces quantity (deactivates at zero)
    and books the proceeds as a Finance transaction into `to_account`."""
    row = conn.execute(
        "SELECT * FROM holdings WHERE id = ? AND is_active = 1", (holding_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Holding not found")

    qty_held = row["quantity"]
    qty = min(body.quantity, qty_held) if body.quantity is not None else qty_held
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Nothing to sell")

    price = body.price_eur
    if price is None:
        latest = _latest_price_row(conn, row["ticker"])
        if latest is None or not latest["close_price_eur"]:
            raise HTTPException(
                status_code=400,
                detail="No cached price for this ticker — pass price_eur explicitly",
            )
        price = latest["close_price_eur"]

    proceeds = round(qty * price, 2)
    sell_date = body.date or date.today().isoformat()
    txn_id = "local-" + str(uuid.uuid4())
    txn_type = classify("Finance")

    conn.execute(
        """INSERT INTO transactions
             (id, source, notion_id, date, name, amount, account, category,
              subcategory, transaction_type, notes, source_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            txn_id, "local", None, sell_date,
            f"Sell {row['ticker']} × {qty:g}",
            proceeds, body.to_account, "Finance", None, txn_type,
            body.notes or f"Sold {qty:g} × {row['name']} @ {price:.2f} €",
            None,
        ),
    )

    new_qty = qty_held - qty
    if new_qty <= 1e-9:
        conn.execute(
            """UPDATE holdings SET quantity = 0, is_active = 0,
                     updated_at = datetime('now') WHERE id = ?""",
            (holding_id,),
        )
    else:
        new_cb = None
        if row["cost_basis_eur"] is not None and qty_held > 0:
            new_cb = round(row["cost_basis_eur"] * new_qty / qty_held, 2)
        conn.execute(
            """UPDATE holdings SET quantity = ?, cost_basis_eur = ?,
                     updated_at = datetime('now') WHERE id = ?""",
            (new_qty, new_cb, holding_id),
        )
    conn.commit()

    updated = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    return SellResult(
        holding=_holding_row_to_out(conn, updated),
        transaction_id=txn_id,
        quantity_sold=qty,
        price_eur=price,
        proceeds_eur=proceeds,
    )


@router.post("/portfolio/holdings/{holding_id}/buy", response_model=BuyResult)
def buy_holding(holding_id: str, body: BuyHoldingBody, conn: DB):
    """Add to a holding — the DCA counterpart to /sell. Increases quantity,
    recomputes cost_basis_eur as a weighted average (old total cost + new
    cost), and books the purchase as a Finance transaction debiting
    `from_account`. This is the ongoing way to keep an average buy-in price
    accurate as you add to a position over time."""
    row = conn.execute(
        "SELECT * FROM holdings WHERE id = ? AND is_active = 1", (holding_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Holding not found")

    price = body.price_eur
    if price is None:
        from domains.money.price_sync import sync_price_now
        price = sync_price_now(conn, row["ticker"], row["currency"])
        if price is None:
            latest = _latest_price_row(conn, row["ticker"])
            price = latest["close_price_eur"] if latest else None
        if price is None:
            raise HTTPException(
                status_code=400,
                detail="No live or cached price for this ticker — pass price_eur explicitly",
            )

    cost = round(body.quantity * price, 2)
    buy_date = body.date or date.today().isoformat()
    txn_id = "local-" + str(uuid.uuid4())
    txn_type = classify("Finance")

    conn.execute(
        """INSERT INTO transactions
             (id, source, notion_id, date, name, amount, account, category,
              subcategory, transaction_type, notes, source_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            txn_id, "local", None, buy_date,
            f"Buy {row['ticker']} × {body.quantity:g}",
            -cost, body.from_account, "Finance", None, txn_type,
            body.notes or f"Bought {body.quantity:g} × {row['name']} @ {price:.2f} €",
            None,
        ),
    )

    old_qty = row["quantity"]
    old_cost_basis = row["cost_basis_eur"] or 0.0
    new_qty = old_qty + body.quantity
    new_cost_basis = round(old_cost_basis + cost, 2)

    conn.execute(
        """UPDATE holdings SET quantity = ?, cost_basis_eur = ?,
                 updated_at = datetime('now') WHERE id = ?""",
        (new_qty, new_cost_basis, holding_id),
    )
    conn.commit()

    updated = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    return BuyResult(
        holding=_holding_row_to_out(conn, updated),
        transaction_id=txn_id,
        quantity_bought=body.quantity,
        price_eur=price,
        cost_eur=cost,
    )


@router.delete("/portfolio/holdings/{holding_id}")
def delete_holding(holding_id: str, conn: DB):
    """Soft-close: set is_active = 0. Keeps historical snapshots intact."""
    existing = conn.execute("SELECT id FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Holding not found")
    conn.execute("UPDATE holdings SET is_active = 0 WHERE id = ?", (holding_id,))
    conn.commit()
    return {"ok": True, "id": holding_id}


@router.get("/portfolio/overview", response_model=PortfolioOverview)
def portfolio_overview(conn: DB):
    """Full investor dashboard payload."""
    holding_rows = conn.execute("SELECT * FROM holdings WHERE is_active = 1 ORDER BY name").fetchall()
    enriched_prelim = [_holding_row_to_out(conn, r) for r in holding_rows]
    total_value = sum((h.market_value_eur or 0.0) for h in enriched_prelim)

    # Rebuild with allocation now that total is known
    holdings = [_holding_row_to_out(conn, r, total_value) for r in holding_rows]

    # Aggregate totals
    total_cost_basis = sum((h.cost_basis_eur or 0.0) for h in holdings if h.cost_basis_eur)
    total_pnl = total_value - total_cost_basis if total_cost_basis > 0 else 0.0
    total_pnl_pct = (total_value / total_cost_basis - 1.0) * 100.0 if total_cost_basis > 0 else 0.0

    day_change = sum((h.day_change_eur or 0.0) for h in holdings)
    prev_value = total_value - day_change
    day_change_pct = (day_change / prev_value * 100.0) if prev_value > 0 else 0.0

    # YTD change via snapshot on first day of current year (or fallback)
    if holdings:
        as_of = max((h.price_as_of for h in holdings if h.price_as_of), default=None) or date.today().isoformat()
    else:
        as_of = date.today().isoformat()

    ytd_start = as_of[:4] + "-01-01"
    ytd_snapshot = conn.execute(
        """SELECT SUM(value_eur) AS v FROM holding_snapshots
           WHERE date >= ? AND date = (SELECT MIN(date) FROM holding_snapshots WHERE date >= ?)""",
        (ytd_start, ytd_start),
    ).fetchone()
    ytd_pnl = 0.0
    ytd_pnl_pct = 0.0
    if ytd_snapshot and ytd_snapshot["v"]:
        ytd_start_value = ytd_snapshot["v"]
        ytd_pnl = total_value - ytd_start_value
        ytd_pnl_pct = (total_value / ytd_start_value - 1.0) * 100.0 if ytd_start_value > 0 else 0.0

    def _slice(bucket_fn, holdings_list):
        totals: dict[str, float] = {}
        for h in holdings_list:
            if h.market_value_eur is None:
                continue
            key = bucket_fn(h)
            totals[key] = totals.get(key, 0.0) + h.market_value_eur
        return sorted(
            [AllocationSlice(label=k, value_eur=round(v, 2),
                             pct=round(v / total_value * 100.0, 2) if total_value > 0 else 0.0)
             for k, v in totals.items()],
            key=lambda s: s.value_eur, reverse=True,
        )

    alloc_class = _slice(lambda h: h.asset_class, holdings)
    alloc_account = _slice(lambda h: h.account, holdings)
    alloc_currency = _slice(lambda h: h.currency, holdings)

    # Movers today
    movers = [h for h in holdings if h.day_change_pct is not None]
    up = sorted([h for h in movers if h.day_change_pct > 0],
                key=lambda h: h.day_change_pct, reverse=True)[:3]
    down = sorted([h for h in movers if h.day_change_pct < 0],
                  key=lambda h: h.day_change_pct)[:3]

    def _mover(h: HoldingOut) -> MoverOut:
        return MoverOut(
            holding_id=h.id, ticker=h.ticker, name=h.name,
            day_change_eur=round(h.day_change_eur or 0.0, 2),
            day_change_pct=round(h.day_change_pct or 0.0, 2),
        )

    top_holdings = sorted(
        [h for h in holdings if h.market_value_eur is not None],
        key=lambda h: h.market_value_eur or 0.0, reverse=True,
    )[:5]

    # Liquid accounts (from transactions, unchanged logic)
    liquid = _compute_liquid_accounts(conn)

    return PortfolioOverview(
        as_of=as_of,
        total_value_eur=round(total_value, 2),
        total_cost_basis_eur=round(total_cost_basis, 2),
        total_pnl_eur=round(total_pnl, 2),
        total_pnl_pct=round(total_pnl_pct, 2),
        day_change_eur=round(day_change, 2),
        day_change_pct=round(day_change_pct, 2),
        ytd_pnl_eur=round(ytd_pnl, 2),
        ytd_pnl_pct=round(ytd_pnl_pct, 2),
        allocation_by_class=alloc_class,
        allocation_by_account=alloc_account,
        allocation_by_currency=alloc_currency,
        top_movers_up=[_mover(h) for h in up],
        top_movers_down=[_mover(h) for h in down],
        top_holdings=top_holdings,
        holdings_count=len(holdings),
        liquid_accounts=liquid,
    )


def _compute_liquid_accounts(conn: sqlite3.Connection) -> list[AccountBalance]:
    """Return non-investment accounts using the existing Account Setup + tx sum logic."""
    account_rows = conn.execute(
        """SELECT DISTINCT account FROM transactions
           WHERE account IS NOT NULL AND deleted_at IS NULL"""
    ).fetchall()

    out: list[AccountBalance] = []
    for ar in account_rows:
        acct = ar["account"]
        if acct in INVESTMENT_ACCOUNTS:
            continue  # investment accounts are now covered by holdings

        setup = conn.execute(
            """SELECT amount, date FROM transactions
               WHERE account=? AND category='Account Setup' AND deleted_at IS NULL
               ORDER BY date DESC LIMIT 1""",
            (acct,),
        ).fetchone()
        if setup:
            balance = setup["amount"] + conn.execute(
                """SELECT COALESCE(SUM(amount), 0) as net FROM transactions
                   WHERE account=? AND date > ? AND category != 'Account Setup' AND deleted_at IS NULL""",
                (acct, setup["date"]),
            ).fetchone()["net"]
        else:
            balance = conn.execute(
                """SELECT COALESCE(SUM(amount), 0) as net FROM transactions
                   WHERE account=? AND category != 'Account Setup' AND deleted_at IS NULL""",
                (acct,),
            ).fetchone()["net"]

        if acct in LIQUID_ACCOUNTS:
            acct_type = LIQUID_ACCOUNTS[acct]
        else:
            acct_type = "Unknown"

        out.append(AccountBalance(name=acct, balance=round(balance, 2), account_type=acct_type))

    out.sort(key=lambda a: a.balance, reverse=True)
    return out


@router.get("/portfolio/history", response_model=list[PortfolioHistoryPoint])
def portfolio_history(
    conn: DB,
    range: str = Query("1Y", pattern="^(1M|3M|YTD|1Y|ALL)$"),
):
    """Time series of total portfolio value from holding_snapshots."""
    from datetime import timedelta

    today = date.today()
    if range == "1M":
        cutoff = (today - timedelta(days=31)).isoformat()
    elif range == "3M":
        cutoff = (today - timedelta(days=92)).isoformat()
    elif range == "YTD":
        cutoff = f"{today.year}-01-01"
    elif range == "1Y":
        cutoff = (today - timedelta(days=366)).isoformat()
    else:
        cutoff = "1900-01-01"

    rows = conn.execute(
        """SELECT date, SUM(value_eur) AS total FROM holding_snapshots
           WHERE date >= ? GROUP BY date ORDER BY date""",
        (cutoff,),
    ).fetchall()

    # Cumulative invested proxy: sum of Account Setup + Finance transactions into investment accounts up to that date
    # (simple approximation — refined later if needed)
    invested_by_date: dict[str, float] = {}
    inv_accts = set(INVESTMENT_ACCOUNTS.keys())
    if inv_accts:
        placeholders = ",".join("?" * len(inv_accts))
        cum_rows = conn.execute(
            f"""SELECT date, SUM(amount) AS inflow FROM transactions
                WHERE account IN ({placeholders})
                  AND (category IN ('Account Setup', 'Finance') OR transaction_type = 'Transfer')
                  AND deleted_at IS NULL
                GROUP BY date ORDER BY date""",
            tuple(inv_accts),
        ).fetchall()
        running = 0.0
        for r in cum_rows:
            running += r["inflow"] or 0.0
            invested_by_date[r["date"]] = running

    result: list[PortfolioHistoryPoint] = []
    running_inv = 0.0
    for r in rows:
        # find the most recent invested value <= r["date"]
        for k in sorted(invested_by_date.keys()):
            if k <= r["date"]:
                running_inv = invested_by_date[k]
        result.append(PortfolioHistoryPoint(
            date=r["date"],
            total_value_eur=round(r["total"] or 0.0, 2),
            invested_eur=round(running_inv, 2),
        ))
    return result


@router.get("/portfolio/holding/{holding_id}/history", response_model=list[HoldingHistoryPoint])
def holding_history(
    holding_id: str,
    conn: DB,
    range: str = Query("1Y", pattern="^(1M|3M|YTD|1Y|ALL)$"),
):
    """Time series for a single position."""
    from datetime import timedelta

    existing = conn.execute("SELECT id FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Holding not found")

    today = date.today()
    if range == "1M":
        cutoff = (today - timedelta(days=31)).isoformat()
    elif range == "3M":
        cutoff = (today - timedelta(days=92)).isoformat()
    elif range == "YTD":
        cutoff = f"{today.year}-01-01"
    elif range == "1Y":
        cutoff = (today - timedelta(days=366)).isoformat()
    else:
        cutoff = "1900-01-01"

    rows = conn.execute(
        """SELECT date, quantity, price_eur, value_eur FROM holding_snapshots
           WHERE holding_id = ? AND date >= ? ORDER BY date""",
        (holding_id, cutoff),
    ).fetchall()

    return [
        HoldingHistoryPoint(
            date=r["date"],
            quantity=r["quantity"],
            price_eur=round(r["price_eur"], 4),
            value_eur=round(r["value_eur"], 2),
        )
        for r in rows
    ]


# ── Recurring Investment Plans (DCA) ─────────────────────────────────────────

_MONTHLY_FACTOR = {
    "weekly": 52.0 / 12.0,
    "biweekly": 26.0 / 12.0,
    "monthly": 1.0,
    "quarterly": 1.0 / 3.0,
    "yearly": 1.0 / 12.0,
}


def _plan_row_to_out(conn: sqlite3.Connection, row: sqlite3.Row) -> InvestmentPlanOut:
    holding = conn.execute(
        "SELECT ticker, name, account FROM holdings WHERE id = ?",
        (row["holding_id"],),
    ).fetchone()
    stats = conn.execute(
        """SELECT COUNT(*) AS n,
                  COALESCE(SUM(amount_eur), 0) AS total_amt,
                  COALESCE(SUM(quantity_added), 0) AS total_qty
             FROM investment_plan_executions
             WHERE plan_id = ? AND status = 'success'""",
        (row["id"],),
    ).fetchone()

    return InvestmentPlanOut(
        id=row["id"],
        holding_id=row["holding_id"],
        ticker=holding["ticker"] if holding else "",
        holding_name=holding["name"] if holding else "",
        holding_account=holding["account"] if holding else "",
        source_account=row["source_account"],
        amount_eur=row["amount_eur"],
        cadence=row["cadence"],
        day_of_month=row["day_of_month"],
        day_of_week=row["day_of_week"],
        start_date=row["start_date"],
        end_date=row["end_date"],
        next_execution_date=row["next_execution_date"],
        last_executed_at=row["last_executed_at"],
        is_active=bool(row["is_active"]),
        notes=row["notes"],
        total_contributed_eur=round(stats["total_amt"] or 0.0, 2),
        total_quantity_added=round(stats["total_qty"] or 0.0, 6),
        executions_count=stats["n"] or 0,
        monthly_equivalent_eur=round(row["amount_eur"] * _MONTHLY_FACTOR[row["cadence"]], 2),
    )


def _validate_plan_body(body: InvestmentPlanCreate) -> None:
    if body.cadence in ("weekly", "biweekly"):
        if body.day_of_week is None:
            raise HTTPException(status_code=400, detail="day_of_week required for weekly/biweekly")
    else:
        if body.day_of_month is None:
            raise HTTPException(status_code=400, detail="day_of_month required for monthly/quarterly/yearly")


@router.get("/portfolio/plans", response_model=list[InvestmentPlanOut])
def list_plans(conn: DB, include_inactive: bool = Query(False)):
    where = "" if include_inactive else " WHERE is_active = 1"
    rows = conn.execute(
        f"SELECT * FROM investment_plans{where} ORDER BY is_active DESC, next_execution_date"
    ).fetchall()
    return [_plan_row_to_out(conn, r) for r in rows]


@router.post("/portfolio/plans", response_model=InvestmentPlanOut, status_code=201)
def create_plan(body: InvestmentPlanCreate, conn: DB):
    _validate_plan_body(body)

    # Verify holding exists
    holding = conn.execute("SELECT id FROM holdings WHERE id = ?", (body.holding_id,)).fetchone()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    cur = conn.execute(
        """INSERT INTO investment_plans
             (holding_id, source_account, amount_eur, cadence,
              day_of_month, day_of_week, start_date, end_date,
              next_execution_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.holding_id, body.source_account, body.amount_eur, body.cadence,
         body.day_of_month, body.day_of_week, body.start_date, body.end_date,
         body.start_date, body.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM investment_plans WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _plan_row_to_out(conn, row)


@router.patch("/portfolio/plans/{plan_id}", response_model=InvestmentPlanOut)
def patch_plan(plan_id: int, body: InvestmentPlanPatch, conn: DB):
    existing = conn.execute("SELECT * FROM investment_plans WHERE id = ?", (plan_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Plan not found")

    fields = body.model_dump(exclude_unset=True)
    if "is_active" in fields:
        fields["is_active"] = 1 if fields["is_active"] else 0
    if not fields:
        return _plan_row_to_out(conn, existing)

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    params = list(fields.values()) + [plan_id]
    conn.execute(
        f"UPDATE investment_plans SET {set_clause}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
        params,
    )
    conn.commit()
    row = conn.execute("SELECT * FROM investment_plans WHERE id = ?", (plan_id,)).fetchone()
    return _plan_row_to_out(conn, row)


@router.delete("/portfolio/plans/{plan_id}")
def delete_plan(plan_id: int, conn: DB):
    existing = conn.execute("SELECT id FROM investment_plans WHERE id = ?", (plan_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Plan not found")
    conn.execute("UPDATE investment_plans SET is_active = 0 WHERE id = ?", (plan_id,))
    conn.commit()
    return {"ok": True, "id": plan_id}


@router.get("/portfolio/plans/{plan_id}/executions", response_model=list[PlanExecutionOut])
def plan_executions(plan_id: int, conn: DB, limit: int = Query(100, le=500)):
    rows = conn.execute(
        """SELECT * FROM investment_plan_executions
             WHERE plan_id = ?
             ORDER BY execution_date DESC LIMIT ?""",
        (plan_id, limit),
    ).fetchall()
    return [PlanExecutionOut(**dict(r)) for r in rows]


@router.post("/portfolio/plans/run-due", response_model=PlanRunResult)
def run_due_plans(conn: DB, dry_run: bool = Query(False)):
    """Manual trigger: execute every plan whose next_execution_date has arrived.

    Called nightly by daily_sync.sh. Safe to run repeatedly — idempotent per (plan_id, execution_date).
    """
    from domains.money.plan_executor import run_due
    # Note: run_due opens its own connection; the caller's `conn` is only used
    # to return the final ledger. That's fine.
    run_due(dry_run=dry_run)
    # Fetch executions from the last 24h to summarise
    recent = conn.execute(
        """SELECT * FROM investment_plan_executions
             WHERE created_at >= datetime('now', '-1 day')
             ORDER BY created_at DESC LIMIT 100"""
    ).fetchall()
    return PlanRunResult(
        executed=[PlanExecutionOut(**dict(r)) for r in recent],
        dry_run=dry_run,
    )

