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
    AccountBalance, AnomalyReport, BudgetAlert,
    CategoryBudget, CategoryMeta, CategoryMonthSpend, CategorySpikeAnomaly, CategoryStats, CategoryTrendsData,
    DaySpend, ForecastData, HistoricalData,
    LargeTxAnomaly, MerchantSuggestion, MoneyMeta,
    MonthDetail, MonthHistory, MonthOverview, MonthSummary,
    PortfolioSummary, SavingsStreak, SpendingPatterns, TrendsData,
    TransactionCreate, TransactionOut, TransactionPatch,
    WeekSpend,
)
from domains.money.money_config import (
    CATEGORY_EMOJI, EXPENSE_CATEGORIES, classify, get_budget_for_month,
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
        """INSERT INTO transactions
             (id, source, notion_id, date, name, amount, account, category,
              subcategory, transaction_type, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (txn_id, "local", None, body.date, body.name, stored_amount,
         body.account, body.category, body.subcategory, txn_type, body.notes),
    )
    conn.commit()
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
    for row in cat_rows:
        cat = row["category"] or "Other"
        spent = max(0.0, row["spent"])  # floor at 0 when reimbursements exceed spending
        bgt = budget.get(cat, 0.0)
        remaining = bgt - spent
        vel = (spent / bgt / pct_time) if bgt > 0 and pct_time > 0 else 0.0
        status = _budget_status(spent, bgt, vel)
        categories.append(CategoryBudget(
            category=cat, spent=round(spent, 2), budget=round(bgt, 2),
            remaining=round(remaining, 2), velocity=round(vel, 2), status=status,
        ))
        if status in ("Over Budget", "Over Pace"):
            alerts.append(BudgetAlert(
                category=cat, velocity=round(vel, 2), spent=round(spent, 2),
                budget=round(bgt, 2), status=status,
            ))

    overall_vel = (total_spent / total_budget / pct_time) if total_budget > 0 and pct_time > 0 else 0.0
    daily_burn = total_spent / days_elapsed if days_elapsed > 0 else 0.0
    projected = daily_burn * dim
    projected_savings = total_income - projected

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

    rows = conn.execute(
        """SELECT category,
                  COALESCE(-SUM(amount), 0) AS total,
                  COUNT(*) AS cnt,
                  MIN(ABS(amount)) AS min_tx,
                  MAX(ABS(amount)) AS max_tx,
                  COUNT(DISTINCT strftime('%Y-%m', date)) AS num_months
           FROM transactions
           WHERE deleted_at IS NULL AND transaction_type='Expense'
             AND strftime('%Y-%m', date) < ?
           GROUP BY category ORDER BY total DESC""",
        (current_month,)
    ).fetchall()

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

