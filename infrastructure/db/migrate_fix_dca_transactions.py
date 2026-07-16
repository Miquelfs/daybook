"""
Repair DCA ledger entries booked before 2026-07-16.

The plan executor used to credit +amount into the INVESTMENT account
(holdings track that value already → double-counted) and never debited the
source cash account. Correct form, matching the manual Buy endpoint:
−amount on the source account, category/type 'Finance'.

Old rows are identifiable: name 'DCA: …', category 'Transfer', amount > 0,
account = investment account, subcategory = source account.

Idempotent (fixed rows no longer match). Run on the Pi:
  .venv/bin/python -m infrastructure.db.migrate_fix_dca_transactions
"""

from infrastructure.db.money_connection import get_money_connection


def migrate(conn):
    rows = conn.execute(
        """SELECT id, date, name, amount, account, subcategory FROM transactions
           WHERE name LIKE 'DCA: %' AND category = 'Transfer'
             AND transaction_type = 'Transfer' AND amount > 0
             AND subcategory IS NOT NULL AND deleted_at IS NULL"""
    ).fetchall()
    if not rows:
        print("No mis-booked DCA transactions found — nothing to do.")
        return

    for r in rows:
        conn.execute(
            """UPDATE transactions
               SET amount = ?, account = ?, category = 'Finance',
                   transaction_type = 'Finance', subcategory = NULL,
                   notes = COALESCE(notes, '') || ' (repaired: was +' || ? || ' on ' || ? || ')'
               WHERE id = ?""",
            (-r["amount"], r["subcategory"], r["amount"], r["account"], r["id"]),
        )
        print(f"  {r['date']}  {r['name']}: +{r['amount']:.2f} on {r['account']}"
              f" → -{r['amount']:.2f} on {r['subcategory']}")
    conn.commit()
    print(f"Repaired {len(rows)} DCA transaction(s).")


if __name__ == "__main__":
    conn = get_money_connection()
    migrate(conn)
    conn.close()
