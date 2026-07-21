"""
Weekly expense summary — runs every Monday morning.
Fetches last week's spending from money.db, calls Ollama, stores in ai_narratives table.

Usage:
  python -m domains.ai.weekly_expense_summary          # current week
  python -m domains.ai.weekly_expense_summary --week 2026-06-23  # specific Monday
"""

import argparse
import logging
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(ROOT))

from infrastructure.db.connection import get_connection
from domains.ai import ollama_client
from domains.ai.prompt_builder import weekly_expense_summary as build_prompt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MONEY_DB_PATH = ROOT / "infrastructure" / "db" / "money.db"


def _last_monday() -> str:
    today = date.today()
    days_since_monday = today.weekday()
    return (today - timedelta(days=days_since_monday + 7)).isoformat()


def _fetch_week_spend(week_start: str, week_end: str) -> dict:
    if not MONEY_DB_PATH.exists():
        return {}
    conn = sqlite3.connect(MONEY_DB_PATH)
    conn.row_factory = sqlite3.Row

    total_row = conn.execute(
        """
        SELECT SUM(ABS(amount)) AS total_spent
        FROM transactions
        WHERE date BETWEEN ? AND ?
          AND transaction_type = 'Expense'
          AND deleted_at IS NULL
        """,
        (week_start, week_end),
    ).fetchone()
    total_spent = total_row["total_spent"] or 0.0

    by_cat = conn.execute(
        """
        SELECT t.category, SUM(ABS(t.amount)) AS spent, COALESCE(b.amount, 0) AS budget
        FROM transactions t
        LEFT JOIN budgets b ON b.category = t.category
          AND b.year_month = strftime('%Y-%m', t.date)
        WHERE t.date BETWEEN ? AND ?
          AND t.transaction_type = 'Expense'
          AND t.deleted_at IS NULL
        GROUP BY t.category
        ORDER BY spent DESC
        """,
        (week_start, week_end),
    ).fetchall()

    top_tx = conn.execute(
        """
        SELECT name AS description, ABS(amount) AS amount
        FROM transactions
        WHERE date BETWEEN ? AND ?
          AND transaction_type = 'Expense'
          AND deleted_at IS NULL
        ORDER BY ABS(amount) DESC
        LIMIT 1
        """,
        (week_start, week_end),
    ).fetchone()

    # Previous week for comparison
    prev_start = (date.fromisoformat(week_start) - timedelta(days=7)).isoformat()
    prev_end = (date.fromisoformat(week_end) - timedelta(days=7)).isoformat()
    prev_row = conn.execute(
        "SELECT SUM(ABS(amount)) AS total FROM transactions WHERE date BETWEEN ? AND ? AND transaction_type='Expense' AND deleted_at IS NULL",
        (prev_start, prev_end),
    ).fetchone()
    prev_total = prev_row["total"] or 0.0

    # Monthly budget total (sum all categories for the month)
    month = week_start[:7]
    budget_row = conn.execute(
        "SELECT SUM(amount) AS total FROM budgets WHERE year_month = ?", (month,)
    ).fetchone()
    monthly_budget = budget_row["total"] or 0.0
    weekly_budget = monthly_budget / 4.3

    conn.close()

    vs_last_week_pct = ((total_spent - prev_total) / prev_total * 100) if prev_total else None

    return {
        "total_spent": total_spent,
        "total_budget": weekly_budget,
        "budget_pct": (total_spent / weekly_budget * 100) if weekly_budget else 0,
        "by_category": [
            {"category": r["category"], "spent": r["spent"], "budget": r["budget"] / 4.3}
            for r in by_cat
        ],
        "top_transaction": {"description": top_tx["description"], "amount": top_tx["amount"]} if top_tx else None,
        "vs_last_week_pct": vs_last_week_pct,
    }


def run(week_start: str) -> None:
    week_end = (date.fromisoformat(week_start) + timedelta(days=6)).isoformat()
    log.info("Weekly expense summary for %s → %s", week_start, week_end)

    if not ollama_client.is_available():
        log.warning("Ollama not reachable at %s — skipping", ollama_client.OLLAMA_HOST)
        return

    data = _fetch_week_spend(week_start, week_end)
    if not data:
        log.warning("No money.db or no spend data — skipping")
        return

    prompt = build_prompt(week_start, data)
    log.info("Calling Ollama (model: %s)...", ollama_client.MODEL_FAST)
    text = ollama_client.generate(prompt)

    if not text:
        log.warning("Ollama returned empty response — skipping")
        return

    text = text.strip()
    log.info("Expense summary generated (%d chars)", len(text))

    date_range = f"{week_start}:{week_end}"
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO ai_narratives (topic, date_range, text, model)
            VALUES (?, ?, ?, ?)
            """,
            ("expense", date_range, text, ollama_client.MODEL_FAST),
        )
        conn.commit()
        log.info("Expense narrative stored in ai_narratives (topic=expense, range=%s)", date_range)
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--week", default=_last_monday(), help="Monday date of the week (YYYY-MM-DD)")
    args = parser.parse_args()
    run(args.week)
