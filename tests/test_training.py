"""Training plan: ride windows (day_context), weekly placement (reflow), AI coach guard-rails."""

import unittest

import domains.training.coach as coach
import domains.training.reflow as rf
from domains.aviation.roster_importer import _normalise_duty
from domains.training.day_context import DayContextReader, today_advice
from domains.training.plan_templates import TEMPLATES
from domains.training.scheduler import generate_plan, get_discipline
from tests.helpers import fake_date, plan_db

ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Mon 7 – Sun 13 Dec 2026
ROSTER = [
    ("2026-12-07", "day_off", None, None),
    ("2026-12-08", "flying_duty", "15:00", "00:30"),   # evening rotation, home after midnight
    ("2026-12-09", "flying_duty", "15:30", "01:00"),
    ("2026-12-10", "day_off", None, None),
    ("2026-12-11", "flying_duty", "06:00", "14:00"),   # early duty → layover in BCN
    ("2026-12-12", "flying_duty", "08:00", "13:00"),   # fly home from BCN
    ("2026-12-13", "day_off", None, None),
]
LEGS = [("2026-12-08", "PMI", "BCN", 1), ("2026-12-08", "BCN", "PMI", 2),
        ("2026-12-11", "PMI", "BCN", 1), ("2026-12-12", "BCN", "PMI", 1)]


def seeded():
    c = plan_db()
    c.executemany("INSERT INTO roster VALUES(?,?,?,?,'x')", ROSTER)
    c.executemany("INSERT INTO roster_legs VALUES('i',?, 'f', ?, ?, NULL, NULL, ?)", LEGS)
    return c


class RosterCodesTest(unittest.TestCase):
    def test_duty_codes_match_what_training_expects(self):
        # day_context / prescription key off these normalised values — not FLT/SBY.
        self.assertEqual(_normalise_duty("FlD"), "flying_duty")
        self.assertEqual(_normalise_duty("Sby"), "standby")
        self.assertEqual(_normalise_duty("Off"), "day_off")


class DayContextTest(unittest.TestCase):
    def setUp(self):
        self.r = DayContextReader(seeded())

    def test_ride_window_before_evening_report(self):
        ctx = self.r.context("2026-12-08")
        self.assertEqual(ctx["window_min"], 13 * 60 + 30 - (7 * 60 + 30))   # 07:30 → 13:30
        self.assertTrue(ctx["intense_ok"])

    def test_late_finish_pushes_start_to_1030(self):
        ctx = self.r.context("2026-12-09")
        self.assertTrue(ctx["prev_end_late"])
        self.assertEqual(ctx["window_min"], 14 * 60 - (10 * 60 + 30))      # 10:30 → 14:00

    def test_layover_day_has_no_window_and_no_evening_ride_away(self):
        self.assertEqual(self.r.context("2026-12-12")["window_min"], 0)     # woke up in BCN
        # early duty ending 14:00 but sleeping in BCN → no "ride after 15:00" at home
        self.assertEqual(self.r.context("2026-12-11")["window_min"], 0)

    def test_blocked_day(self):
        c = seeded()
        rf._ensure_columns(c)
        c.execute("INSERT INTO training_day_blocks(date, note) VALUES('2026-12-13','Wedding')")
        ctx = DayContextReader(c).context("2026-12-13")
        self.assertTrue(ctx["blocked"])
        self.assertEqual(ctx["window_min"], 0)

    def test_advice_after_short_sleep_and_late_finish(self):
        ctx = dict(self.r.context("2026-12-09"), sleep_h=5.4)
        adv = today_advice(ctx, {"effective_duration_min": 90, "intensity_zone": "Z4"})
        self.assertEqual(adv["zone"], "Z2")
        self.assertTrue(any("5.4h" in n for n in adv["notes"]))


