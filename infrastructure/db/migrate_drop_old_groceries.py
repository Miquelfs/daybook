"""
Drop the unused grocery scaffold from daybook.db (pantry_items, price_history,
meal_plans, grocery_purchases, grocery_purchase_items). Nothing ever read or wrote
them; supermarket tickets now live in money.db (receipts, receipt_items).

Only daybook.db is touched — money.db has its own, live `price_history` (portfolio
prices). Any leftover rows are printed to the API log before the drop.
Idempotent; runs at API startup.
"""

from infrastructure.db.connection import get_connection

TABLES = ["grocery_purchase_items", "grocery_purchases", "price_history", "meal_plans", "pantry_items"]


def migrate(conn) -> list[str]:
    dropped = []
    for t in TABLES:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone():
            continue
        for row in conn.execute(f"SELECT * FROM {t}"):
            print(f"[drop old groceries] {t}: {dict(row) if hasattr(row, 'keys') else tuple(row)}")
        conn.execute(f"DROP TABLE {t}")
        dropped.append(t)
    conn.commit()
    return dropped


if __name__ == "__main__":
    c = get_connection()
    print(f"dropped: {migrate(c)}")
    c.close()
