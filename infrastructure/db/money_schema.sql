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
    source_id        TEXT UNIQUE,            -- external dedup key (FinanceKit UUID, etc.)
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

-- ─── Investment Holdings (Track A-I) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS holdings (
    id                TEXT PRIMARY KEY,       -- slug like "trade-republic-VWCE"
    account           TEXT NOT NULL,          -- FK to accounts in money_config.py
    ticker            TEXT NOT NULL,          -- yfinance symbol (VWCE.DE, BTC-EUR, AAPL)
    isin              TEXT,                   -- ISO 6166 identifier (IE00BK5BQT80). Optional but preferred for ETFs/funds.
    name              TEXT NOT NULL,          -- human-friendly name
    asset_class       TEXT NOT NULL,          -- 'equity_etf'|'stock'|'crypto'|'bond_etf'|'cash'|'commodity'
    currency          TEXT NOT NULL DEFAULT 'EUR',
    quantity          REAL NOT NULL,
    cost_basis_eur    REAL,                   -- what user paid in EUR (nullable if unknown)
    first_bought_at   TEXT,                   -- YYYY-MM-DD
    notes             TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,   -- 0 when fully sold
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS price_history (
    ticker           TEXT NOT NULL,
    date             TEXT NOT NULL,           -- YYYY-MM-DD
    close_price      REAL NOT NULL,           -- native currency
    close_price_eur  REAL NOT NULL,           -- converted to EUR
    currency         TEXT NOT NULL,
    fx_rate          REAL,                    -- native → EUR (1.0 if already EUR)
    source           TEXT NOT NULL DEFAULT 'yfinance',
    fetched_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS holding_snapshots (
    date          TEXT NOT NULL,              -- YYYY-MM-DD
    holding_id    TEXT NOT NULL,
    quantity      REAL NOT NULL,
    price_eur     REAL NOT NULL,
    value_eur     REAL NOT NULL,
    PRIMARY KEY (date, holding_id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account, is_active);
CREATE INDEX IF NOT EXISTS idx_holdings_ticker  ON holdings(ticker);
CREATE INDEX IF NOT EXISTS idx_holdings_isin    ON holdings(isin);
CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON price_history(ticker);
CREATE INDEX IF NOT EXISTS idx_holding_snapshots_holding ON holding_snapshots(holding_id, date);

-- ─── Recurring Investment Plans (DCA) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS investment_plans (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    holding_id             TEXT NOT NULL,
    source_account         TEXT NOT NULL,          -- where the money comes from (e.g. BBVA Diaria)
    amount_eur             REAL NOT NULL,          -- EUR contributed per period
    cadence                TEXT NOT NULL,          -- 'weekly'|'biweekly'|'monthly'|'quarterly'|'yearly'
    day_of_month           INTEGER,                -- 1..31 for monthly/quarterly/yearly (clamped to month length)
    day_of_week            INTEGER,                -- 0..6 (Mon=0) for weekly/biweekly
    start_date             TEXT NOT NULL,
    end_date               TEXT,                   -- nullable = open-ended
    next_execution_date    TEXT NOT NULL,
    last_executed_at       TEXT,
    is_active              INTEGER NOT NULL DEFAULT 1,
    notes                  TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS investment_plan_executions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id           INTEGER NOT NULL,
    execution_date    TEXT NOT NULL,
    amount_eur        REAL NOT NULL,
    price_eur         REAL NOT NULL,
    quantity_added    REAL NOT NULL,
    transaction_id    TEXT,                        -- link to the ledger row we created
    status            TEXT NOT NULL,               -- 'success'|'no_price'|'skipped'
    notes             TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (plan_id, execution_date),
    FOREIGN KEY (plan_id) REFERENCES investment_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_investment_plans_active ON investment_plans(is_active, next_execution_date);
CREATE INDEX IF NOT EXISTS idx_investment_plans_holding ON investment_plans(holding_id);
CREATE INDEX IF NOT EXISTS idx_plan_exec_plan ON investment_plan_executions(plan_id, execution_date);