class ReflowTest(unittest.TestCase):
    def setUp(self):
        self._date = rf.date
        rf.date = fake_date(2026, 12, 7)
        c = seeded()
        c.execute("INSERT INTO race_goals(name, race_type, race_date, plan_start_date, available_days) "
                  "VALUES('M312','mallorca_312','2027-04-24','2026-12-07',?)", (",".join(ALL_DAYS),))
        rf._ensure_columns(c)
        plan = generate_plan(TEMPLATES["mallorca_312"], "2027-04-24", ALL_DAYS,
                             start_from="2026-12-07", schedule_all_weeks=True)
        for w in plan["plan"]:
            for s in w["training_sessions"]:
                d = "2027-04-24" if s["type"] == "Race Day" else s["date"]
                c.execute(
                    """INSERT INTO plan_sessions(goal_id, session_date, original_date, week_number, session_type,
                         discipline, duration_min, intensity_zone, is_optional, effective_duration_min, role)
                       VALUES(1,?,?,?,?,?,?,?,?,?,?)""",
                    (d, d, w["week"], s["type"], get_discipline(s["type"]), s["duration"], s["intensity_zone"],
                     1 if s.get("optional") else 0, s["duration"],
                     s.get("role") or rf.infer_role(s["type"], s["duration"], s["intensity_zone"])))
        self.c = c
        rf.reflow_goal(c, 1)

    def tearDown(self):
        rf.date = self._date

    def week(self, start="2026-12-07", end="2026-12-13"):
        return self.c.execute(
            "SELECT session_date, session_type, role, status FROM plan_sessions "
            "WHERE session_date BETWEEN ? AND ? AND status='pending' ORDER BY session_date", (start, end)).fetchall()

    def test_nothing_on_the_layover_day(self):
        self.assertFalse([r for r in self.week() if r["session_date"] == "2026-12-12"])

    def test_long_ride_lands_on_a_day_off(self):
        longs = [r for r in self.week() if r["role"] == "long"]
        self.assertTrue(longs)
        for r in longs:
            self.assertIn(r["session_date"], {"2026-12-07", "2026-12-10", "2026-12-13"})

    def test_hand_moved_sessions_stay_put(self):
        sid = self.c.execute(
            "SELECT id FROM plan_sessions WHERE session_date BETWEEN '2026-12-07' AND '2026-12-13' "
            "AND status='pending' LIMIT 1").fetchone()[0]
        self.c.execute("UPDATE plan_sessions SET session_date='2026-12-09', is_displaced=1 WHERE id=?", (sid,))
        rf.reflow_goal(self.c, 1)
        self.assertEqual(self.c.execute("SELECT session_date FROM plan_sessions WHERE id=?", (sid,)).fetchone()[0],
                         "2026-12-09")

    def test_race_week_taper_order(self):
        rows = self.week("2027-04-19", "2027-04-24")
        by_date = {r["session_date"]: r["session_type"] for r in rows}
        self.assertEqual(by_date.get("2027-04-24"), "Race Day")
        self.assertIn("Recovery Spin", by_date.get("2027-04-23", ""))      # day before: openers only
        self.assertIn("Activation", by_date.get("2027-04-22", ""))


class HardSportTest(ReflowTest):
    """A tennis match: its day is taken, it is the week's hard work, the 312 work stays."""

    BOOST = "Cycling - Z2 + VO2 (trainer)"

    def mark(self, d="2026-12-10", hard=True):
        self.c.execute("INSERT OR REPLACE INTO training_day_blocks (date, note, load) VALUES (?,?,?)",
                       (d, "Tennis match", "hard" if hard else None))
        rf.reflow_goal(self.c, 1)

    def boost(self):
        return self.c.execute("SELECT status, intensity_zone, schedule_note, session_date FROM plan_sessions "
                              "WHERE session_type=? AND week_number=1", (self.BOOST,)).fetchone()

    def test_boost_is_placed_like_an_easy_ride(self):
        b = self.boost()
        self.assertEqual(b["status"], "pending")
        self.assertIn("VO2 set", b["schedule_note"])

    def test_match_switches_vo2_off_and_keeps_312_work(self):
        keys_before = {r["session_type"] for r in self.week() if r["role"] == "key"}
        self.mark()
        b = self.boost()
        self.assertEqual((b["status"], b["intensity_zone"]), ("pending", "Z2"))      # the ride stays, as Z2
        self.assertIn("Tennis match (Thu) is this week's hard work", b["schedule_note"])
        self.assertFalse([r for r in self.week() if r["session_date"] == "2026-12-10"])
        self.assertEqual({r["session_type"] for r in self.week() if r["role"] == "key"}, keys_before)
        self.assertFalse([r for r in self.week() if r["role"] == "long" and r["session_date"] == "2026-12-11"])

    def test_removing_the_match_restores_the_week(self):
        before = self.boost()
        self.mark()
        self.c.execute("DELETE FROM training_day_blocks")
        rf.reflow_goal(self.c, 1)
        self.assertEqual(tuple(self.boost()), tuple(before))

    def test_a_plain_block_is_not_hard_work(self):
        self.mark(hard=False)
        self.assertNotIn("Tennis", self.boost()["schedule_note"])

    def test_vo2_set_only_on_a_well_spaced_day(self):
        from datetime import date, timedelta
        for b in self.c.execute("SELECT * FROM plan_sessions WHERE session_type=? AND intensity_zone='Z5' "
                                "AND status='pending'", (self.BOOST,)):
            d = date.fromisoformat(b["session_date"])
            near = self.c.execute(
                "SELECT session_type, role, discipline, session_date FROM plan_sessions WHERE status='pending' "
                "AND session_date IN (?,?)", ((d - timedelta(days=1)).isoformat(),
                                              (d + timedelta(days=1)).isoformat())).fetchall()
            self.assertFalse([n for n in near if n["role"] == "key" and n["discipline"] != "running"], b["session_date"])
            self.assertFalse([n for n in near if n["role"] == "long" and n["session_date"] > b["session_date"]])

    def test_ridden_without_the_set_when_off(self):
        from domains.training.vo2_boost import as_ridden
        from domains.training.plan_templates.mallorca_312 import z2_vo2
        st = z2_vo2(5, 4, 90)["structure"]
        off = as_ridden(st, self.BOOST, "Z2")
        self.assertFalse([x for x in off if x.get("work_zone") == "Z5"])
        self.assertEqual(sum(x["duration_min"] for x in off), sum(
            x.get("duration_min") or x["reps"] * (x["work_min"] + x["rest_min"]) for x in st))
        self.assertEqual(as_ridden(st, self.BOOST, "Z5"), st)


