"""Plan ahead: automatic goal progress, birthdays, repeating tasks, agenda."""

import sqlite3
import unittest
from datetime import date

from domains.plans import agenda as ag
from domains.plans import goals as gl
from domains.plans.metrics import Ctx, catalog, runs
from infrastructure.db.migrate_plans import migrate

TODAY = date(2026, 7, 2)          # day 183 of 365 → ~50% of the year elapsed


def db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE contacts(id INTEGER PRIMARY KEY, name TEXT UNIQUE, emoji TEXT, group_ TEXT);
        CREATE TABLE day_companions(date TEXT, contact_id INTEGER);
        CREATE TABLE activities(id TEXT, date TEXT, source TEXT, strava_id TEXT, activity_type TEXT,
                                distance_meters REAL, moving_time_seconds INTEGER, duration_seconds INTEGER,
                                elevation_gain_meters REAL);
        CREATE TABLE sleep(date TEXT PRIMARY KEY, duration_seconds INTEGER);
        CREATE TABLE weight_log(date TEXT PRIMARY KEY, weight_kg REAL);
        CREATE TABLE best_effort(activity_id TEXT, date TEXT, sport TEXT, channel TEXT, bucket INTEGER, value REAL);
        CREATE TABLE flights(id TEXT, date TEXT, is_sim INTEGER DEFAULT 0, block_seconds INTEGER,
                             pic_seconds INTEGER DEFAULT 0, landings_day INTEGER DEFAULT 0,
                             landings_night INTEGER DEFAULT 0);
        CREATE TABLE trips(id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT, countries_json TEXT,
                           hidden INTEGER DEFAULT 0);
        CREATE TABLE manual_country_visits(iso2 TEXT, country TEXT, first_visit TEXT);
        CREATE TABLE books(id INTEGER PRIMARY KEY, title TEXT, date_finished TEXT);
        CREATE TABLE tags(id INTEGER PRIMARY KEY, slug TEXT, is_negative BOOLEAN DEFAULT 0, name TEXT, icon TEXT);
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
        self.c.execute("INSERT INTO activities (id, date, source, strava_id, activity_type, distance_meters) "
                       "VALUES (?,?,?,?,?,?)", (id_, day, source, strava_id, "running", km * 1000))

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
        self.c.execute("INSERT INTO tags (id, slug, is_negative) VALUES (1, 'candy', 1)")
        for d in ["2025-02-01", "2025-03-01", "2025-04-01", "2026-02-01"]:
            self.c.execute("INSERT INTO day_tags VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO day_tags VALUES ('2025-09-01', 1)")   # after the window → not compared
        p = gl.progress(self.c, goal(metric="tag_days", metric_param="candy"), TODAY)
        self.assertTrue(p["lower_is_better"])
        self.assertEqual((p["actual"], p["compare"]), (1, 3))
        self.assertEqual(p["state"], "on_track")

    def test_negative_tag_with_ceiling(self):
        self.c.execute("INSERT INTO tags (id, slug, is_negative) VALUES (1, 'candy', 1)")
        for m in range(1, 7):
            self.c.execute("INSERT INTO day_tags VALUES (?, 1)", (f"2026-0{m}-01",))
        p = gl.progress(self.c, goal(metric="tag_days", metric_param="candy", target=10), TODAY)
        self.assertEqual(p["state"], "behind")          # 6 used, budget so far ~5

    def nw(self, value):
        return Ctx(self.c, net_worth=lambda: value)

    def test_net_worth_needs_baseline_for_pace(self):
        g = goal(metric="net_worth", target=50000)
        self.assertEqual(gl.progress(self.nw(30000), g, TODAY)["state"], "in_progress")
        g["baseline"] = 20000
        p = gl.progress(self.nw(36000), g, TODAY)
        self.assertEqual(p["state"], "on_track")          # expected ≈ 35k
        self.assertEqual(gl.progress(self.nw(51000), g, TODAY)["state"], "achieved")
        self.assertEqual(gl.progress(self.nw(22000), g, TODAY)["state"], "behind")

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


