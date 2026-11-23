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
    vehicle_id       INTEGER,                -- a car / scooter cost (vehicles.id)
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- User-managed finance accounts. Historically account names + their types were
-- hardcoded in money_config.py (INVESTMENT_ACCOUNTS / LIQUID_ACCOUNTS). This
-- table lets the user create new accounts from the UI and pick their type, so a
-- freshly-created account is classified correctly (net-worth bucketing, liquid
-- strip) instead of falling through to "Unknown". Classification code reads this
-- table first and falls back to the config dicts for legacy accounts.
CREATE TABLE IF NOT EXISTS accounts (
    name          TEXT PRIMARY KEY,
    account_type  TEXT NOT NULL,   -- 'Checking'|'Savings'|'Investment'|'Crypto Investment'
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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

-- ─── Supermarket tickets ─────────────────────────────────────────────────────
-- A grocery expense can carry the ticket it paid for (one per transaction). The
-- PDF lives on the Pi in data/receipts/; its lines are parsed into receipt_items
-- (product exactly as printed — Mercadona's names are stable across tickets).

CREATE TABLE IF NOT EXISTS receipts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id  TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    store           TEXT NOT NULL,
    purchased_at    TEXT,                   -- 'YYYY-MM-DD HH:MM' as printed on the ticket
    invoice_no      TEXT,
    total           REAL NOT NULL,
    pdf_path        TEXT NOT NULL,          -- relative to data/receipts/ ('' for screenshot tickets)
    files_json      TEXT,                   -- screenshot tickets: ["12-1.png", "12-2.png"]
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS receipt_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id  INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    line_no     INTEGER NOT NULL,
    product     TEXT NOT NULL,              -- 'QUESO GRANA PADANO'
    quantity    REAL NOT NULL DEFAULT 1,
    weight_kg   REAL,                       -- loose produce only
    unit_price  REAL,                       -- € per unit, or €/kg when weight_kg is set
    amount      REAL NOT NULL
);

-- Per-product overrides of the keyword rules in domains/money/groceries.py
CREATE TABLE IF NOT EXISTS grocery_products (
    product     TEXT PRIMARY KEY,
    grp         TEXT,                       -- NULL = use the rule
    avoid       INTEGER,                    -- NULL = use the rule
    generic     TEXT,                       -- 'tofu natural' — matches the same thing across stores
    pack_g      REAL,                       -- printed pack size in g / ml, if any
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_product ON receipt_items(product);

-- App-editable money settings (e.g. savings_goal); defaults live in money_config.py
CREATE TABLE IF NOT EXISTS money_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

-- ─── Bank statements (reconciliation) ────────────────────────────────────────
-- Expenses are still typed by hand in Daybook; a statement exported from the bank
-- (CSV / XLSX / XLS / PDF) is only a check against them. Its lines are kept per
-- account, deduplicated by fingerprint so overlapping exports never double up,
-- and matched against `transactions` on every read (domains/money/statements.py).
CREATE TABLE IF NOT EXISTS statement_imports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account        TEXT NOT NULL,
    filename       TEXT,
    bank           TEXT,                      -- parser's guess ('BBVA', 'Revolut', …)
    period_start   TEXT,
    period_end     TEXT,
    lines_total    INTEGER NOT NULL DEFAULT 0,
    lines_new      INTEGER NOT NULL DEFAULT 0,
    imported_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS statement_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id      INTEGER NOT NULL REFERENCES statement_imports(id) ON DELETE CASCADE,
    account        TEXT NOT NULL,
    date           TEXT NOT NULL,             -- YYYY-MM-DD (operation date when the bank gives one)
    seq            INTEGER NOT NULL DEFAULT 0,-- chronological order within the import
    description    TEXT NOT NULL,
    amount         REAL NOT NULL,             -- bank sign: negative = money out
    balance        REAL,                      -- running balance after this line, when the bank prints it
    currency       TEXT,
    fingerprint    TEXT NOT NULL,
    txn_id         TEXT,                      -- a link you made by hand (or by "Add to Daybook")
    ignored        INTEGER NOT NULL DEFAULT 0,-- "not an expense to track" (internal move, hold…)
    kind           TEXT,                      -- statements.KINDS: card, transfer, investment, interest…
    UNIQUE (account, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_stmt_lines_acct_date ON statement_lines(account, date);

-- "Settle the gap": the period is closed — what's left of it is booked as 🚨 Alert and its lines
-- stop showing as only-in-bank / only-in-Daybook.
CREATE TABLE IF NOT EXISTS statement_settlements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account        TEXT NOT NULL,
    start          TEXT NOT NULL,
    through        TEXT NOT NULL,
    settled_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─── Vehicles (car, scooter) ─────────────────────────────────────────────────
-- Costs are ordinary Transportation expenses: linked by transactions.vehicle_id,
-- or (for history) by subcategory. Kilometres come from odometer readings; routes
-- from the GPS on days carrying the vehicle's day tag (domains/vehicles/).
CREATE TABLE IF NOT EXISTS vehicles (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'car',   -- 'car' | 'scooter' | 'motorbike' | 'other'
    make_model     TEXT,
    plate          TEXT,
    year           INTEGER,
    fuel           TEXT,                          -- 'petrol' | 'diesel' | 'electric' | 'hybrid'
    bought_on      TEXT,
    bought_km      REAL,
    bought_price   REAL,
    sold_on        TEXT,
    day_tag        TEXT,                          -- tag slug marking the days you used it
    subcategories  TEXT NOT NULL DEFAULT '[]',    -- JSON: Transportation subcategories that are this vehicle's
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS vehicle_odometer (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    date           TEXT NOT NULL,
    km             REAL NOT NULL,
    note           TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_odo_vehicle ON vehicle_odometer(vehicle_id, date);

-- Every leg the GPS saw at vehicle speed (not a Garmin activity), cached per day — tagged days
-- for all history, every day for the last few weeks — and who drove it: the one vehicle whose day
-- tag is on that day, or your pick (untagged days, days with both tags). domains/vehicles/routes.py
CREATE TABLE IF NOT EXISTS vehicle_legs (
    date           TEXT NOT NULL,
    start          TEXT NOT NULL,                 -- ISO time the leg started
    end            TEXT NOT NULL,
    km             REAL NOT NULL,
    minutes        REAL NOT NULL,
    start_place    TEXT,
    end_place      TEXT,
    route          TEXT,                          -- JSON [[lat,lng], …], thinned
    vehicle_id     INTEGER,                       -- NULL = nobody's yet
    how            TEXT,                          -- 'tag' | 'pick' | 'untagged' | 'both' | 'not_mine'
    PRIMARY KEY (date, start)
);
CREATE INDEX IF NOT EXISTS idx_legs_vehicle ON vehicle_legs(vehicle_id, date);

-- Your pick for a leg (vehicle_id 0 = not mine: a bus, a taxi, a friend's car). Kept apart so a
-- re-read of the GPS keeps it (matched to the leg starting within 15 min).
CREATE TABLE IF NOT EXISTS vehicle_leg_picks (
    date           TEXT NOT NULL,
    start          TEXT NOT NULL,
    vehicle_id     INTEGER NOT NULL,
    end            TEXT,                -- set when picked on the day map: the stretch you tapped
    PRIMARY KEY (date, start)
);

CREATE TABLE IF NOT EXISTS vehicle_scan (
    date           TEXT PRIMARY KEY,
    legs           INTEGER NOT NULL DEFAULT 0,
    reader         INTEGER NOT NULL DEFAULT 0,   -- routes.READER that read it; an older one is read again
    scanned_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ITV, insurance, oil change…: due every N months and/or every N km from the last time, or on a
-- fixed date. Each keeps one open task in Plan (daybook.db → tasks, area 'vehicles'); completing it
-- there or here starts the next cycle. domains/vehicles/reminders.py
CREATE TABLE IF NOT EXISTS vehicle_reminders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    every_months   INTEGER,
    every_km       REAL,
    last_date      TEXT,
    last_km        REAL,
    due_date       TEXT,                          -- a fixed date (renewal), overrides every_months once
    remind_days    INTEGER NOT NULL DEFAULT 30,
    task_id        INTEGER,                       -- the open Plan task
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