class Vo2BoostTest(ReflowTest):
    def test_converts_a_materialized_plan_once(self):
        from datetime import date
        from domains.training import vo2_boost
        from domains.training.plan_templates.mallorca_312 import BOOST_TYPE, VO2_BOOST
        # a plan made before the boost: put the Zone 2 rides back
        self.c.execute("UPDATE plan_sessions SET session_type='Cycling - Zone 2 Ride', intensity_zone='Z2' "
                       "WHERE session_type=?", (BOOST_TYPE,))
        changed = vo2_boost.apply(self.c, 1, today=date(2026, 12, 7))
        weeks = {r[0] for r in self.c.execute("SELECT week_number FROM plan_sessions WHERE session_type=?",
                                              (BOOST_TYPE,))}
        self.assertEqual(weeks, {w - 7 for w in VO2_BOOST if w > 7})   # plan starts at template week 8
        self.assertEqual(len(changed), len(weeks))
        self.assertEqual(vo2_boost.apply(self.c, 1, today=date(2026, 12, 7)), [])   # idempotent
        r = self.c.execute("SELECT role, status FROM plan_sessions WHERE session_type=?", (BOOST_TYPE,)).fetchone()
        self.assertEqual((r["role"], r["status"]), ("easy", "pending"))


class CoachGuardRailsTest(ReflowTest):
    """Reuses ReflowTest's seeded, re-placed week (its tests run here too — cheap)."""

    def setUp(self):
        self._coach_date = coach.date
        coach.date = fake_date(2026, 12, 7)
        super().setUp()
        self.ids = [r[0] for r in self.c.execute(
            "SELECT id FROM plan_sessions WHERE session_date BETWEEN '2026-12-07' AND '2026-12-13' "
            "AND status='pending' ORDER BY session_date")]

    def tearDown(self):
        coach.date = self._coach_date
        super().tearDown()

    def test_only_valid_adjustments_survive(self):
        first = self.c.execute("SELECT * FROM plan_sessions WHERE id=?", (self.ids[0],)).fetchone()
        ok = coach._validate(self.c, 1, coach.date(2026, 12, 7), [
            {"session_id": self.ids[0], "action": "move", "to_date": "2026-12-13", "reason": "fine"},
            {"session_id": self.ids[0], "action": "move", "to_date": "2026-12-20", "reason": "other week"},
            {"session_id": self.ids[0], "action": "downgrade", "zone": "Z5", "reason": "harder"},
            {"session_id": self.ids[0], "action": "shorten", "duration_min": 9999, "reason": "longer"},
            {"session_id": 999999, "action": "skip", "reason": "unknown session"},
            {"session_id": self.ids[0], "action": "explode", "reason": "unknown action"},
        ])
        self.assertEqual([(a["action"], a.get("to_date")) for a in ok], [("move", "2026-12-13")])
        self.assertEqual(first["status"], "pending")

    def test_apply_marks_session_as_moved_by_coach(self):
        coach.ensure_table(self.c)
        import json
        rid = self.c.execute("INSERT INTO coach_reviews(goal_id, week_start, review_json) VALUES(1,'2026-12-07',?)",
                             (json.dumps({"adjustments": [{"session_id": self.ids[0], "action": "move",
                                                           "to_date": "2026-12-13", "reason": "rest first"}]}),)
                             ).lastrowid
        coach.apply_adjustment(self.c, rid, 0)
        row = self.c.execute("SELECT session_date, is_displaced, schedule_note FROM plan_sessions WHERE id=?",
                             (self.ids[0],)).fetchone()
        self.assertEqual(tuple(row), ("2026-12-13", 1, "Coach: rest first"))


class TemplateTest(unittest.TestCase):
    def test_mallorca_312_shape(self):
        t = TEMPLATES["mallorca_312"]
        self.assertEqual(len(t), 27)
        peak = max(s["duration"] for w in t for s in w["sessions"])
        self.assertEqual(peak, 420)                                # 7h biggest day
        self.assertEqual([w["phase"] for w in t].count("foundation"), 7)
        self.assertFalse([s for s in t[-1]["sessions"] if s["type"].startswith("Strength")])  # no gym race week


if __name__ == "__main__":
    unittest.main()