class MoreMetricsTest(unittest.TestCase):
    """The sources beyond km and books — each computed from tables the daybook already fills."""

    def setUp(self):
        self.c = db()

    def p(self, ctx=None, **kw):
        return gl.progress(ctx or self.c, goal(**kw), TODAY)

    def test_catalog_has_unique_keys_and_known_kinds(self):
        keys = [m["key"] for m in catalog()]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue({m["kind"] for m in catalog()} <=
                        {"sum", "ceiling", "avg", "level", "best", "streak", "manual"})
        self.assertGreaterEqual(len(keys), 25)

    def test_area_defaults_from_metric(self):
        self.assertEqual(self.p(metric="ride_km", target=1)["area"], "training")
        self.assertEqual(self.p(metric="ride_km", target=1, area="people")["area"], "people")

    def test_sleep_average_vs_target(self):
        for d, h in [("2026-06-01", 7.5), ("2026-06-02", 6.5), ("2025-12-31", 3)]:
            self.c.execute("INSERT INTO sleep VALUES (?, ?)", (d, h * 3600))
        p = self.p(metric="sleep_hours", target=7.5)
        self.assertEqual((p["actual"], p["state"]), (7.0, "behind"))
        self.assertEqual(self.p(metric="sleep_hours", target=7)["state"], "on_track")

    def test_weight_down_uses_first_weigh_in_as_start(self):
        for d, kg in [("2025-12-20", 90), ("2026-01-05", 84), ("2026-06-30", 81)]:
            self.c.execute("INSERT INTO weight_log VALUES (?, ?)", (d, kg))
        p = self.p(metric="weight", target=78)
        self.assertEqual((p["actual"], p["compare"]), (81.0, 84.0))
        self.assertTrue(p["lower_is_better"])
        self.assertEqual(p["pct"], 50)
        self.assertEqual(p["state"], "on_track")          # half the way, half the year
        self.assertEqual(self.p(metric="weight", target=82)["state"], "achieved")

    def test_best_10k_time(self):
        self.c.execute("INSERT INTO best_effort VALUES ('a', '2026-03-01', 'run', 'pace', 10000, 246)")
        self.c.execute("INSERT INTO best_effort VALUES ('b', '2026-03-01', 'ride', 'pace', 10000, 90)")
        p = self.p(metric="best_time", metric_param="10000", target=2400)
        self.assertEqual((p["actual"], p["state"]), (2460.0, "in_progress"))   # 41:00 vs 40:00
        self.assertEqual(self.p(metric="best_time", metric_param="10000", target=2500)["state"], "achieved")

    def test_streaks(self):
        self.assertEqual(runs({"2026-01-02", "2026-01-03"}, date(2026, 1, 1), date(2026, 1, 5), True), (2, 0))
        self.c.execute("INSERT INTO tags (id, slug, is_negative) VALUES (1, 'outdoors', 0), (2, 'alcohol', 1)")
        for d in ["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]:
            self.c.execute("INSERT INTO day_tags VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO day_tags VALUES ('2026-06-01', 2)")
        p = self.p(metric="tag_streak", metric_param="outdoors", target=7)
        self.assertEqual((p["actual"], p["compare"], p["state"]), (5, 5, "in_progress"))
        dry = self.p(metric="tag_streak", metric_param="alcohol", target=100)   # days in a row WITHOUT
        self.assertEqual((dry["actual"], dry["compare"], dry["state"]), (151, 31, "achieved"))

    def test_aviation(self):
        self.c.execute("INSERT INTO flights VALUES ('1','2026-02-01',0,7200,3600,1,0)")
        self.c.execute("INSERT INTO flights VALUES ('2','2026-02-02',1,7200,7200,1,1)")   # sim — ignored
        self.assertEqual(self.p(metric="block_hours", target=4)["actual"], 2.0)
        self.assertEqual(self.p(metric="landings", target=4)["actual"], 1.0)
        self.assertEqual(self.p(metric="sectors", target=4)["actual"], 1.0)

    def test_money_saved_and_budget_months(self):
        m = sqlite3.connect(":memory:")
        m.execute("CREATE TABLE transactions(date TEXT, amount REAL, transaction_type TEXT, deleted_at TEXT)")
        m.executemany("INSERT INTO transactions VALUES (?,?,?,NULL)", [
            ("2026-01-10", 3000, "Income"), ("2026-01-20", -1000, "Expense"),
            ("2026-02-10", 3000, "Income"), ("2026-02-20", -9000, "Expense"),
            ("2026-07-01", 3000, "Income"), ("2026-07-01", -100, "Expense"),      # running month
        ])
        ctx = Ctx(self.c, money=lambda: m)
        self.assertEqual(self.p(ctx, metric="saved", target=10000)["actual"], -1100.0)
        self.assertEqual(self.p(ctx, metric="budget_months", target=12)["actual"], 1.0)

    def test_countries_new_and_visited(self):
        loc = sqlite3.connect(":memory:")
        loc.executescript("""
            CREATE TABLE tracks(date TEXT, geocode_country TEXT);
            INSERT INTO tracks VALUES ('2025-05-01', 'España'), ('2026-03-01', 'España'),
                                      ('2026-04-01', 'Norge'), ('2026-05-01', 'Japan');""")
        self.c.execute("INSERT INTO trips (start_date, end_date, countries_json) VALUES "
                       "('2026-06-01', '2026-06-05', '[\"Portugal\"]')")
        self.c.execute("INSERT INTO manual_country_visits VALUES ('JP', 'Japan', '2019')")
        ctx = Ctx(self.c, locations=lambda: loc)
        self.assertEqual(self.p(ctx, metric="countries", target=10)["actual"], 4.0)
        self.assertEqual(self.p(ctx, metric="new_countries", target=5)["actual"], 2.0)   # Norway, Portugal

    def test_tag_goal_carries_the_tags_emoji(self):
        self.c.execute("INSERT INTO tags (id, slug, name, icon) VALUES (5, 'gym', 'Gym', '🏋️')")
        p = self.p(metric="tag_days", metric_param="gym", target=100)
        self.assertEqual((p["param_label"], p["param_icon"]), ("Gym", "🏋️"))
        self.assertEqual(self.p(metric="best_time", metric_param="10000", target=1)["param_label"], "10 k")

    def test_person_days(self):
        self.c.execute("INSERT INTO contacts (id, name) VALUES (7, 'Alice')")
        for d in ["2026-01-01", "2026-02-01", "2025-12-31"]:
            self.c.execute("INSERT INTO day_companions VALUES (?, 7)", (d,))
        self.assertEqual(self.p(metric="person_days", metric_param="7", target=100)["actual"], 2.0)

    def test_years_offered(self):
        self.c.execute("INSERT INTO goals (title, start_date) VALUES ('x', '2029-01-01')")
        self.assertEqual(gl.years(self.c, 2026, TODAY), [2026, 2027, 2029])


class BirthdayTest(unittest.TestCase):
    def test_parse_and_normalize(self):
        self.assertEqual(ag.normalize_birthday("14-03-1992"), "1992-03-14")
        self.assertEqual(ag.normalize_birthday("4/3/1992"), "1992-03-04")
        self.assertEqual(ag.normalize_birthday("14.03"), "--03-14")
        self.assertEqual(ag.normalize_birthday("1992-03-14"), "1992-03-14")   # stored forms stay valid
        self.assertEqual(ag.normalize_birthday("--03-14"), "--03-14")
        self.assertIsNone(ag.normalize_birthday(""))
        for bad in ("32-01-1990", "14-13", "march"):
            with self.assertRaises(ValueError):
                ag.normalize_birthday(bad)

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


if __name__ == "__main__":
    unittest.main()
