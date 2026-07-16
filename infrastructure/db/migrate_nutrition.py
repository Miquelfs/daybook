"""
Nutrition / fueling module — the "fourth discipline".

Tables:
- nutrition_products     product library (gels, drink mixes, bars, chews, real food)
- fueling_logs           per-session carbs/fluids/sodium/caffeine + GI feedback
- sweat_tests            pre/post weight tests → personal sweat rate by conditions
- race_nutrition_plans   generated race-day plan (JSON) attached to a goal

Idempotent. Seeds a handful of common products on first run.
Run: python -m infrastructure.db.migrate_nutrition
"""

import json

from infrastructure.db.connection import get_connection


_SEED_PRODUCTS = [
    # name, kind, carbs_g, sodium_mg, caffeine_mg, fluid_ml, ratio, notes
    ("Energy gel (generic)",        "gel",       25, 30,   0,   0, "2:1",  "Take with ~150ml water"),
    ("Caffeine gel",                "gel",       25, 40,  100,  0, "2:1",  "Save for bike hour 2 / run start"),
    ("Isotonic drink 500ml",        "drink_mix", 30, 460,  0, 500, "2:1",  "~6% carb, race bottle"),
    ("High-carb drink mix 500ml",   "drink_mix", 80, 400,  0, 500, "2:1",  "~16% carb, cool-condition fuelling"),
    ("Energy bar",                  "bar",       40, 100,  0,   0, "n/a",  "Lower intensity only"),
    ("Energy chews (pack)",         "chew",      30,  50,  0,   0, "2:1",  "5 chews ~ 30g"),
    ("Banana",                      "real_food", 24,   1,  0,   0, "n/a",  "Cheap real-food carbs"),
    ("Cola (250ml, flat)",          "drink_mix", 26,  10, 25, 250, "n/a",  "Late-race pick-me-up"),
]


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS nutrition_products (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            name                   TEXT NOT NULL,
            kind                   TEXT NOT NULL,   -- gel|drink_mix|bar|chew|real_food
            carbs_g                REAL NOT NULL DEFAULT 0,
            sodium_mg              REAL NOT NULL DEFAULT 0,
            caffeine_mg            REAL NOT NULL DEFAULT 0,
            fluid_ml               REAL NOT NULL DEFAULT 0,
            glucose_fructose_ratio TEXT,
            notes                  TEXT,
            archived               INTEGER NOT NULL DEFAULT 0,
            created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS fueling_logs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            date            TEXT NOT NULL,
            plan_session_id INTEGER REFERENCES plan_sessions(id) ON DELETE SET NULL,
            activity_id     TEXT,
            duration_min    INTEGER,
            carbs_g         REAL,
            fluids_ml       REAL,
            sodium_mg       REAL,
            caffeine_mg     REAL,
            gi_severity     INTEGER,               -- 1 (none) .. 5 (severe)
            gi_notes        TEXT,
            products_json   TEXT,                  -- [{product_id, qty}]
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fueling_logs_date    ON fueling_logs(date);
        CREATE INDEX IF NOT EXISTS idx_fueling_logs_session ON fueling_logs(plan_session_id);

        CREATE TABLE IF NOT EXISTS sweat_tests (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            date            TEXT NOT NULL,
            sport           TEXT NOT NULL,
            duration_min    INTEGER NOT NULL,
            temp_c          REAL,
            conditions      TEXT,                  -- indoor|cool|warm|hot|humid
            weight_pre_kg   REAL NOT NULL,
            weight_post_kg  REAL NOT NULL,
            fluid_intake_ml REAL NOT NULL DEFAULT 0,
            urine_ml        REAL NOT NULL DEFAULT 0,
            sweat_rate_l_h  REAL,                  -- computed on insert
            notes           TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sweat_tests_date ON sweat_tests(date);

        CREATE TABLE IF NOT EXISTS race_nutrition_plans (
            goal_id     INTEGER PRIMARY KEY REFERENCES race_goals(id) ON DELETE CASCADE,
            plan_json   TEXT NOT NULL,
            updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
    """)

    # Seed products only if the table is empty (never re-seed / duplicate)
    existing = conn.execute("SELECT COUNT(*) AS c FROM nutrition_products").fetchone()
    if not existing["c"]:
        for (name, kind, carbs, sodium, caff, fluid, ratio, notes) in _SEED_PRODUCTS:
            conn.execute(
                """INSERT INTO nutrition_products
                   (name, kind, carbs_g, sodium_mg, caffeine_mg, fluid_ml,
                    glucose_fructose_ratio, notes)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (name, kind, carbs, sodium, caff, fluid, ratio, notes),
            )
        print(f"Seeded {len(_SEED_PRODUCTS)} nutrition products.")

    conn.commit()
    print("nutrition tables ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
