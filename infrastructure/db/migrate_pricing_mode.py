"""
Manual-valuation assets — adds holdings.pricing_mode ('market'|'manual').

'market' holdings are priced nightly via yfinance; 'manual' holdings
(real estate, pension plans, unlisted funds) get their value set by hand
through POST /money/portfolio/holdings/{id}/value.

Idempotent. Run: python -m infrastructure.db.migrate_pricing_mode
"""

from infrastructure.db.money_connection import get_money_connection


def migrate(conn):
    cols = [r[1] for r in conn.execute("PRAGMA table_info(holdings)").fetchall()]
    if "pricing_mode" in cols:
        print("holdings.pricing_mode already exists — nothing to do.")
        return
    conn.execute(
        "ALTER TABLE holdings ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'market'"
    )
    conn.commit()
    print("holdings.pricing_mode added (default 'market').")


if __name__ == "__main__":
    conn = get_money_connection()
    migrate(conn)
    conn.close()
