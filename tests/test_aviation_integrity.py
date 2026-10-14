"""Logbook integrity: wrong on-block dates inflate night time — detect and repair."""

import sqlite3
import unittest

from domains.aviation import integrity


def db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE airports(icao, latitude, longitude);
        INSERT INTO airports VALUES ('LEPA', 39.55, 2.73), ('EGKK', 51.15, -0.18), ('GCTS', 28.04, -16.57);
        CREATE TABLE flights(id, date, dep_icao, arr_icao, off_block_utc, on_block_utc, takeoff_utc, landing_utc,
                             block_seconds, airborne_seconds, night_seconds, is_sim INTEGER DEFAULT 0);
        -- 1: evening PMI→LGW, on-block stored a day late → ~25h span, night 6h18 > block 2h20
        INSERT INTO flights VALUES ('bad','2025-12-10','LEPA','EGKK','2025-12-10T21:30:00+00:00',
               '2025-12-11T23:50:00+00:00','2025-12-10T21:40:00+00:00','2025-12-11T23:40:00+00:00',
               8400, 7800, 22680, 0);
        -- 2: fine daytime flight
        INSERT INTO flights VALUES ('ok','2025-07-01','LEPA','GCTS','2025-07-01T08:00:00+00:00',
               '2025-07-01T11:05:00+00:00',NULL,NULL, 11100, 10500, 0, 0);
        -- 3: block missing, times fine
        INSERT INTO flights VALUES ('noblock','2025-07-02','GCTS','LEPA','2025-07-02T12:00:00+00:00',
               '2025-07-02T14:50:00+00:00',NULL,NULL, NULL, NULL, 0, 0);""")
    return c


class IntegrityTest(unittest.TestCase):
    def test_detects(self):
        rep = integrity.check(db())
        self.assertEqual([i["id"] for i in rep["issues"]["night_gt_block"]], ["bad"])
        self.assertEqual([i["id"] for i in rep["issues"]["rollover"]], ["bad"])
        self.assertEqual([i["id"] for i in rep["issues"]["block_missing"]], ["noblock"])

    def test_repair_fixes_date_and_night(self):
        c = db()
        fixed = integrity.repair(c)
        self.assertEqual(fixed["rollover"], 1)
        self.assertEqual(fixed["block_filled"], 1)
        r = c.execute("SELECT on_block_utc, landing_utc, night_seconds, block_seconds FROM flights WHERE id='bad'").fetchone()
        self.assertTrue(r["on_block_utc"].startswith("2025-12-10T23:50"))
        self.assertTrue(r["landing_utc"].startswith("2025-12-10T23:40"))
        self.assertLessEqual(r["night_seconds"], r["block_seconds"])
        from domains.aviation.compute import _ASTRAL_AVAILABLE
        if _ASTRAL_AVAILABLE:                                  # sun maths needs astral (installed on the Pi)
            self.assertEqual(r["night_seconds"], 8400)        # Dec evening: whole block is night
        self.assertEqual(c.execute("SELECT block_seconds FROM flights WHERE id='noblock'").fetchone()[0], 10200)
        self.assertEqual(integrity.check(c)["total"], 0)


if __name__ == "__main__":
    unittest.main()
