"""Plan ahead: automatic goal progress, birthdays, repeating tasks, agenda."""

import sqlite3
import unittest
from datetime import date

from domains.plans import agenda as ag
from domains.plans import goals as gl
from domains.plans import companions as cm
from domains.plans import habits as hb
from domains.plans import people as pp
from domains.plans.metrics import Ctx, catalog, runs
from infrastructure.db.migrate_plans import migrate

TODAY = date(2026, 7, 2)          # day 183 of 365 → ~50% of the year elapsed


def db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE contacts(id INTEGER PRIMARY KEY, name TEXT UNIQUE, emoji TEXT, group_ TEXT);
        CREATE TABLE day_companions(date TEXT, contact_id INTEGER);
        CREATE TABLE activities(id TEXT, date TEXT, source TEXT, strava_id TEXT, activity_type TEXT, name TEXT,
                                distance_meters REAL, moving_time_seconds INTEGER, duration_seconds INTEGER,
                                elevation_gain_meters REAL);
        CREATE TABLE sleep(date TEXT PRIMARY KEY, duration_seconds INTEGER);
        CREATE TABLE weight_log(date TEXT PRIMARY KEY, weight_kg REAL);
        CREATE TABLE best_effort(activity_id TEXT, date TEXT, sport TEXT, channel TEXT, bucket INTEGER, value REAL);
        CREATE TABLE flights(id TEXT, date TEXT, is_sim INTEGER DEFAULT 0, block_seconds INTEGER,
                             pic_seconds INTEGER DEFAULT 0, landings_day INTEGER DEFAULT 0,
                             landings_night INTEGER DEFAULT 0);
        CREATE TABLE trips(id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT, countries_json TEXT,
                           hidden INTEGER DEFAULT 0, user_name TEXT, auto_name TEXT, primary_country TEXT,
                           cover_photo_path TEXT);
        CREATE TABLE manual_country_visits(iso2 TEXT, country TEXT, first_visit TEXT);
        CREATE TABLE restaurants(id INTEGER PRIMARY KEY, name TEXT, date_visited TEXT, city TEXT, companions TEXT);
        CREATE TABLE tennis_session_player(activity_id TEXT, contact_id INTEGER, role TEXT);
        CREATE TABLE books(id INTEGER PRIMARY KEY, title TEXT, date_finished TEXT);
        CREATE TABLE tags(id INTEGER PRIMARY KEY, slug TEXT, is_negative BOOLEAN DEFAULT 0, name TEXT, icon TEXT, category TEXT);
        CREATE TABLE day_tags(date TEXT, tag_id INTEGER, note TEXT);
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
            self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES ('2025-09-01', 1)")   # after the window → not compared
        p = gl.progress(self.c, goal(metric="tag_days", metric_param="candy"), TODAY)
        self.assertTrue(p["lower_is_better"])
        self.assertEqual((p["actual"], p["compare"]), (1, 3))
        self.assertEqual(p["state"], "on_track")

    def test_negative_tag_with_ceiling(self):
        self.c.execute("INSERT INTO tags (id, slug, is_negative) VALUES (1, 'candy', 1)")
        for m in range(1, 7):
            self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES (?, 1)", (f"2026-0{m}-01",))
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
            self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES ('2026-06-01', 2)")
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


