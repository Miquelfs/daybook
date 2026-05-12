"""
Money / Finance API router.
All analytics are pure SQL — no pandas dependency.
"""

import calendar
import sqlite3
import uuid
from datetime import date, datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from infrastructure.api.db_money import get_money_db
from infrastructure.api.models.money import (
    CategoryBudget, CategoryMeta, MerchantSuggestion, MoneyMeta,
    MonthSummary, TransactionCreate, TransactionOut, TransactionPatch,
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

    # Expenses stored as negative amounts; income stays positive
    stored_amount = -abs(body.amount) if txn_type == "Expense" else abs(body.amount)

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
        updates["amount"] = -abs(updates["amount"]) if txn_type == "Expense" else abs(updates["amount"])

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

    categories = [
        CategoryMeta(key=c, emoji=CATEGORY_EMOJI.get(c, "💳"))
        for c in EXPENSE_CATEGORIES
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
        """SELECT COALESCE(SUM(ABS(amount)), 0) as total
           FROM transactions
           WHERE strftime('%Y-%m', date) = ?
             AND transaction_type = 'Expense'
             AND deleted_at IS NULL""",
        (month,),
    ).fetchone()
    total_spent = spent_row["total"]

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
        """SELECT category, COALESCE(SUM(ABS(amount)), 0) as spent
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
        spent = row["spent"]
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
