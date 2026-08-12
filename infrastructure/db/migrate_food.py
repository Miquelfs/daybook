"""
Food / dietary-intake module — calorie + macro logging (the intake side).

Complements the energy-OUT side that already exists (Garmin daily_stats
active/total calories + per-activity calories). Distinct from the `nutrition`
domain, which is endurance race-fuelling (gels/carbs/sodium), not diet.

Tables:
- food_entries        one row per logged item (text/photo/preset), with macros
- food_targets        auto-suggested + manually-overridable daily kcal/protein target
- crew_meal_presets   PMI Gate Gourmet crew-meal menu, for one-tap duty-day logging
- food_meal_plans     AI "what to eat" suggestions (JSON) per day

Idempotent. Seeds the PMI crew-meal presets on first run.
Macro values on the presets are best-effort per-item ESTIMATES.
Run: python -m infrastructure.db.migrate_food
"""

from infrastructure.db.connection import get_connection


# ── PMI crew-meal presets (from the Gate Gourmet RFP PDF) ─────────────────────
# name, category, meal_type, kcal, protein_g, carbs_g, fat_g, weight_g
# Macros are approximate estimates for a base at PMI.
_SEED_PRESETS = [
    # Fix items --------------------------------------------------------------
    ("Extra virgin olive oil (10ml)", "fix", "extra", 90, 0, 0, 10, 10),
    ("Vinegar (10ml)",                "fix", "extra", 2, 0, 0, 0, 10),
    ("Butter (10g)",                  "fix", "extra", 72, 0, 0, 8, 10),
    ("White bread (55g)",             "fix", "extra", 145, 5, 27, 2, 55),
    ("Whole wheat bread (55g)",       "fix", "extra", 135, 6, 24, 2, 55),
    ("Natural greek yogurt, unsweetened (110g)", "fix", "breakfast", 65, 10, 4, 2, 110),
    ("Oikos apple-cinnamon yogurt (110g)",       "fix", "breakfast", 110, 5, 17, 3, 110),
    ("Kit Kat", "chocolate", "snack", 209, 3, 26, 11, 42),
    # Fruit tray -------------------------------------------------------------
    ("Apple",  "fruit", "snack", 78, 0, 21, 0, 150),
    ("Pear",   "fruit", "snack", 100, 1, 27, 0, 170),
    ("Banana", "fruit", "snack", 105, 1, 27, 0, 120),
    # Juices -----------------------------------------------------------------
    ("Orange juice",             "juice", "extra", 90, 2, 21, 0, 200),
    ("Pineapple and grape juice", "juice", "extra", 110, 1, 27, 0, 200),
    # Salads (250g) ----------------------------------------------------------
    ("Fusilli and roasted vegetables salad (250g)", "salad", "lunch", 320, 8, 42, 12, 250),
    ("Green beans and potato salad (250g)",          "salad", "lunch", 210, 6, 30, 7, 250),
    ("Baby mozzarella and green olives salad (250g)", "salad", "lunch", 280, 12, 10, 21, 250),
    ("Riso pasta salad with goat cheese (250g)",     "salad", "lunch", 340, 11, 40, 15, 250),
    ("Tartar potato salad (250g)",                   "salad", "lunch", 300, 6, 30, 17, 250),
    ("Beetroot and egg salad (250g)",                "salad", "lunch", 230, 10, 20, 12, 250),
    ("Beetroot, carrot and pumpkin seeds sweet & sour salad (250g)", "salad", "lunch", 240, 6, 28, 12, 250),
    # Hot entrées ------------------------------------------------------------
    ("Chicken Zürich style (400g)",           "hot_entree", "dinner", 520, 30, 45, 24, 400),
    ("Hake with roasted potatoes (450g)",     "hot_entree", "dinner", 430, 32, 40, 15, 450),
    ("Thai curry vegan (482g)",               "hot_entree", "dinner", 470, 12, 60, 18, 482),
    ("Pumpkin chickpea curry (500g)",         "hot_entree", "dinner", 450, 15, 62, 15, 500),
    ("Porcini ravioli mushroom sauce (491g)", "hot_entree", "dinner", 560, 18, 65, 24, 491),
    ("Meatballs with lingonberries (510g)",   "hot_entree", "dinner", 620, 32, 55, 30, 510),
    ("Chicken with potatoes (450g)",          "hot_entree", "dinner", 500, 35, 45, 20, 450),
    ("Lasagne poultry bolognese (500g)",      "hot_entree", "dinner", 620, 34, 55, 28, 500),
    ("Vegetable masala cumin rice (510g)",    "hot_entree", "dinner", 520, 12, 80, 16, 510),
    ("Vegetable red thai curry (460g)",       "hot_entree", "dinner", 480, 11, 62, 20, 460),
    ("Salmon tarragon sauce (480g)",          "hot_entree", "dinner", 540, 34, 30, 30, 480),
    ("Chicken tikka (480g)",                  "hot_entree", "dinner", 560, 38, 45, 24, 480),
    # Tapas (160g) -----------------------------------------------------------
    ("Tapas: cheese, serrano ham, fuet (160g)",           "tapas", "snack", 480, 30, 2, 38, 160),
    ("Tapas: cheese, turkey, salchichon (160g)",          "tapas", "snack", 430, 32, 3, 32, 160),
    ("Tapas: serrano ham, manchego cheese, lacón (160g)", "tapas", "snack", 470, 34, 2, 36, 160),
    ("Tapas: chorizo, camembert, bologna mortadela (160g)", "tapas", "snack", 500, 26, 3, 42, 160),
    ("Tapas: boiled ham, fuet, gouda (160g)",             "tapas", "snack", 460, 30, 2, 36, 160),
    ("Tapas: salchichon, soft cheese, braised turkey (160g)", "tapas", "snack", 440, 30, 3, 33, 160),
    # Sandwiches (~160g) -----------------------------------------------------
    ("Sandwich spanish chorizo",   "sandwich", "snack", 420, 16, 40, 22, 160),
    ("Sandwich cheese",            "sandwich", "snack", 400, 16, 42, 18, 160),
    ("Sandwich ham & cheese",      "sandwich", "snack", 410, 22, 40, 18, 160),
    ("Sandwich salchichon",        "sandwich", "snack", 440, 18, 40, 24, 160),
    ("Sandwich serrano ham",       "sandwich", "snack", 380, 20, 40, 15, 160),
    ("Sandwich seared turkey",     "sandwich", "snack", 360, 22, 40, 12, 160),
]


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS food_entries (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            date          TEXT NOT NULL,        -- YYYY-MM-DD
            meal_type     TEXT,                 -- breakfast|lunch|dinner|snack|extra
            description   TEXT NOT NULL,
            source        TEXT NOT NULL DEFAULT 'text',  -- text|photo|preset
            photo_path    TEXT,                 -- relative path under data/photos/
            kcal          REAL NOT NULL DEFAULT 0,
            protein_g     REAL NOT NULL DEFAULT 0,
            carbs_g       REAL NOT NULL DEFAULT 0,
            fat_g         REAL NOT NULL DEFAULT 0,
            sugar_g       REAL NOT NULL DEFAULT 0,
            ai_confidence REAL,                 -- 0..1 when AI-estimated
            ai_raw_json   TEXT,                 -- raw analyzer output, for audit
            logged_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_food_entries_date ON food_entries(date);

        CREATE TABLE IF NOT EXISTS food_targets (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            effective_date   TEXT NOT NULL,      -- YYYY-MM-DD; latest <= today is active
            maintenance_kcal REAL,               -- suggested from Garmin trailing avg
            deficit_kcal     REAL,               -- user-chosen
            target_kcal      REAL NOT NULL,
            protein_g        REAL NOT NULL,
            basis_weight_kg  REAL,               -- weight the protein goal was derived from
            method           TEXT NOT NULL DEFAULT 'auto',  -- auto|manual
            notes            TEXT,
            created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_food_targets_date ON food_targets(effective_date);

        CREATE TABLE IF NOT EXISTS crew_meal_presets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            category   TEXT NOT NULL,   -- fix|fruit|chocolate|juice|salad|hot_entree|tapas|sandwich
            meal_type  TEXT,
            kcal       REAL NOT NULL DEFAULT 0,
            protein_g  REAL NOT NULL DEFAULT 0,
            carbs_g    REAL NOT NULL DEFAULT 0,
            fat_g      REAL NOT NULL DEFAULT 0,
            weight_g   REAL,
            location   TEXT NOT NULL DEFAULT 'PMI',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crew_presets_location ON crew_meal_presets(location);

        CREATE TABLE IF NOT EXISTS food_meal_plans (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            date         TEXT NOT NULL,
            plan_json    TEXT NOT NULL,
            model        TEXT,
            generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_food_meal_plans_date ON food_meal_plans(date);

        CREATE TABLE IF NOT EXISTS water_log (
            date       TEXT PRIMARY KEY,      -- YYYY-MM-DD, one running total per day
            ml         REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS food_coach (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            date         TEXT NOT NULL,
            coach_json   TEXT NOT NULL,        -- {next_meal, alternatives, avoid, tip}
            model        TEXT,
            generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_food_coach_date ON food_coach(date);

        CREATE TABLE IF NOT EXISTS food_weekly_plans (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            week_start   TEXT NOT NULL,        -- YYYY-MM-DD (Monday)
            plan_json    TEXT NOT NULL,        -- {days:[...], shopping_list:[...], note}
            model        TEXT,
            generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_food_weekly_plans_week ON food_weekly_plans(week_start);
    """)

    # Idempotent column adds for DBs created before a column existed.
    _food_cols = [r[1] for r in conn.execute("PRAGMA table_info(food_entries)")]
    if "sugar_g" not in _food_cols:
        conn.execute("ALTER TABLE food_entries ADD COLUMN sugar_g REAL NOT NULL DEFAULT 0")
    if "eaten_at" not in _food_cols:
        # Local wall-clock time the food was eaten (YYYY-MM-DDTHH:MM), user-editable.
        # NULL = fall back to logged_at. Powers meal-time habit tracking + the timeline.
        conn.execute("ALTER TABLE food_entries ADD COLUMN eaten_at TEXT")
    # Heart-health (cholesterol) fields — saturated fat & fibre estimates plus a
    # rating (good/ok/limit/avoid) + note, so each logged food is flagged.
    for col, ddl in (
        ("saturated_fat_g", "ALTER TABLE food_entries ADD COLUMN saturated_fat_g REAL"),
        ("fiber_g",         "ALTER TABLE food_entries ADD COLUMN fiber_g REAL"),
        ("heart_rating",    "ALTER TABLE food_entries ADD COLUMN heart_rating TEXT"),
        ("heart_note",      "ALTER TABLE food_entries ADD COLUMN heart_note TEXT"),
    ):
        if col not in _food_cols:
            conn.execute(ddl)

    # Seed crew presets only if the table is empty (never re-seed / duplicate).
    existing = conn.execute("SELECT COUNT(*) AS c FROM crew_meal_presets").fetchone()
    if not existing["c"]:
        for (name, category, meal_type, kcal, protein, carbs, fat, weight) in _SEED_PRESETS:
            conn.execute(
                """INSERT INTO crew_meal_presets
                   (name, category, meal_type, kcal, protein_g, carbs_g, fat_g, weight_g, location)
                   VALUES (?,?,?,?,?,?,?,?, 'PMI')""",
                (name, category, meal_type, kcal, protein, carbs, fat, weight),
            )
        print(f"Seeded {len(_SEED_PRESETS)} PMI crew-meal presets.")

    conn.commit()
    print("food tables ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
