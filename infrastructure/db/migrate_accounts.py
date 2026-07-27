"""
User-managed accounts table. Lets accounts be created from the UI (money +
portfolio tabs) with an explicit type, instead of relying on the hardcoded
INVESTMENT_ACCOUNTS / LIQUID_ACCOUNTS dicts in money_config.py.

Seeds the table with the existing hardcoded accounts so classification is
unchanged for legacy data; new accounts the user creates are stored here too.

Idempotent. Run on the Pi: python -m infrastructure.db.migrate_accounts
"""

from infrastructure.db.money_connection import get_money_connection
from domains.money.money_config import INVESTMENT_ACCOUNTS, LIQUID_ACCOUNTS


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            name          TEXT PRIMARY KEY,
            account_type  TEXT NOT NULL,
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
    """)

    seeded = 0
    for name, acct_type in {**LIQUID_ACCOUNTS, **INVESTMENT_ACCOUNTS}.items():
        cur = conn.execute(
            "INSERT OR IGNORE INTO accounts (name, account_type) VALUES (?, ?)",
            (name, acct_type),
        )
        seeded += cur.rowcount

    # Any account already referenced by a transaction or holding but missing
    # from the seed dicts gets registered as "Unknown" so it shows up in the
    # manager and can be re-typed.
    for row in conn.execute(
        """SELECT DISTINCT account AS name FROM transactions
             WHERE account IS NOT NULL AND deleted_at IS NULL
           UNION
           SELECT DISTINCT account AS name FROM holdings"""
    ).fetchall():
        cur = conn.execute(
            "INSERT OR IGNORE INTO accounts (name, account_type) VALUES (?, 'Unknown')",
            (row["name"],),
        )
        seeded += cur.rowcount

    conn.commit()
    total = conn.execute("SELECT COUNT(*) AS n FROM accounts").fetchone()["n"]
    print(f"accounts table ready — {seeded} rows seeded, {total} total.")


if __name__ == "__main__":
    conn = get_money_connection()
    migrate(conn)
    conn.close()
