-- Groceries domain schema
-- Run via migrate_groceries.py

CREATE TABLE IF NOT EXISTS pantry_items (
  id TEXT PRIMARY KEY,                  -- slug e.g. "leche-entera-1l"
  mercadona_id TEXT UNIQUE,             -- Mercadona product ID (nullable for non-Mercadona items)
  name TEXT NOT NULL,
  unit TEXT,                            -- kg, L, ud, etc.
  category TEXT,                        -- dairy, produce, meat, etc.
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT REFERENCES pantry_items(id),
  date TEXT NOT NULL,                   -- YYYY-MM-DD
  price_eur REAL,
  unit_price REAL,                      -- normalized €/kg or €/L
  store TEXT DEFAULT 'mercadona',
  raw_payload TEXT                      -- full JSON from CLI or scrape
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,             -- YYYY-MM-DD (Monday)
  meals_json TEXT,                      -- LLM-generated meal list as JSON
  budget_eur REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grocery_purchases (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,                   -- links to days.date
  receipt_photo_path TEXT,
  total_eur REAL,
  store TEXT DEFAULT 'mercadona',
  source TEXT DEFAULT 'receipt',        -- receipt | receipt_other | manual
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grocery_purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id TEXT REFERENCES grocery_purchases(id),
  pantry_item_id TEXT REFERENCES pantry_items(id),  -- nullable if unmatched
  raw_name TEXT NOT NULL,
  qty REAL,
  unit_price REAL,
  total_price REAL
);

CREATE INDEX IF NOT EXISTS idx_price_history_item_date ON price_history(item_id, date);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON grocery_purchases(date);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON grocery_purchase_items(purchase_id);
