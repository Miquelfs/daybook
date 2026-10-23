"""
Budgets and the savings goal, edited from the app (stored in money.db; see
domains/money/budgets.py). The plan proposes next month's budgets from a year of
spending.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from infrastructure.api.db_money import get_money_db
from infrastructure.api.models.budget import BudgetPlan, BudgetSave, MoneySettingsIn
from domains.money import budgets

router = APIRouter(prefix="/money", tags=["budget"])

DB = Annotated[sqlite3.Connection, Depends(get_money_db)]


@router.get("/budget/plan", response_model=BudgetPlan)
def budget_plan(conn: DB):
    return budgets.plan(conn)


@router.put("/budget", response_model=BudgetPlan)
def save_budget(body: BudgetSave, conn: DB):
    """Save the full set of category budgets effective from `effective_month`."""
    budgets.save_budget(conn, body.effective_month, body.amounts)
    return budgets.plan(conn)


@router.put("/settings")
def save_settings(body: MoneySettingsIn, conn: DB):
    budgets.set_savings_goal(conn, body.savings_goal)
    return {"savings_goal": budgets.savings_goal(conn)}
