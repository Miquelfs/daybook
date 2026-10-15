"""Weekly life review: the deterministic grounding (levers, week vs normal) and action guard-rails."""

import random
import sqlite3
import unittest
from datetime import date, timedelta

import domains.insights.life_review as lr


def seeded(end=date(2026, 10, 18), days=180):
    rnd = random.Random(7)
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE days(date PRIMARY KEY, energy, mood, stress, duty_day, sleep_quality);
        CREATE TABLE tags(id INTEGER PRIMARY KEY, slug, name, icon);
        CREATE TABLE day_tags(date, tag_id);
        CREATE TABLE sleep(date PRIMARY KEY, duration_seconds);
        CREATE TABLE hrv(date PRIMARY KEY, last_night_avg);
        CREATE TABLE roster(date PRIMARY KEY, duty_type, end_time);
        INSERT INTO tags VALUES (1,'alcohol','Alcohol','🍷'), (2,'outdoors','Outdoors','🌲');""")
    start = end - timedelta(days=days)
    alcohol, late = set(), set()
    d = start
    while d <= end:
        ds = d.isoformat()
        if rnd.random() < 0.15:
            alcohol.add(ds)
            c.execute("INSERT INTO day_tags VALUES (?,1)", (ds,))
        if rnd.random() < 0.3:
            c.execute("INSERT INTO day_tags VALUES (?,2)", (ds,))        # noise tag, no effect
        is_late = rnd.random() < 0.2
        if is_late:
            late.add(ds)
        c.execute("INSERT INTO roster VALUES (?,?,?)", (ds, "flying_duty" if is_late else "day_off",
                                                        "00:40" if is_late else None))
        d += timedelta(days=1)
    d = start
    while d <= end + timedelta(days=1):
        prev = (d - timedelta(days=1)).isoformat()
        energy = 7 + rnd.gauss(0, 0.6) - (2.0 if prev in alcohol else 0)
        sleep_h = 7.3 + rnd.gauss(0, 0.4) - (1.2 if prev in late else 0)
        c.execute("INSERT INTO days VALUES (?,?,?,?,?,?)",
                  (d.isoformat(), round(energy, 1), 7 + rnd.gauss(0, 0.5), 4, 0, None))
        c.execute("INSERT INTO sleep VALUES (?,?)", (d.isoformat(), int(sleep_h * 3600)))
        c.execute("INSERT INTO hrv VALUES (?,?)", (d.isoformat(), 70 + rnd.gauss(0, 5)))
        d += timedelta(days=1)
    return c


class LeversTest(unittest.TestCase):
    def setUp(self):
        self.c = seeded()
        self.found = lr.levers(self.c, end=date(2026, 10, 18))

    def find(self, driver, outcome):
        return next((e for e in self.found if e["driver"] == driver and e["outcome"] == outcome), None)

    def test_alcohol_costs_next_day_energy(self):
        e = self.find("tag:alcohol", "energy")
        self.assertIsNotNone(e)
        self.assertAlmostEqual(e["delta"], -2.0, delta=0.4)
        self.assertEqual(e["strength"], "strong")
        self.assertFalse(e["good"])

    def test_late_finish_costs_sleep(self):
        e = self.find("late_finish", "sleep_duration")
        self.assertIsNotNone(e)
        self.assertAlmostEqual(e["delta"], -1.2, delta=0.3)

    def test_trivial_effects_are_hidden(self):
        # mood is unaffected by late finishes in the fixture — even if "significant", it must not show
        self.assertIsNone(self.find("late_finish", "mood"))

    def test_noise_tag_is_not_a_lever(self):
        self.assertIsNone(self.find("tag:outdoors", "energy"))


class WeekVsNormalTest(unittest.TestCase):
    def test_reports_metrics_in_real_units(self):
        rows = {m["key"]: m for m in lr.week_vs_normal(seeded(), end=date(2026, 10, 18))}
        self.assertIn("sleep_duration", rows)
        self.assertTrue(5 < rows["sleep_duration"]["normal"] < 9)    # hours, not seconds


class ActionGuardRailsTest(unittest.TestCase):
    def test_unknown_metric_or_tag_downgrades_to_commitment(self):
        c = seeded()
        acts = lr._validate_actions(c, [
            {"title": "No alcohol before duty days", "why": "x", "type": "experiment",
             "experiment": {"title": "Dry before duty", "hypothesis": "h", "tag": "alcohol", "metric": "energy", "days": 99}},
            {"title": "Something", "type": "experiment",
             "experiment": {"title": "t", "hypothesis": "h", "tag": "made-up", "metric": "vibes"}},
            {"title": "In bed by 23:30 four nights", "type": "commit"},
            {"title": "fourth action is dropped", "type": "commit"},
        ])
        self.assertEqual([a["type"] for a in acts], ["experiment", "commit", "commit"])
        self.assertEqual(acts[0]["experiment"]["days"], 42)      # clamped
        self.assertEqual(acts[0]["experiment"]["tag"], "alcohol")

    def test_default_week(self):
        self.assertEqual(lr.default_week(date(2026, 10, 18)), "2026-10-19")   # Sunday → coming week
        self.assertEqual(lr.default_week(date(2026, 10, 14)), "2026-10-12")   # Wednesday → this week


if __name__ == "__main__":
    unittest.main()
