"""
Recurring investment plan executor.

Runs in the nightly sync. For every active plan whose next_execution_date has arrived:
  1. Fetch the most recent EUR price for the holding's ticker
  2. Compute quantity_added = amount_eur / price
  3. Bump the holding: quantity += Δqty, cost_basis_eur += amount_eur
  4. Write a Transfer ledger entry into `transactions` (source_account → holding.account)
  5. Log the execution (idempotent via UNIQUE (plan_id, execution_date))
  6. Advance next_execution_date per cadence

If no price is cached, the execution is logged as `no_price` and retried on the next run.

Manual run:  python -m domains.money.plan_executor [--dry-run] [--as-of YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import calendar
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from infrastructure.db.money_connection import get_money_connection


CADENCES = ("weekly", "biweekly", "monthly", "quarterly", "yearly")


def _clamp_day(y: int, m: int, day: int) -> int:
    """Clamp target day to the last day of the given month."""
    last = calendar.monthrange(y, m)[1]
    return min(day, last)


def next_after(current: date, cadence: str, day_of_month: Optional[int], day_of_week: Optional[int]) -> date:
    """Return the next execution date STRICTLY after `current`."""
    if cadence == "weekly":
        assert day_of_week is not None
        # advance at least 7 days, land on the right weekday
        d = current + timedelta(days=7)
        offset = (day_of_week - d.weekday()) % 7
        return d + timedelta(days=offset)
    if cadence == "biweekly":
        assert day_of_week is not None
        d = current + timedelta(days=14)
        offset = (day_of_week - d.weekday()) % 7
        return d + timedelta(days=offset)
    if cadence == "monthly":
        assert day_of_month is not None
        y, m = current.year, current.month
        m += 1
        if m == 13:
            m = 1
            y += 1
        return date(y, m, _clamp_day(y, m, day_of_month))
    if cadence == "quarterly":
        assert day_of_month is not None
        y, m = current.year, current.month
        m += 3
        while m > 12:
            m -= 12
            y += 1
        return date(y, m, _clamp_day(y, m, day_of_month))
    if cadence == "yearly":
        assert day_of_month is not None
        y = current.year + 1
        m = current.month
        return date(y, m, _clamp_day(y, m, day_of_month))
    raise ValueError(f"Unknown cadence {cadence}")


def _price_on_or_before(conn: sqlite3.Connection, ticker: str, on_date: str) -> Optional[float]:
    row = conn.execute(
        """SELECT close_price_eur FROM price_history
           WHERE ticker = ? AND date <= ?
           ORDER BY date DESC LIMIT 1""",
        (ticker, on_date),
    ).fetchone()
    return row["close_price_eur"] if row else None


def _log_execution(
    conn: sqlite3.Connection,
    plan_id: int,
    execution_date: str,
    amount_eur: float,
    price_eur: float,
    quantity_added: float,
    transaction_id: Optional[str],
    status: str,
    notes: Optional[str] = None,
) -> None:
    conn.execute(
        """INSERT OR IGNORE INTO investment_plan_executions
           (plan_id, execution_date, amount_eur, price_eur, quantity_added,
            transaction_id, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (plan_id, execution_date, amount_eur, price_eur, quantity_added,
         transaction_id, status, notes),
    )


