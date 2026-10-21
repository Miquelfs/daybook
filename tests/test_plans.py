"""Plan ahead: automatic goal progress, birthdays, repeating tasks, agenda, calendar feed, push."""

import sqlite3
import unittest
from datetime import date, datetime, timezone

from domains.plans import agenda as ag
from domains.plans import goals as gl
from domains.plans import ics
from domains.plans.notify import compose
from infrastructure.db.migrate_plans import migrate

TODAY = date(2026, 7, 2)          # day 183 of 365 → ~50% of the year elapsed


def db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE contacts(id INTEGER PRIMARY KEY, name TEXT UNIQUE, emoji TEXT, group_ TEXT);
        CREATE TABLE day_companions(date TEXT, contact_id INTEGER);
        CREATE TABLE activities(id TEXT, date TEXT, source TEXT, strava_id TEXT,
                                activity_type TEXT, distance_meters REAL);
        CREATE TABLE books(id INTEGER PRIMARY KEY, title TEXT, date_finished TEXT);
        CREATE TABLE tags(id INTEGER PRIMARY KEY, slug TEXT, is_negative BOOLEAN DEFAULT 0);
        CREATE TABLE day_tags(date TEXT, tag_id INTEGER);
        CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT);
    """)
    migrate(c)
    return c


def goal(**kw):
    g = {"id": 1, "title": "g", "emoji": None, "area": None, "priority": 2,
         "start_date": "2026-01-01", "deadline": "2026-12-31", "metric": "manual",
         "metric_param": None, "target": None, "baseline": None, "current": None,
         "status": "active", "notes": None, "completed_at": None, "created_at": "x"}
    g.update(kw)
    return g


class GoalProgressTest(unittest.TestCase):
    def setUp(self):
        self.c = db()

    def run_km(self, km, day="2026-03-01", source="garmin", id_="garmin_1", strava_id=None):
        self.c.execute("INSERT INTO activities VALUES (?,?,?,?,?,?)",
                       (id_, day, source, strava_id, "running", km * 1000))

    def test_run_km_on_pace_and_strava_twin_not_double_counted(self):
        self.run_km(520, id_="garmin_1", strava_id="99")
        self.run_km(520, source="strava", id_="strava_99")       # same activity via Strava
        p = gl.progress(self.c, goal(metric="run_km", target=1000), TODAY)
        self.assertEqual(p["actual"], 520.0)
        self.assertEqual(p["state"], "on_track")
        self.assertEqual(p["pct"], 52)
        self.assertGreater(p["needed_per_week"], 0)

    def test_run_km_behind(self):
        self.run_km(200)
        p = gl.progress(self.c, goal(metric="run_km", target=1000), TODAY)
        self.assertEqual(p["state"], "behind")
        self.assertAlmostEqual(p["expected"], 501.4, places=0)

    def test_past_deadline_missed_vs_achieved(self):
        self.run_km(800, day="2025-06-01")
        g = goal(metric="run_km", target=1000, start_date="2025-01-01", deadline="2025-12-31")
        self.assertEqual(gl.progress(self.c, g, TODAY)["state"], "missed")
        self.run_km(300, day="2025-11-01", id_="garmin_2")
        self.assertEqual(gl.progress(self.c, g, TODAY)["state"], "achieved")

    def test_activity_outside_window_ignored(self):
        self.run_km(300, day="2025-12-31")
        self.assertEqual(gl.progress(self.c, goal(metric="run_km", target=1000), TODAY)["actual"], 0)

    def test_books(self):
        for i, d in enumerate(["2026-02-01", "2026-05-01", "2025-12-01"]):
            self.c.execute("INSERT INTO books VALUES (?,?,?)", (i, "b", d))
        p = gl.progress(self.c, goal(metric="books", target=15), TODAY)
        self.assertEqual(p["actual"], 2)
        self.assertEqual(p["state"], "behind")

    def test_negative_tag_vs_last_year(self):
        self.c.execute("INSERT INTO tags VALUES (1, 'candy', 1)")
        for d in ["2025-02-01", "2025-03-01", "2025-04-01", "2026-02-01"]:
            self.c.execute("INSERT INTO day_tags VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO day_tags VALUES ('2025-09-01', 1)")   # after the window → not compared
        p = gl.progress(self.c, goal(metric="tag_days", metric_param="candy"), TODAY)
        self.assertTrue(p["lower_is_better"])
        self.assertEqual((p["actual"], p["compare"]), (1, 3))
        self.assertEqual(p["state"], "on_track")

    def test_negative_tag_with_ceiling(self):
        self.c.execute("INSERT INTO tags VALUES (1, 'candy', 1)")
        for m in range(1, 7):
            self.c.execute("INSERT INTO day_tags VALUES (?, 1)", (f"2026-0{m}-01",))
        p = gl.progress(self.c, goal(metric="tag_days", metric_param="candy", target=10), TODAY)
        self.assertEqual(p["state"], "behind")          # 6 used, budget so far ~5

    def test_net_worth_needs_baseline_for_pace(self):
        g = goal(metric="net_worth", target=50000)
        self.assertEqual(gl.progress(self.c, g, TODAY, lambda: 30000)["state"], "in_progress")
        g["baseline"] = 20000
        p = gl.progress(self.c, g, TODAY, lambda: 36000)
        self.assertEqual(p["state"], "on_track")          # expected ≈ 35k
        self.assertEqual(gl.progress(self.c, g, TODAY, lambda: 51000)["state"], "achieved")

    def test_manual_and_status(self):
        self.assertEqual(gl.progress(self.c, goal(deadline="2026-06-30"), TODAY)["state"], "overdue")
        self.assertEqual(gl.progress(self.c, goal(status="done"), TODAY)["state"], "done")
        self.assertEqual(gl.progress(self.c, goal(start_date="2027-01-01", deadline="2027-12-31"),
                                     TODAY)["state"], "not_started")

    def test_list_filters_year_and_sorts_behind_first(self):
        self.c.execute("INSERT INTO goals (title, start_date, deadline, metric, target) "
                       "VALUES ('run', '2026-01-01', '2026-12-31', 'run_km', 1000)")
        self.c.execute("INSERT INTO goals (title, start_date, deadline, status) "
                       "VALUES ('old', '2025-01-01', '2025-12-31', 'done')")
        self.c.execute("INSERT INTO goals (title, start_date, deadline, status) "
                       "VALUES ('done26', '2026-01-01', '2026-03-31', 'done')")
        out = gl.list_with_progress(self.c, TODAY, year=2026)
        self.assertEqual([g["title"] for g in out], ["run", "done26"])


class BirthdayTest(unittest.TestCase):
    def test_parse_and_normalize(self):
        self.assertEqual(ag.normalize_birthday("03-14"), "--03-14")
        self.assertEqual(ag.normalize_birthday("1992-03-14"), "1992-03-14")
        self.assertIsNone(ag.normalize_birthday(""))
        with self.assertRaises(ValueError):
            ag.normalize_birthday("14/03")

    def test_next_birthday_wraps_and_leap_day(self):
        self.assertEqual(ag.next_birthday("1990-07-01", TODAY), date(2027, 7, 1))
        self.assertEqual(ag.next_birthday("--07-02", TODAY), TODAY)
        self.assertEqual(ag.next_birthday("2000-02-29", date(2026, 1, 10)), date(2026, 2, 28))

    def test_birthdays_with_last_seen(self):
        c = db()
        c.execute("INSERT INTO contacts (id, name, birthday) VALUES (1, 'Marta', '1992-07-05')")
        c.execute("INSERT INTO contacts (id, name, birthday) VALUES (2, 'Pol', '--12-01')")
        for d in ["2025-12-30", "2026-05-20", "2026-06-01"]:
            c.execute("INSERT INTO day_companions VALUES (?, 1)", (d,))
        b = ag.birthdays(c, TODAY, within_days=14)
        self.assertEqual(len(b), 1)
        self.assertEqual((b[0]["days_until"], b[0]["turning"]), (3, 34))
        self.assertEqual((b[0]["last_seen"], b[0]["days_since_seen"]), ("2026-06-01", 31))
        self.assertEqual(b[0]["days_together_this_year"], 2)
        self.assertIsNone(ag.birthdays(c, TODAY)[1]["turning"])


class TaskTest(unittest.TestCase):
    def setUp(self):
        self.c = db()

    def add(self, title, due=None, kind="task", repeat=None, remind=None):
        return self.c.execute(
            "INSERT INTO tasks (title, due_date, kind, repeat, remind_days) VALUES (?,?,?,?,?)",
            (title, due, kind, repeat, remind)).lastrowid

    def test_add_months_clamps(self):
        self.assertEqual(ag.add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(ag.add_months(date(2026, 12, 15), 1), date(2027, 1, 15))

    def test_repeating_task_keeps_history_and_jumps_past_today(self):
        tid = self.add("Money tracking", "2026-04-01", repeat="monthly")
        live = ag.complete(self.c, tid, TODAY)
        self.assertEqual(live["due_date"], "2026-08-01")
        self.assertIsNone(live["done_at"])
        done = self.c.execute("SELECT * FROM tasks WHERE done_at IS NOT NULL").fetchall()
        self.assertEqual([(r["title"], r["due_date"], r["done_at"]) for r in done],
                         [("Money tracking", "2026-04-01", "2026-07-02")])

    def test_one_off_complete(self):
        tid = self.add("DNI", "2026-12-01")
        self.assertEqual(ag.complete(self.c, tid, TODAY)["done_at"], "2026-07-02")
        self.assertIsNone(ag.complete(self.c, 999, TODAY))

    def test_agenda_buckets(self):
        self.add("late", "2026-06-20")
        self.add("now", "2026-07-02")
        self.add("soon", "2026-07-06")
        self.add("far", "2026-09-01")
        self.add("cutoff", "2026-07-30", remind=30)
        self.add("inbox")
        self.add("resurface", "2026-07-01", kind="note")
        self.add("later note", "2026-08-01", kind="note")
        a = ag.agenda(self.c, TODAY)
        self.assertEqual([t["title"] for t in a["overdue"]], ["late"])
        self.assertEqual([t["title"] for t in a["today"]], ["now"])
        self.assertEqual([t["title"] for t in a["upcoming"]], ["soon", "cutoff"])
        self.assertEqual([t["title"] for t in a["notes"]], ["resurface"])
        self.assertEqual(a["inbox_count"], 1)


class CalendarFeedTest(unittest.TestCase):
    def test_feed(self):
        c = db()
        c.execute("INSERT INTO tasks (title, due_date, remind_days, notes) "
                  "VALUES ('Renovació DNI, passport; etc', '2026-12-01', 30, 'line1\nline2')")
        c.execute("INSERT INTO tasks (title, due_date, repeat) VALUES ('Money', '2026-08-01', 'monthly')")
        c.execute("INSERT INTO tasks (title, due_date, done_at) VALUES ('old', '2026-01-01', '2026-01-01')")
        c.execute("INSERT INTO contacts (id, name, birthday) VALUES (1, 'Marta', '--02-29')")
        c.execute("INSERT INTO goals (title, start_date, deadline) VALUES ('" + "Long title " * 10 + "', "
                  "'2026-01-01', '2026-12-31')")
        out = ics.build(c, now=datetime(2026, 7, 2, tzinfo=timezone.utc))
        self.assertTrue(out.startswith("BEGIN:VCALENDAR\r\n") and out.endswith("END:VCALENDAR\r\n"))
        self.assertIn("SUMMARY:☐ Renovació DNI\\, passport\\; etc", out)
        self.assertIn("DESCRIPTION:line1\\nline2", out)
        self.assertIn("TRIGGER;RELATED=START:-P29DT15H", out)       # 09:00, 30 days before
        self.assertIn("RRULE:FREQ=MONTHLY", out)
        self.assertNotIn("old", out)
        self.assertIn("DTSTART;VALUE=DATE:20000229", out)
        self.assertIn("RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1", out)
        for line in out.split("\r\n"):
            self.assertLessEqual(len(line.encode()), 75)
        self.assertEqual(out.count("BEGIN:VEVENT"), 4)


class NotifyTest(unittest.TestCase):
    def test_compose(self):
        empty = {"birthdays": [], "today": [], "overdue": [], "upcoming": [], "notes": []}
        self.assertIsNone(compose(empty))
        a = {**empty,
             "birthdays": [{"name": "Marta", "days_until": 0, "turning": 34}],
             "today": [{"title": "Call bank"}],
             "upcoming": [{"title": "DNI", "days_until": 20, "remind_days": 30},
                          {"title": "Dentist", "days_until": 3, "remind_days": None}]}
        title, body = compose(a)
        self.assertEqual(title, "Today · 1 to do")
        self.assertEqual(body, "🎂 Marta turns 34 today\n☐ Call bank\n⏳ DNI in 20d")


if __name__ == "__main__":
    unittest.main()
