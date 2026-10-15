"""Correlation batch: next-day effects tested in the right direction, FDR, units, pruning."""

import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

import domains.insights.compute_correlations as cc
from tests.test_life_review import seeded


class BatchTest(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "d.db"
        src = seeded(end=date.today())
        src.commit()                    # backup() waits forever on an open write transaction
        dst = sqlite3.connect(self.path)
        src.backup(dst)
        dst.executescript("""
            CREATE TABLE IF NOT EXISTS correlation_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT, computed_at TEXT NOT NULL, window_days INTEGER NOT NULL,
                metric_a TEXT NOT NULL, metric_b TEXT NOT NULL, r REAL, p_value REAL, n INTEGER,
                lag INTEGER DEFAULT 0, is_new INTEGER DEFAULT 0, r_prev REAL,
                UNIQUE(computed_at, metric_a, metric_b, lag, window_days));
            CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY, source, data_type, run_at, status,
                records_synced, error);""")
        dst.commit()
        dst.close()
        self._gc = cc.get_connection
        # Keep the test about the batch logic: a small, explicit metric set the fixture has.
        self._static, self._dyn = cc._STATIC_METRICS, cc._dynamic_candidates
        cc._STATIC_METRICS = ["energy", "mood", "sleep_duration", "hrv_avg", "stress"]
        cc._dynamic_candidates = lambda conn, start, end: ["tag:alcohol", "tag:outdoors"]

        def conn():
            c = sqlite3.connect(self.path)
            c.row_factory = sqlite3.Row
            return c
        cc.get_connection = conn

    def tearDown(self):
        cc.get_connection = self._gc
        cc._STATIC_METRICS, cc._dynamic_candidates = self._static, self._dyn

    def rows(self):
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        return c.execute("SELECT * FROM correlation_snapshots").fetchall()

    def test_alcohol_today_to_energy_tomorrow_is_found_with_units(self):
        cc.run(window_days=180)
        hit = [r for r in self.rows() if r["metric_a"] == "tag:alcohol" and r["metric_b"] == "energy" and r["lag"] == 1]
        self.assertEqual(len(hit), 1)
        self.assertEqual(hit[0]["effect_kind"], "diff")
        self.assertAlmostEqual(hit[0]["effect"], -2.0, delta=0.4)
        self.assertLessEqual(hit[0]["q_value"], 0.10)
        # A tag that merely overlaps alcohol days can show up here (plain correlation can't
        # de-confound — the Review tab's levers do); it must rank well below the real driver.
        energy = sorted((r for r in self.rows() if r["metric_b"] == "energy" and r["lag"] == 1),
                        key=lambda r: -abs(r["r"]))
        self.assertEqual(energy[0]["metric_a"], "tag:alcohol")
        for r in energy[1:]:
            self.assertLess(abs(r["r"]), abs(energy[0]["r"]) / 2)

    def test_snapshots_are_pruned(self):
        for _ in range(cc.KEEP_SNAPSHOTS + 2):
            cc.run(window_days=90)
            import time
            time.sleep(1.05)          # computed_at has 1-second resolution
        snaps = {r["computed_at"] for r in self.rows() if r["window_days"] == 90}
        self.assertLessEqual(len(snaps), cc.KEEP_SNAPSHOTS)

    def test_bh(self):
        q = cc.bh_qvalues([0.01, 0.04, 0.03, 0.5])
        self.assertEqual([round(x, 3) for x in q], [0.04, 0.053, 0.053, 0.5])


if __name__ == "__main__":
    unittest.main()
