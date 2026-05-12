-- Money / Finance schema for money.db
-- Separate from daybook.db so finance data is fully isolated.
-- All amounts stored with Notion sign convention: negative = expense outflow, positive = income/deposit.

CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,       -- notion_page_id OR 'local-' + uuid4
    source           TEXT NOT NULL DEFAULT 'notion',  -- 'notion' | 'local'
    notion_id        TEXT UNIQUE,            -- null for locally-created entries
    date             TEXT NOT NULL,          -- YYYY-MM-DD
    name             TEXT NOT NULL,          -- merchant / description
    amount           REAL NOT NULL,          -- raw sign: neg=expense, pos=income
    account          TEXT,
    category         TEXT,
    subcategory      TEXT,
    transaction_type TEXT NOT NULL,          -- 'Expense'|'Income'|'Transfer'|'Account Setup'|'Finance'
    notes            TEXT,
    deleted_at       TEXT,                   -- soft delete (ISO timestamp)
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS budgets (
    year_month  TEXT NOT NULL,   -- YYYY-MM (most-recent applicable version logic in code)
    category    TEXT NOT NULL,
    amount      REAL NOT NULL,
    PRIMARY KEY (year_month, category)
);

CREATE TABLE IF NOT EXISTS money_sync_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source            TEXT NOT NULL DEFAULT 'notion',
    run_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status            TEXT NOT NULL,
    records_upserted  INTEGER NOT NULL DEFAULT 0,
    records_skipped   INTEGER NOT NULL DEFAULT 0,
    error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_account  ON transactions(account);
CREATE INDEX IF NOT EXISTS idx_txn_name     ON transactions(name);
CREATE INDEX IF NOT EXISTS idx_txn_type     ON transactions(transaction_type);
