"""
Backfill realized_trades from sales made before the table existed (2026-07-16).

Sources: ledger transactions named 'Sell {ticker} × {qty}' (written by the
sell endpoint). Sale price is derived from proceeds/qty. Cost basis:
  - holding fully sold (is_active=0, quantity=0): the holdings row still has
    the pre-sale cost_basis_eur → realized P&L computable
  - holding partially sold: the basis was pro-rated at sale time and the
    original is gone → row recorded with P&L NULL ("cost unknown")

Idempotent via transaction_id. Run on the Pi:
  .venv/bin/python -m infrastructure.db.backfill_realized_trades
"""

import re

from infrastructure.db.money_connection import get_money_connection

SELL_NAME = re.compile(r"^Sell (\S+) × ([\d.]+)$")


def backfill(conn):
    txns = conn.execute(
        """SELECT id, date, name, amount FROM transactions
           WHERE name LIKE 'Sell %' AND category = 'Finance'
             AND deleted_at IS NULL ORDER BY date"""
    ).fetchall()

    inserted = 0
    for t in txns:
        m = SELL_NAME.match(t["name"])
        if not m:
            continue
        if conn.execute(
            "SELECT 1 FROM realized_trades WHERE transaction_id = ?", (t["id"],)
        ).fetchone():
            continue  # already recorded (live or previous backfill run)

        ticker, qty = m.group(1), float(m.group(2))
        if qty <= 0 or t["amount"] <= 0:
            continue
        price = t["amount"] / qty

        holding = conn.execute(
            "SELECT * FROM holdings WHERE ticker = ? ORDER BY is_active LIMIT 1",
            (ticker,),
        ).fetchone()
        if holding is None:
            print(f"  ⚠ {t['date']} Sell {ticker}: no holding found — skipped")
            continue

        cost_sold = None
        realized = None
        if not holding["is_active"] and holding["quantity"] == 0 and holding["cost_basis_eur"]:
            # Fully closed in one sale: the row still holds the pre-sale basis
            cost_sold = round(holding["cost_basis_eur"], 2)
            realized = round(t["amount"] - cost_sold, 2)

        conn.execute(
            """INSERT INTO realized_trades
                 (holding_id, ticker, name, account, date, quantity, price_eur,
                  proceeds_eur, cost_basis_sold_eur, realized_pnl_eur, transaction_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (holding["id"], ticker, holding["name"], holding["account"], t["date"],
             qty, price, t["amount"], cost_sold, realized, t["id"]),
        )
        inserted += 1
        pnl = f"{realized:+.2f} €" if realized is not None else "cost unknown"
        print(f"  {t['date']}  Sell {ticker} × {qty:g} → {t['amount']:.2f} €  ({pnl})")

    conn.commit()
    print(f"\nBackfilled {inserted} sale(s)." if inserted else "\nNothing to backfill.")


if __name__ == "__main__":
    conn = get_money_connection()
    backfill(conn)
    conn.close()
