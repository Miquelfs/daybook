"""plan_executor never loops on a plan it can't run (holding sold / gone, no price) and never holds money.db."""

import sqlite3
import unittest
from datetime import date
from unittest import mock

from domains.money import plan_executor as pe
from domains.money.money_db import init_money_db
from infrastructure.db.money_connection import get_money_connection
from tests.helpers import tmpdir


class RunDue(unittest.TestCase):
    def setUp(self):
        self.path = tmpdir() / "money.db"
        init_money_db(self.path)
        c = get_money_connection(self.path)
        c.execute("PRAGMA foreign_keys = OFF")
        for hid, active in (("h-sold", 0), ("h-live", 1)):
            c.execute("INSERT INTO holdings (id, account, ticker, name, asset_class, quantity, is_active) "
                      "VALUES (?, 'Wealth', ?, ?, 'equity_etf', 1, ?)", (hid, hid.upper(), hid, active))
        c.execute("INSERT INTO price_history (ticker, date, close_price, close_price_eur, currency, fx_rate, source) "
                  "VALUES ('H-LIVE', '2026-11-01', 10, 10, 'EUR', 1, 'yfinance')")
        for hid in ("h-sold", "h-gone", "h-live"):
            c.execute("INSERT INTO investment_plans (holding_id, source_account, amount_eur, cadence, day_of_week, "
                      "start_date, next_execution_date) VALUES (?, 'TR Cash', 50, 'weekly', 0, '2026-11-02', '2026-11-02')",
                      (hid,))
        c.commit()
        c.close()

    def test_stuck_plans_dont_loop_or_lock(self):
        with mock.patch.object(pe, "get_money_connection", lambda: get_money_connection(self.path)):
            out = pe.run_due(date(2026, 11, 20))
        statuses = sorted({r["status"] for r in out})
        self.assertEqual(statuses, ["skipped", "success"])
        self.assertEqual(sum(r["status"] == "success" for r in out), 3)     # 2, 9 and 16 Nov for the live one
        self.assertEqual(sum(r["status"] == "skipped" for r in out), 2)     # once each, not forever
        other = sqlite3.connect(self.path, timeout=0)                       # nothing left holding the lock
        other.execute("INSERT INTO money_sync_log (source, status) VALUES ('test', 'ok')")
        other.commit()
        other.close()


if __name__ == "__main__":
    unittest.main()
