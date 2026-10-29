"""Roster hand edits: swaps survive re-imports, revert, taught codes, rest stretches."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

from domains.aviation import pay
from domains.aviation.roster_importer import (
    RosterDay, ensure_tables, rest_context, revert_day, set_day, teach_code, upsert_roster,
)


def day(d, code, rep=None, end=None):
    return RosterDay(date=d, duty_type="", report_time=rep, end_time=end, raw_code=code)


class RosterEditsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "t.db"
        upsert_roster([
            day("2026-11-01", "FlD", "06:35", "15:05"),
            day("2026-11-02", "Off"),
            day("2026-11-03", "Off"),
            day("2026-11-04", "VAR"),
            day("2026-11-05", "Sby", "05:00", "17:00"),
        ], [], self.path)
        self.c = sqlite3.connect(self.path)
        self.c.row_factory = sqlite3.Row

    def tearDown(self):
        self.c.close()
        self.tmp.cleanup()

    def row(self, d):
        return self.c.execute("SELECT * FROM roster WHERE date = ?", (d,)).fetchone()

    def test_import_normalises(self):
        self.assertEqual(self.row("2026-11-01")["duty_type"], "flying_duty")
        self.assertEqual(self.row("2026-11-01")["report_time"], "06:35")
        self.assertEqual(self.row("2026-11-04")["duty_type"], "unknown")
        self.assertIsNone(self.row("2026-11-01")["edited_at"])

    def test_swap_survives_reimport_and_reverts(self):
        set_day(self.c, "2026-11-01", "day_off", raw_code="Off")
        upsert_roster([day("2026-11-01", "FlD", "06:35", "15:05")], [], self.path)
        r = self.row("2026-11-01")
        self.assertEqual(r["duty_type"], "day_off")
        self.assertIsNotNone(r["edited_at"])
        self.assertEqual(r["imported_duty_type"], "flying_duty")

        revert_day(self.c, "2026-11-01")
        r = self.row("2026-11-01")
        self.assertEqual((r["duty_type"], r["raw_code"], r["report_time"]), ("flying_duty", "FlD", "06:35"))
        self.assertIsNone(r["edited_at"])

    def test_reimport_agreeing_with_edit_clears_flag(self):
        set_day(self.c, "2026-11-02", "standby", "05:00", "17:00", "Sby")
        upsert_roster([day("2026-11-02", "Sby", "05:00", "17:00")], [], self.path)
        self.assertIsNone(self.row("2026-11-02")["edited_at"])

    def test_hand_added_day_reverts_to_nothing(self):
        set_day(self.c, "2026-11-20", "vacation", raw_code="VAC")
        revert_day(self.c, "2026-11-20")
        self.assertIsNone(self.row("2026-11-20"))

    def test_taught_code_reclassifies_and_sticks(self):
        changed = teach_code(self.c, "VAR", "vacation")
        self.assertEqual(changed, ["2026-11-04"])
        self.assertEqual(self.row("2026-11-04")["duty_type"], "vacation")
        upsert_roster([day("2026-12-01", "var")], [], self.path)
        self.assertEqual(self.row("2026-12-01")["duty_type"], "vacation")

    def test_rest_stretch_and_next_duty(self):
        ctx = rest_context(self.c, "2026-11-03")
        self.assertEqual(ctx["stretch"], {"day": 2, "of": 2, "until": "2026-11-03"})
        self.assertEqual(ctx["next_duty"]["date"], "2026-11-04")   # still "unknown" → counts as duty
        teach_code(self.c, "VAR", "vacation")
        self.assertEqual(rest_context(self.c, "2026-11-03")["next_duty"]["date"], "2026-11-05")

    def test_swap_moves_pay(self):
        """A flight swapped to off stops projecting its legs; vacation counts as vacation."""
        self.c.executescript("""
            CREATE TABLE flights(id INTEGER PRIMARY KEY, date, dep_icao, arr_icao, off_block_utc,
                                 block_seconds, is_sim INTEGER DEFAULT 0);
            CREATE TABLE airports(icao, iata);
            INSERT INTO roster_legs(id, date, flight_number, dep_iata, arr_iata, dep_time, arr_time, leg_order)
              VALUES ('a', '2026-11-01', 'D8 1', 'PMI', 'OSL', '07:00', '11:00', 1),
                     ('b', '2026-11-01', 'D8 2', 'OSL', 'PMI', '12:00', '16:00', 2);
        """)
        line = lambda: next(d for d in pay.reconcile_month(self.c, "2026-11", today="2026-10-29") if d.date == "2026-11-01")
        self.assertGreater(line().block_hours, 0)
        set_day(self.c, "2026-11-01", "day_off", raw_code="Off")
        self.assertEqual(line().block_hours, 0)
        set_day(self.c, "2026-11-01", "vacation", raw_code="VAC")
        self.assertTrue(line().vacation)


if __name__ == "__main__":
    unittest.main()
