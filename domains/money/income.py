"""
What this month's income will be, not just what has landed so far.

Before payday a month looks like pure spending, so projected savings read as a
loss. The salary paid this month is the payslip for last month's flying, which
the roster already estimates (domains/aviation/pay.py). If no income of at least
half that size has arrived yet, it's added on top of what has.

Without a roster estimate, the average of the last 3 months' income stands in.
"""

import logging
import sqlite3
from datetime import date

log = logging.getLogger(__name__)


def _prev_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) - 1
    return f"{y - (m < 1):04d}-{(m - 1) % 12 + 1:02d}"


def roster_salary(month: str) -> float | None:
    """Net pay of the payslip paid in `month` (activity = the month before)."""
    try:
        from domains.aviation import pay
        from infrastructure.db.connection import get_connection

        conn = get_connection()
        conn.row_factory = sqlite3.Row
        try:
            s = pay.get_settings(conn)
            slip = pay.payslip(
                conn, _prev_month(month),
                category=s["category"], level=s["level"], irpf_pct=s["irpf_pct"],
                default_jornada=s["jornada_pct"],
            )
        finally:
            conn.close()
        net = slip.get("net") or 0
        return round(net, 2) if net > 0 else None
    except Exception as e:                       # no roster yet, no pay tables, …
        log.info("roster salary unavailable for %s: %s", month, e)
        return None


def _avg_income(conn: sqlite3.Connection, month: str) -> float | None:
    months = [_prev_month(month)]
    for _ in range(2):
        months.append(_prev_month(months[-1]))
    rows = conn.execute(
        f"""SELECT strftime('%Y-%m', date) AS mon, SUM(amount) FROM transactions
            WHERE transaction_type = 'Income' AND deleted_at IS NULL
              AND strftime('%Y-%m', date) IN ({",".join("?" * len(months))})
            GROUP BY mon""",
        months,
    ).fetchall()
    vals = [r[1] for r in rows if r[1] and r[1] > 0]
    return round(sum(vals) / len(vals), 2) if vals else None


def project(conn: sqlite3.Connection, month: str, received: float, today: date | None = None,
            salary_lookup=roster_salary) -> dict:
    """{projected_income, expected_salary, salary_received, income_source}."""
    today = today or date.today()
    if month != today.strftime("%Y-%m"):
        return {"projected_income": round(received, 2), "expected_salary": None,
                "salary_received": True, "income_source": "actual"}

    expected, source = salary_lookup(month), "roster"
    if expected is None:
        expected, source = _avg_income(conn, month), "average"
    if expected is None:
        return {"projected_income": round(received, 2), "expected_salary": None,
                "salary_received": True, "income_source": "actual"}

    amounts = [r[0] for r in conn.execute(
        """SELECT amount FROM transactions
           WHERE transaction_type = 'Income' AND deleted_at IS NULL AND amount > 0
             AND strftime('%Y-%m', date) = ?""",
        (month,),
    )]
    # The averaged fallback already includes side income, so it's compared to the total.
    landed = (max(amounts, default=0) >= 0.5 * expected) if source == "roster" else received >= 0.8 * expected
    projected = received if landed else (received + expected if source == "roster" else max(received, expected))
    return {"projected_income": round(projected, 2), "expected_salary": expected,
            "salary_received": landed, "income_source": source}
