"""price_sync: fetch first, write after (never holds money.db while on the network); skip closes already in."""

import sqlite3
import unittest
from datetime import date
from unittest import mock

from domains.money import price_sync as ps
from domains.money.money_db import init_money_db
from infrastructure.db.money_connection import get_money_connection
from tests.helpers import tmpdir


class PriceSync(unittest.TestCase):
    def setUp(self):
        self.path = tmpdir() / "money.db"
        init_money_db(self.path)
        self.c = get_money_connection(self.path)
        for t in ("AAA", "BBB"):
            self.c.execute("INSERT INTO holdings (ticker, name, asset_class, currency, quantity, is_active, account) "
                           "VALUES (?,?,?,?,?,1,?)", (t, t, "ETF", "EUR", 1, "Wealth"))
        self.c.commit()
        self.day = date(2026, 11, 24)

    def test_no_lock_while_fetching(self):
        def fetch(ticker, on):
            other = sqlite3.connect(self.path, timeout=0)        # the app saving meanwhile
            other.execute("INSERT INTO money_sync_log (source, status) VALUES ('test', 'ok')")
            other.commit()
            other.close()
            return (10.0, "EUR")
        with mock.patch.object(ps, "yf", object()), mock.patch.object(ps, "_fetch_close", side_effect=fetch):
            up, sk = ps.sync_prices_for_date(self.c, self.day)
        self.assertEqual((up, sk), (2, 0))

    def test_skips_closes_already_in(self):
        self.c.execute("INSERT INTO price_history (ticker, date, close_price, close_price_eur, currency, fx_rate, source, fetched_at) "
                       "VALUES ('AAA', '2026-11-24', 9, 9, 'EUR', 1, 'yfinance', '2026-11-25T02:00:00Z')")
        self.c.execute("INSERT INTO price_history (ticker, date, close_price, close_price_eur, currency, fx_rate, source, fetched_at) "
                       "VALUES ('BBB', '2026-11-24', 9, 9, 'EUR', 1, 'yfinance', '2026-11-24T12:00:00Z')")  # intraday
        self.c.commit()
        with mock.patch.object(ps, "yf", object()), mock.patch.object(ps, "_fetch_close", return_value=(10.0, "EUR")) as f:
            ps.sync_prices_for_date(self.c, self.day)
        self.assertEqual([c.args[0] for c in f.call_args_list], ["BBB"])


if __name__ == "__main__":
    unittest.main()
