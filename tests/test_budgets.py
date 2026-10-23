"""Editable budgets / savings goal, next-month budget plan, and this month's income projection."""

import datetime as _dt
import sqlite3
import unittest

from domains.money import budgets, income
from domains.money.money_config import MONTHLY_SAVINGS_GOAL, get_budget_for_month
from tests.helpers import ROOT

TODAY = _dt.date(2026, 10, 23)


def money_db() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript((ROOT / "infrastructure/db/money_schema.sql").read_text())
    return c


def add(c, day, amount, category, kind="Expense"):
    n = c.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    c.execute(
        "INSERT INTO transactions (id, date, name, amount, category, transaction_type) VALUES (?,?,?,?,?,?)",
        (f"t{n}", day, category, amount, category, kind),
    )


class BudgetsTest(unittest.TestCase):
    def setUp(self):
        self.c = money_db()

    def test_defaults_come_from_config(self):
        self.assertEqual(budgets.savings_goal(self.c), MONTHLY_SAVINGS_GOAL)
        self.assertEqual(budgets.budget_for_month(self.c, "2026-10"), get_budget_for_month("2026-10"))

    def test_saved_versions_apply_from_their_month(self):
        budgets.save_budget(self.c, "2026-11", {"Restaurant": 300, "Home": 1380, "Fun": 0})
        self.assertEqual(budgets.budget_for_month(self.c, "2026-12"), {"Restaurant": 300, "Home": 1380})
        self.assertEqual(budgets.budget_for_month(self.c, "2026-11")["Restaurant"], 300)
        budgets.set_savings_goal(self.c, 1500)
        self.assertEqual(budgets.savings_goal(self.c), 1500)

    def test_plan_suggests_typical_month_never_above_budget(self):
        for i, mon in enumerate(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
                                 "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]):
            add(self.c, f"{mon}-10", -(200 + 10 * i), "Restaurant")     # 200..300, median 250
            add(self.c, f"{mon}-01", -1380, "Home")
            add(self.c, f"{mon}-28", 4000, "Income", kind="Income")
        add(self.c, "2025-10-10", -900, "Restaurant")                     # 12 months back, counted
        add(self.c, "2026-10-05", -999, "Restaurant")                     # current month: ignored
        add(self.c, "2026-09-12", 40, "Restaurant")                       # a refund nets down
        p = budgets.plan(self.c, today=TODAY)
        self.assertEqual(p["effective_month"], "2026-11")
        rows = {r["category"]: r for r in p["rows"]}
        rest = rows["Restaurant"]
        self.assertEqual(len(rest["history"]), 12)
        self.assertEqual(rest["current"], 450)                            # config budget
        self.assertEqual(rest["suggested"], 255)                          # median of 12 months (refund nets Sep to 260)
        self.assertTrue(rows["Home"]["fixed"])
        self.assertEqual(rows["Home"]["suggested"], 1380)                 # a bill follows what's paid
        add(self.c, "2026-07-20", -600, "Trips")                          # one trip in 12 months
        trips = {r["category"]: r for r in budgets.plan(self.c, today=TODAY)["rows"]}["Trips"]
        self.assertEqual(trips["suggested"], 50)                          # spread over the year, not €0
        self.assertEqual(p["avg_income"], 4000)


class IncomeProjectionTest(unittest.TestCase):
    def setUp(self):
        self.c = money_db()

    def test_salary_not_in_yet_is_added(self):
        add(self.c, "2026-10-03", 150, "Income", kind="Income")           # side income
        p = income.project(self.c, "2026-10", 150, today=TODAY, salary_lookup=lambda m: 4200)
        self.assertEqual((p["projected_income"], p["salary_received"], p["income_source"]), (4350, False, "roster"))

    def test_salary_already_in_is_not_double_counted(self):
        add(self.c, "2026-10-22", 4180, "Income", kind="Income")
        p = income.project(self.c, "2026-10", 4180, today=TODAY, salary_lookup=lambda m: 4200)
        self.assertEqual((p["projected_income"], p["salary_received"]), (4180, True))

    def test_falls_back_to_average_income(self):
        for mon in ["2026-07", "2026-08", "2026-09"]:
            add(self.c, f"{mon}-28", 3900, "Income", kind="Income")
        p = income.project(self.c, "2026-10", 0, today=TODAY, salary_lookup=lambda m: None)
        self.assertEqual((p["projected_income"], p["income_source"]), (3900, "average"))

    def test_past_months_use_actual_income(self):
        p = income.project(self.c, "2026-09", 4100, today=TODAY, salary_lookup=lambda m: 9999)
        self.assertEqual((p["projected_income"], p["income_source"]), (4100, "actual"))


if __name__ == "__main__":
    unittest.main()