class HabitsTest(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.c.execute("INSERT INTO tags (id, slug, name, icon, is_negative) VALUES (1,'gym','Gym','🏋️',0), (2,'candy','Candy','🍬',1)")
        for d in ["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-03-02", "2026-03-03"]:
            self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES ('2026-06-20', 2)")

    def test_positive_streak_stays_alive_until_today_is_logged(self):
        s = hb.streaks(["2026-06-30", "2026-07-01"], False, TODAY)        # today (2 Jul) not logged yet
        self.assertEqual((s["current"], s["best"], s["best_end"]), (2, 2, "2026-07-01"))
        self.assertEqual(hb.streaks(["2026-06-29"], False, TODAY)["current"], 0)

    def test_negative_streak_counts_clean_days(self):
        s = hb.streaks(["2026-06-20"], True, TODAY)
        self.assertEqual(s["current"], 12)

    def test_only_tracked_tags_are_habits(self):
        self.c.execute("INSERT INTO tags (id, slug, name) VALUES (3, 'late_night', 'Late night')")
        self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES ('2026-07-01', 3)")
        self.assertEqual(hb.overview(self.c, TODAY), [])                  # nothing chosen yet
        self.assertTrue(hb.set_tracked(self.c, "gym", True))
        self.c.execute("INSERT INTO goals (title, start_date, metric, metric_param) VALUES ('less candy', '2026-01-01', 'tag_days', 'candy')")
        o = hb.overview(self.c, TODAY)
        self.assertEqual([(h["slug"], h["why"]) for h in o], [("gym", ["pinned"]), ("candy", ["goal"])])
        explored = {t["slug"]: t["tracked"] for t in hb.explore(self.c, TODAY)}
        self.assertEqual(explored, {"gym": True, "candy": True, "late_night": False})
        hb.set_tracked(self.c, "gym", False)
        self.assertEqual([h["slug"] for h in hb.overview(self.c, TODAY)], ["candy"])
        self.assertFalse(hb.set_tracked(self.c, "nope", True))

    def test_overview(self):
        hb.set_tracked(self.c, "gym", True)
        hb.set_tracked(self.c, "candy", True)
        o = hb.overview(self.c, TODAY)
        self.assertEqual([h["slug"] for h in o], ["gym", "candy"])        # doing-habits first
        gym = o[0]
        self.assertEqual([w["done"] for w in gym["week"]], [False, False, True, True, True, True, False])
        self.assertEqual((gym["count_30"], gym["streak_current"], gym["this_year"]), (4, 4, 6))
        self.assertEqual(o[1]["rate_30"], 97)                              # 29 clean days of 30

    def test_counted_habit_sums_the_amounts(self):
        self.c.execute("INSERT INTO tags (id, slug, name, is_negative) VALUES (9, 'alcohol', 'Alcohol', 1)")
        self.c.executemany("INSERT INTO day_tags (date, tag_id, note) VALUES (?, 9, ?)",
                           [("2026-06-30", "8"), ("2026-07-01", "2"), ("2026-03-01", None)])
        hb.set_tracked(self.c, "alcohol", True)
        h = next(x for x in hb.overview(self.c, TODAY) if x["slug"] == "alcohol")
        self.assertTrue(h["counted"])
        self.assertEqual((h["count_30"], h["amount_30"]), (2, 10))
        self.assertEqual([w["count"] for w in h["week"]][-3:], [8, 2, None])
        d = hb.detail(self.c, "alcohol", 2026, TODAY)
        self.assertEqual((d["count"], d["amount"], d["amount_max"], d["amount_per_day"]), (3, 11, 8, 3.7))
        self.assertEqual(d["amount_by_month"][5], 8)
        g = gl.progress(self.c, goal(metric="tag_total", metric_param="alcohol", target=100), TODAY)
        self.assertEqual((g["actual"], g["kind"], g["state"]), (11.0, "ceiling", "on_track"))

    def test_detail_year(self):
        d = hb.detail(self.c, "gym", 2026, TODAY)
        self.assertEqual((d["count"], d["by_month"][2], d["by_month"][5], d["by_weekday"][0]), (6, 2, 3, 2))
        self.assertEqual(d["days_elapsed"], 183)
        self.assertEqual(d["best_in_year"], 4)
        self.assertEqual(d["years"], [2026])
        self.assertIsNone(hb.detail(self.c, "nope", 2026, TODAY))


class PeopleTest(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.c.execute("INSERT INTO contacts (id, name, birthday) VALUES (1, 'Alice Dupont', '1995-07-10'), (2, 'Pol', NULL)")
        for d in ["2025-05-01", "2025-06-01", "2026-06-01", "2026-06-02", "2026-06-03", "2026-07-01", "2026-12-31"]:
            self.c.execute("INSERT INTO day_companions VALUES (?, 1)", (d,))
        self.c.execute("INSERT INTO tags (id, slug, name, icon) VALUES (1, 'outdoors', 'Outdoors', '🌲')")
        self.c.execute("INSERT INTO day_tags (date, tag_id) VALUES ('2026-06-01', 1)")
        self.c.execute("INSERT INTO activities (id, date, source, activity_type) VALUES ('a', '2026-06-02', 'garmin', 'tennis')")
        self.c.execute("INSERT INTO tennis_session_player VALUES ('a', 1, 'partner')")
        self.c.execute("INSERT INTO restaurants (name, date_visited, companions) VALUES ('Can Pep', '2026-06-03', 'Alice, Marta')")
        self.c.execute("INSERT INTO trips (start_date, end_date, user_name) VALUES ('2026-05-30', '2026-06-04', 'Lisbon')")

    def test_share_counts_from_when_logging_started(self):
        c = db()
        c.execute("INSERT INTO contacts (id, name) VALUES (1, 'Oriol')")
        for d in ["2026-06-01", "2026-06-11", "2026-06-21"]:                   # logging began 1 Jun
            c.execute("INSERT INTO day_companions VALUES (?, 1)", (d,))
        p = pp.profile(c, 1, 2026, TODAY)
        self.assertEqual((p["since"], p["share"]), ("2026-06-01", 9))           # 3 of 32 days, not of 183
        self.assertIsNone(p["prev_same_period"])                                # no 2025 to compare

    def test_directory_sorted_by_this_year(self):
        d = pp.directory(self.c, TODAY)
        self.assertEqual([p["name"] for p in d], ["Alice Dupont", "Pol"])
        self.assertEqual((d[0]["this_year"], d[0]["total"], d[0]["days_since"]), (4, 6, 1))   # future date ignored
        self.assertEqual(d[0]["birthday"]["days_until"], 8)

    def test_profile(self):
        p = pp.profile(self.c, 1, 2026, TODAY)
        self.assertEqual((p["count"], p["prev_same_period"], p["longest_run"]), (4, 2, 3))
        self.assertEqual(p["by_year"], [{"year": 2025, "days": 2}, {"year": 2026, "days": 4}])
        self.assertEqual(p["by_month"][5], 3)
        self.assertEqual(p["typical_gap"], 28)            # median of 1, 1, 28, 31, 365
        t = p["together"]
        self.assertNotIn("tags", t)                                         # a day together isn't "did X together"
        self.assertEqual((t["activities"], t["sports"]), ([], []))
        self.assertEqual(t["tennis"]["as_partner"], 1)
        self.assertEqual([r["name"] for r in t["restaurants"]], ["Can Pep"])
        self.assertEqual(t["trips"], [])                                    # overlapping isn't enough — mark it
        cm.set_trip_with(self.c, "2026-05-30", "2026-06-04", [1])
        self.assertEqual([x["name"] for x in pp.profile(self.c, 1, 2026, TODAY)["together"]["trips"]], ["Lisbon"])
        self.assertIsNone(pp.profile(self.c, 99, 2026, TODAY))


class CompanionsTest(unittest.TestCase):
    def test_marking_a_training_logs_the_day_together(self):
        c = db()
        c.execute("INSERT INTO contacts (id, name) VALUES (1, 'Oriol'), (2, 'Pol')")
        c.execute("INSERT INTO activities (id, date, source, activity_type, distance_meters) "
                  "VALUES ('g1', '2026-06-10', 'garmin', 'cycling', 80000)")
        out = cm.set_activity_with(c, "g1", [1, 2, 1])
        self.assertEqual([x["name"] for x in out], ["Oriol", "Pol"])
        self.assertEqual(c.execute("SELECT COUNT(*) FROM day_companions WHERE date='2026-06-10'").fetchone()[0], 2)
        cm.set_activity_with(c, "g1", [1])
        self.assertEqual([x["name"] for x in cm.activity_with(c, "g1")], ["Oriol"])
        t = pp.profile(c, 1, 2026, TODAY)["together"]
        self.assertEqual((t["sports"], t["activities"][0]["id"]), ([{"type": "cycling", "count": 1}], "g1"))
        self.assertIsNone(cm.set_activity_with(c, "nope", [1]))


class PlannedTripsTest(unittest.TestCase):
    def test_plan_then_adopt_detected_trip(self):
        from domains.plans import planned_trips as pt
        c = db()
        c.execute("INSERT INTO contacts (id, name) VALUES (1, 'Alice')")
        pid = pt.save(c, {"name": "Lisbon", "start_date": "2026-07-10", "end_date": "2026-07-14"}, [1])
        up = pt.upcoming(c, TODAY)
        self.assertEqual((up[0]["days_until"], up[0]["nights"], up[0]["with"][0]["name"]), (8, 4, "Alice"))
        self.assertEqual(pt.adopt(c), 0)                                   # nothing detected yet
        c.execute("INSERT INTO trips (start_date, end_date, auto_name) VALUES ('2026-07-11', '2026-07-13', 'Portugal · 3 days')")
        self.assertEqual(pt.adopt(c), 1)
        self.assertEqual(c.execute("SELECT user_name FROM trips").fetchone()[0], "Lisbon")
        self.assertEqual(c.execute("SELECT contact_id FROM trip_companions").fetchall()[0][0], 1)
        self.assertEqual(pt.upcoming(c, TODAY), [])                        # adopted → no longer "ahead"
        t = pp.profile(c, 1, 2026, date(2026, 7, 20))["together"]["trips"]
        self.assertEqual([(x["name"], x["planned"]) for x in t], [("Lisbon", False)])
        self.assertIsNone(pt.get(c, 999, TODAY))
        pt.delete(c, pid)


class CalendarMarksTest(unittest.TestCase):
    def test_month_marks(self):
        from domains.plans.calendar import month_marks
        c = db()
        c.executescript("""
            CREATE TABLE life_events(event_date TEXT, label TEXT);
            CREATE TABLE days(date TEXT PRIMARY KEY, mood INTEGER, notes TEXT);
            INSERT INTO life_events VALUES ('2026-04-02', 'New job');
            INSERT INTO days VALUES ('2026-04-03', 7, NULL), ('2026-04-04', NULL, '');
        """)
        c.execute("INSERT INTO trips (start_date, end_date, user_name) VALUES ('2026-03-30', '2026-04-01', 'Lisbon')")
        c.execute("INSERT INTO goals (title, status, completed_at) VALUES ('Marathon', 'done', '2026-04-19')")
        c.execute("INSERT INTO contacts (id, name, birthday) VALUES (1, 'Pol', '--04-25')")
        m = month_marks(c, 2026, 4)
        kinds = {d: [x["kind"] for x in v] for d, v in m.items()}
        self.assertEqual(kinds, {"2026-04-01": ["trip"], "2026-04-02": ["event"], "2026-04-03": ["logged"],
                                 "2026-04-19": ["achievement"], "2026-04-25": ["birthday"]})
        self.assertEqual(m["2026-04-01"][0]["label"], "Lisbon")
        c.execute("INSERT INTO tasks (title, due_date) VALUES ('Renew DNI', '2026-04-10')")
        c.execute("INSERT INTO tasks (title, due_date, done_at) VALUES ('done', '2026-04-11', '2026-04-11')")
        c.execute("INSERT INTO goals (title, deadline) VALUES ('AI Trading', '2026-04-30')")
        self.assertNotIn("2026-04-10", month_marks(c, 2026, 4))                 # day picker: no tasks
        p = month_marks(c, 2026, 4, plan=True)
        self.assertEqual([x["kind"] for x in p["2026-04-10"]], ["task"])
        self.assertNotIn("2026-04-11", p)
        self.assertEqual(p["2026-04-30"][0]["kind"], "deadline")


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
