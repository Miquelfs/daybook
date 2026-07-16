"""
Realized trades — one row per sale, preserving the gain/loss at the moment of
selling. Without this, a closed position's P&L vanishes from the portfolio
(the holding deactivates and its cost basis is pro-rated away).

Idempotent. Run: python -m infrastructure.db.migrate_realized_trades
"""

from infrastructure.db.money_connection import get_money_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS realized_trades (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            holding_id           TEXT NOT NULL,
            ticker               TEXT NOT NULL,
            name                 TEXT NOT NULL,
            account              TEXT NOT NULL,
            date                 TEXT NOT NULL,
            quantity             REAL NOT NULL,
            price_eur            REAL NOT NULL,
            proceeds_eur         REAL NOT NULL,
            cost_basis_sold_eur  REAL,     -- NULL when avg cost was unknown
            realized_pnl_eur     REAL,     -- proceeds − cost sold (NULL if unknown)
            transaction_id       TEXT,     -- the Finance txn booking the proceeds
            created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_realized_trades_date ON realized_trades(date);
        CREATE INDEX IF NOT EXISTS idx_realized_trades_holding ON realized_trades(holding_id);
    """)
    conn.commit()
    print("realized_trades table ready.")


if __name__ == "__main__":
    conn = get_money_connection()
    migrate(conn)
    conn.close()
