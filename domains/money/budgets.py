"""
Monthly budgets and the savings goal — editable from the app, stored in money.db.

Budgets are versioned like money_config.BUDGET_VERSIONS: a version is the full
set of category amounts effective from a month (`budgets` rows sharing a
year_month), and a month uses the latest version on or before it. With nothing
saved yet, the config versions apply, so existing behaviour is unchanged.

`plan()` proposes next month's budgets from the last 12 complete months: a
regular category's typical (median) month, an occasional one's monthly average,
never above its current budget — the point is to save more, not to rubber-stamp
an overspend. Bills follow last month's amount.
"""

import sqlite3
from datetime import date
from statistics import median

from domains.money.money_config import (
    CATEGORY_EMOJI, FIXED_RECURRING_CATEGORIES, MONTHLY_SAVINGS_GOAL, get_budget_for_month,
)


def budget_for_month(conn: sqlite3.Connection, year_month: str) -> dict[str, float]:
    # Positional indexing: callers pass connections with and without sqlite3.Row.
    try:
        row = conn.execute(
            "SELECT MAX(year_month) FROM budgets WHERE year_month <= ?", (year_month,)
        ).fetchone()
        if row and row[0]:
            return {
                r[0]: r[1]
                for r in conn.execute("SELECT category, amount FROM budgets WHERE year_month = ?", (row[0],))
            }
    except sqlite3.OperationalError:
        pass  # money.db without the budgets table — config versions apply
    return get_budget_for_month(year_month)


def savings_goal(conn: sqlite3.Connection) -> float:
    try:
        row = conn.execute("SELECT value FROM money_settings WHERE key = 'savings_goal'").fetchone()
    except sqlite3.OperationalError:
        row = None  # table not migrated yet — config default applies
    return float(row[0]) if row else MONTHLY_SAVINGS_GOAL


def set_savings_goal(conn: sqlite3.Connection, amount: float) -> None:
    conn.execute(
        "INSERT INTO money_settings (key, value) VALUES ('savings_goal', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(round(amount, 2)),),
    )
    conn.commit()


def save_budget(conn: sqlite3.Connection, effective_month: str, amounts: dict[str, float]) -> None:
    """Replace the version effective from `effective_month` with these amounts."""
    conn.execute("DELETE FROM budgets WHERE year_month = ?", (effective_month,))
    conn.executemany(
        "INSERT INTO budgets (year_month, category, amount) VALUES (?, ?, ?)",
        [(effective_month, c, round(a, 2)) for c, a in amounts.items() if a and a > 0],
    )
    conn.commit()


def _months_back(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) - n
    while m < 1:
        y, m = y - 1, m + 12
    return f"{y:04d}-{m:02d}"


def _next_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) + 1
    return f"{y + (m > 12):04d}-{(m - 1) % 12 + 1:02d}"


def _round5(x: float) -> float:
    return float(max(5, int(round(x / 5.0)) * 5)) if x > 0 else 0.0


def plan(conn: sqlite3.Connection, today: date | None = None) -> dict:
    today = today or date.today()
    this_month = today.strftime("%Y-%m")
    first = _months_back(this_month, 12)          # 12 complete months: first .. last month

    spend: dict[str, dict[str, float]] = {}
    for r in conn.execute(
        """SELECT category, strftime('%Y-%m', date) AS mon, -SUM(amount) AS spent
           FROM transactions
           WHERE transaction_type = 'Expense' AND deleted_at IS NULL
             AND strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) < ?
           GROUP BY category, mon""",
        (first, this_month),
    ):
        spend.setdefault(r["category"] or "Other", {})[r["mon"]] = max(0.0, r["spent"] or 0.0)

    months = [_months_back(this_month, i) for i in range(12, 0, -1)]
    income_rows = conn.execute(
        """SELECT strftime('%Y-%m', date) AS mon, SUM(amount) AS inc FROM transactions
           WHERE transaction_type = 'Income' AND deleted_at IS NULL
             AND strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) < ?
           GROUP BY mon""",
        (first, this_month),
    ).fetchall()
    income_months = [r["inc"] for r in income_rows if r["inc"]]
    avg_income = sum(income_months) / len(income_months) if income_months else 0.0

    current = budget_for_month(conn, this_month)
    rows = []
    for cat in sorted(set(spend) | set(current)):
        series = [spend.get(cat, {}).get(m, 0.0) for m in months]
        active = [v for v in series if v > 0]
        typical = median(series) if series else 0.0
        cur = current.get(cat, 0.0)
        fixed = cat in FIXED_RECURRING_CATEGORIES
        if fixed:
            # A bill is what it is: last month's amount (rent goes up), else the budget.
            suggested = _round5(series[-1]) if series and series[-1] > 0 else cur
        else:
            # Regular spending: the typical month. Occasional spending (trips,
            # gifts): the 12-month average, so a few big months are spread over
            # the year instead of a median of €0.
            base = typical if len(active) >= 9 else (sum(series) / len(series) if series else 0.0)
            suggested = _round5(base)
            if cur:
                suggested = min(suggested, cur)
        rows.append({
            "category": cat,
            "emoji": CATEGORY_EMOJI.get(cat, "💳"),
            "fixed": fixed,
            "current": round(cur, 2),
            "typical": round(typical, 2),
            "average": round(sum(series) / len(series), 2) if series else 0.0,
            "last": round(series[-1], 2) if series else 0.0,
            "months_active": len(active),
            "suggested": suggested,
            "history": [round(v, 2) for v in series],
        })
    rows.sort(key=lambda r: -max(r["current"], r["typical"]))

    return {
        "effective_month": _next_month(this_month),
        "months": months,
        "goal": savings_goal(conn),
        "avg_income": round(avg_income, 2),
        "current_total": round(sum(r["current"] for r in rows), 2),
        "suggested_total": round(sum(r["suggested"] for r in rows), 2),
        "rows": rows,
    }
