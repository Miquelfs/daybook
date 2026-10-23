"""Money put into the portfolio vs what it's worth: contributions aren't growth."""

import sqlite3
import unittest

from domains.money import invested
from tests.helpers import ROOT


def db():
    c = sqlite3.connect(":memory:")
    c.executescript((ROOT / "infrastructure/db/money_schema.sql").read_text())
    # VWCE: 20 units bought for €2,000 (avg €100); BTC: cost unknown
    c.executemany(
        "INSERT INTO holdings (id, account, ticker, name, asset_class, quantity, cost_basis_eur) VALUES (?,?,?,?,?,?,?)",
        [("vwce", "TR", "VWCE.DE", "VWCE", "equity_etf", 20, 2000), ("btc", "Binance", "BTC-EUR", "BTC", "crypto", 1, None)],
    )
    c.executemany(
        "INSERT INTO holding_snapshots (date, holding_id, quantity, price_eur, value_eur) VALUES (?,?,?,?,?)",
        [
            ("2026-07-01", "vwce", 10, 100, 1000), ("2026-07-01", "btc", 1, 500, 500),
            ("2026-10-01", "vwce", 20, 120, 2400), ("2026-10-01", "btc", 1, 600, 600),   # bought 10 more
        ],
    )
    return c


class InvestedTest(unittest.TestCase):
    def test_buying_more_is_not_growth(self):
        pts = invested.by_date(db())
        self.assertEqual(pts["2026-07-01"], (1500, 1500))      # 10 × €100 + BTC at value
        self.assertEqual(pts["2026-10-01"], (3000, 2600))      # 20 × €100 + BTC at value
        (w0, i0), (w1, i1) = pts["2026-07-01"], pts["2026-10-01"]
        self.assertEqual((w1 - i1) - (w0 - i0), 400)           # growth: VWCE €100→€120 on 20 units

    def test_since_filters_dates(self):
        self.assertEqual(list(invested.by_date(db(), "2026-08-01")), ["2026-10-01"])


if __name__ == "__main__":
    unittest.main()
