"""
Finance domain constants — ported from data_fetcher.py in the Notion dashboard.
No pandas dependency; plain Python only.
"""

# ── Budget versions ────────────────────────────────────────────────────────────
# Keyed by YYYY-MM (effective-from month).  get_budget_for_month() picks the
# most-recent applicable version for any given month.

BUDGET_VERSIONS: dict[str, dict[str, float]] = {
    "2025-09": {
        "Restaurant":    450,
        "Groceries":     350,
        "Transportation": 250,
        "Sports":        150,
        "Tech":           35,
        "Gifts":         100,
        "Trips":         300,
        "Home":         1000,
        "OMYRA":          10,
        "Personal":       10,
        "Alert":           5,
    }
}

DEFAULT_EXPECTED_MONTHLY_INCOME: float = 3500
MONTHLY_SAVINGS_GOAL: float = 1300

# ── Category classification ────────────────────────────────────────────────────

INCOME_CATEGORIES: set[str] = {"Income", "OMYRA"}
SPECIAL_CATEGORIES: set[str] = {"Account Setup", "Transfer"}
FINANCE_CATEGORIES: set[str] = {"Finance"}

# Notion occasionally uses legacy category names; map them before classifying
CATEGORY_MAPPING: dict[str, str] = {
    "Food and Beverages": "Restaurant",
}

# ── Account classification ─────────────────────────────────────────────────────

INVESTMENT_ACCOUNTS: dict[str, str] = {
    "Trade Republic Wealth": "Investment",
    "BBVA Investment":       "Investment",
    "Accions":               "Investment",
    "Binance":               "Crypto Investment",
}

LIQUID_ACCOUNTS: dict[str, str] = {
    "BBVA Diaria":                  "Checking",
    "BBVA Estalvis":                "Savings",
    "Revolut":                      "Checking",
    "Revolut Flexible Cash Funds":  "Checking",
    "Trade Republic Cash":          "Savings",
}

# ── UI metadata ───────────────────────────────────────────────────────────────

CATEGORY_EMOJI: dict[str, str] = {
    "Restaurant":    "🍴",
    "Groceries":     "🛒",
    "Transportation": "🚗",
    "Sports":        "🏋",
    "Tech":          "💻",
    "Gifts":         "🎁",
    "Trips":         "✈️",
    "Home":          "🏠",
    "Personal":      "🧴",
    "Alert":         "🚨",
    "Income":        "💰",
    "OMYRA":         "📱",
    "Finance":       "📊",
}

# Ordered list of expense categories shown in entry UI (most-used first)
EXPENSE_CATEGORIES: list[str] = [
    "Restaurant", "Groceries", "Transportation", "Home",
    "Sports", "Trips", "Tech", "Gifts", "Personal", "Alert",
]


# ── Helper functions ──────────────────────────────────────────────────────────

def classify(category: str | None) -> str:
    """Return transaction_type string for a given category (mirrors classify_transaction)."""
    if category is None:
        return "Expense"
    cat = CATEGORY_MAPPING.get(category, category)
    if cat in SPECIAL_CATEGORIES:
        return cat           # 'Account Setup' or 'Transfer'
    if cat in FINANCE_CATEGORIES:
        return "Finance"
    if cat in INCOME_CATEGORIES:
        return "Income"
    return "Expense"


def get_budget_for_month(year_month: str) -> dict[str, float]:
    """Return most-recent budget version applicable to year_month."""
    applicable = [k for k in BUDGET_VERSIONS if k <= year_month]
    if not applicable:
        return BUDGET_VERSIONS[min(BUDGET_VERSIONS.keys())]
    return BUDGET_VERSIONS[max(applicable)]