def execute_plan(conn: sqlite3.Connection, plan_row: sqlite3.Row, as_of: date, dry_run: bool = False) -> dict:
    """Execute a single plan for its next_execution_date. Advances the schedule.

    Returns a dict describing what happened.
    """
    plan_id = plan_row["id"]
    holding_id = plan_row["holding_id"]
    exec_date = plan_row["next_execution_date"]
    amount = plan_row["amount_eur"]

    holding = conn.execute(
        "SELECT * FROM holdings WHERE id = ? AND is_active = 1",
        (holding_id,),
    ).fetchone()
    if not holding:
        _log_execution(conn, plan_id, exec_date, amount, 0.0, 0.0, None,
                       "skipped", "holding inactive or missing")
        return {"plan_id": plan_id, "status": "skipped", "reason": "holding gone"}

    price = _price_on_or_before(conn, holding["ticker"], exec_date)
    if price is None or price <= 0:
        # Log but do NOT advance — retry next run when price arrives
        if not dry_run:
            _log_execution(conn, plan_id, exec_date, amount, 0.0, 0.0, None,
                           "no_price", f"no cached price for {holding['ticker']} <= {exec_date}")
            conn.commit()
        return {"plan_id": plan_id, "status": "no_price", "ticker": holding["ticker"]}

    qty_added = amount / price

    if dry_run:
        return {
            "plan_id": plan_id, "status": "dry_run",
            "date": exec_date, "amount_eur": amount,
            "price_eur": price, "quantity_added": qty_added,
        }

    # 1. Bump holding
    new_qty = holding["quantity"] + qty_added
    new_cost = (holding["cost_basis_eur"] or 0.0) + amount
    conn.execute(
        """UPDATE holdings
             SET quantity = ?, cost_basis_eur = ?,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?""",
        (new_qty, new_cost, holding_id),
    )

    # 2. Ledger entry: a Transfer from source_account marked with the plan.
    # We record it against the holding.account so the balance rollup sees the inflow,
    # matching the existing "Transfer" convention in money_config.
    txn_id = "local-" + str(uuid.uuid4())
    name = f"DCA: {holding['ticker']} ({plan_row['cadence']})"
    conn.execute(
        """INSERT INTO transactions
             (id, source, date, name, amount, account, category, subcategory,
              transaction_type, notes)
           VALUES (?, 'local', ?, ?, ?, ?, 'Transfer', ?, 'Transfer', ?)""",
        (txn_id, exec_date, name, amount, holding["account"],
         plan_row["source_account"],
         f"Plan #{plan_id} → {holding['ticker']}"),
    )

    # 3. Log execution
    _log_execution(conn, plan_id, exec_date, amount, price, qty_added,
                   txn_id, "success")

    # 4. Advance the schedule
    cur = date.fromisoformat(exec_date)
    next_dt = next_after(cur, plan_row["cadence"],
                         plan_row["day_of_month"], plan_row["day_of_week"])
    end = plan_row["end_date"]
    if end and next_dt > date.fromisoformat(end):
        conn.execute(
            "UPDATE investment_plans SET is_active = 0, last_executed_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            (exec_date, plan_id),
        )
    else:
        conn.execute(
            """UPDATE investment_plans
                 SET next_execution_date = ?, last_executed_at = ?,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                 WHERE id = ?""",
            (next_dt.isoformat(), exec_date, plan_id),
        )

    conn.commit()
    return {
        "plan_id": plan_id, "status": "success",
        "date": exec_date, "amount_eur": amount,
        "price_eur": price, "quantity_added": qty_added,
        "new_quantity": new_qty, "txn_id": txn_id,
    }


def run_due(as_of: Optional[date] = None, dry_run: bool = False) -> list[dict]:
    """Execute every plan whose next_execution_date <= as_of. Catches up multiple
    missed periods by looping."""
    conn = get_money_connection()
    on = as_of or date.today()
    results: list[dict] = []

    while True:
        plan = conn.execute(
            """SELECT * FROM investment_plans
                 WHERE is_active = 1 AND next_execution_date <= ?
                 ORDER BY next_execution_date, id
                 LIMIT 1""",
            (on.isoformat(),),
        ).fetchone()
        if not plan:
            break
        res = execute_plan(conn, plan, on, dry_run=dry_run)
        results.append(res)
        # If no_price we don't advance — break to avoid infinite loop; try again next sync
        if res["status"] == "no_price":
            break
        if dry_run:
            break  # don't loop in dry-run

    conn.close()
    return results


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--as-of", help="YYYY-MM-DD (default: today)")
    args = p.parse_args()
    on = datetime.strptime(args.as_of, "%Y-%m-%d").date() if args.as_of else None
    out = run_due(on, dry_run=args.dry_run)
    print(f"Executed {len(out)} plan(s):")
    for r in out:
        print(f"  {r}")
