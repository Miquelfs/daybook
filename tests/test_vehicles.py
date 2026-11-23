"""Vehicles: odometer km spread over months, costs from expenses, GPS legs."""

import json
import sqlite3
import unittest
from datetime import date
from unittest import mock

from domains.money.money_db import init_money_db
from domains.vehicles import garage, reminders, routes
from infrastructure.db.money_connection import get_money_connection
from tests.helpers import tmpdir


class Km(unittest.TestCase):
    def test_spread_even_pace(self):
        m = garage.spread_km([("2026-01-16", 1000), ("2026-03-16", 1590)])   # 59 days, 10 km/day
        self.assertAlmostEqual(m["2026-01"], 160)
        self.assertAlmostEqual(m["2026-02"], 280)
        self.assertAlmostEqual(m["2026-03"], 150)

    def test_spread_over_used_days_by_gps(self):
        # 300 km between two readings; rode 3 Feb (GPS 20 km), 10 Mar (GPS 40), 12 Mar (tagged, no GPS → avg 30)
        used = {"2026-02-03": 20.0, "2026-03-10": 40.0, "2026-03-12": 0.0, "2026-05-01": 10.0}
        m = garage.spread_km([("2026-01-16", 1000), ("2026-03-16", 1300)], used)
        self.assertAlmostEqual(m["2026-02"], 300 * 20 / 90)
        self.assertAlmostEqual(m["2026-03"], 300 * 70 / 90)
        self.assertNotIn("2026-01", m)             # no ride in January → nothing there
        self.assertNotIn("2026-05", m)             # outside the stretch

    def test_spread_used_days_without_gps_equal(self):
        m = garage.spread_km([("2026-01-01", 0), ("2026-03-01", 100)], {"2026-01-20": 0.0, "2026-02-10": 0.0})
        self.assertEqual(m, {"2026-01": 50, "2026-02": 50})


class Costs(unittest.TestCase):
    def setUp(self):
        path = tmpdir() / "money.db"
        init_money_db(path)
        self.c = c = get_money_connection(path)
        c.execute("INSERT INTO vehicles (id, name, kind, subcategories) VALUES (1, 'Scooter', 'scooter', ?)",
                  (json.dumps(["Gasolina moto"]),))
        c.execute("INSERT INTO vehicles (id, name, kind) VALUES (2, 'Car', 'car')")
        add = lambda i, d, a, sub, vid=None, cat="Transportation": c.execute(
            "INSERT INTO transactions (id, source, date, name, amount, category, subcategory, transaction_type, vehicle_id) "
            "VALUES (?,?,?,?,?,?,?,?,?)", (i, "local", d, i, a, cat, sub, "Expense", vid))
        add("fuel-old", "2026-02-01", -10.0, "gasolina moto ")      # history, by subcategory
        add("service", "2026-03-01", -80.0, "Taller", 1)             # linked
        add("fuel-car", "2026-03-02", -50.0, "Gasolina moto", 2)     # linked elsewhere wins over the subcategory
        add("bus", "2026-03-03", -2.0, "Bus")
        c.execute("INSERT INTO vehicle_odometer (vehicle_id, date, km) VALUES (1,'2026-01-01',1000),(1,'2026-03-31',1450)")
        c.commit()

    def test_costs_and_per_km(self):
        v = self.c.execute("SELECT * FROM vehicles WHERE id=1").fetchone()
        where, params = garage.cost_where(v)
        ids = {r[0] for r in self.c.execute(f"SELECT id FROM transactions WHERE {where}", params)}
        self.assertEqual(ids, {"fuel-old", "service"})
        s = garage.summary(self.c, v, months=120)
        self.assertEqual(s["km_total"], 450)
        self.assertEqual(s["cost_total"], 90)
        self.assertAlmostEqual(s["per_km"], 0.2)


class Legs(unittest.TestCase):
    def seg(self, start, end, coords, motion="driving", activity=None):
        return {"segment_start": start, "segment_end": end, "coordinates": coords, "motion": motion,
                "activity_type": activity, "place_name": "X"}

    def test_vehicle_speed_segments_join(self):
        line = [[2.60 + i * 0.01, 39.57] for i in range(11)]        # ~8.6 km east
        segs = [
            self.seg("2026-11-01T10:00:00Z", "2026-11-01T10:10:00Z", line),
            self.seg("2026-11-01T10:15:00Z", "2026-11-01T10:25:00Z", line[::-1]),   # 5 min later → same leg
            self.seg("2026-11-01T12:00:00Z", "2026-11-01T13:00:00Z", line[:2], motion="walking"),
            self.seg("2026-11-01T15:00:00Z", "2026-11-01T15:20:00Z", line, activity="cycling"),
        ]
        legs = routes.legs_from_segments(segs)
        self.assertEqual(len(legs), 1)
        self.assertAlmostEqual(legs[0]["km"], 17.2, delta=0.5)


class Assign(unittest.TestCase):
    def setUp(self):
        d = tmpdir()
        init_money_db(d / "money.db")
        self.c = c = get_money_connection(d / "money.db")
        self.day = sqlite3.connect(d / "daybook.db")
        self.day.executescript("""
            CREATE TABLE tags (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, category TEXT);
            CREATE TABLE day_tags (date TEXT, tag_id INTEGER, note TEXT, PRIMARY KEY (date, tag_id));
            INSERT INTO tags VALUES (1,'motorcycle','Scooter ride','activity'),(2,'car_drive','Car drive','activity');
            INSERT INTO day_tags (date, tag_id) VALUES ('2026-11-01',1),('2026-11-02',1),('2026-11-02',2);
        """)
        self.day.commit()
        self.p = mock.patch.object(routes, "DAYBOOK_DB", d / "daybook.db")
        self.p.start()
        c.execute("INSERT INTO vehicles (id, name, kind, day_tag) VALUES (1,'Scooter','scooter','motorcycle'),(2,'Car','car','car_drive')")
        for d_, st in (("2026-11-01", "T09"), ("2026-11-02", "T09"), ("2026-11-02", "T18"), ("2026-11-03", "T09")):
            c.execute("INSERT INTO vehicle_legs (date, start, end, km, minutes) VALUES (?,?,?,?,?)",
                      (d_, f"{d_}{st}:00:00Z", f"{d_}{st}:30:00Z", 10, 30))
        c.commit()

    def tearDown(self):
        self.p.stop()

    def legs(self):
        return [(r["date"], r["start"][11:13], r["vehicle_id"], r["how"])
                for r in self.c.execute("SELECT * FROM vehicle_legs ORDER BY start")]

    def test_rules_and_picks(self):
        routes.assign(self.c)
        self.assertEqual(self.legs(), [("2026-11-01", "09", 1, "tag"), ("2026-11-02", "09", None, "both"),
                                       ("2026-11-02", "18", None, "both"), ("2026-11-03", "09", None, "untagged")])
        routes.pick(self.c, "2026-11-02", "2026-11-02T18:05:00Z", 2)        # 5 min off still matches
        routes.pick(self.c, "2026-11-03", "2026-11-03T09:00:00Z", 1)        # untagged → also tags the day
        routes.pick(self.c, "2026-11-01", "2026-11-01T09:00:00Z", 0)        # that was a taxi
        self.assertEqual(self.legs(), [("2026-11-01", "09", None, "not_mine"), ("2026-11-02", "09", None, "both"),
                                       ("2026-11-02", "18", 2, "pick"), ("2026-11-03", "09", 1, "pick")])
        tagged = self.day.execute("SELECT 1 FROM day_tags WHERE date='2026-11-03' AND tag_id=1").fetchone()
        self.assertIsNotNone(tagged)
        v = self.c.execute("SELECT * FROM vehicles WHERE id=1").fetchone()
        self.assertEqual(set(garage.usage_days(self.c, v)), {"2026-11-01", "2026-11-02", "2026-11-03"})


class Reminders(unittest.TestCase):
    def setUp(self):
        d = tmpdir()
        init_money_db(d / "money.db")
        self.c = c = get_money_connection(d / "money.db")
        self.day = sqlite3.connect(d / "daybook.db")
        self.day.row_factory = sqlite3.Row
        self.day.execute("""CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT,
            kind TEXT NOT NULL DEFAULT 'task', due_date TEXT, remind_days INTEGER, repeat TEXT, area TEXT,
            done_at TEXT)""")
        c.execute("INSERT INTO vehicles (id, name, kind) VALUES (1,'Scooter','scooter')")
        # 30 km a day: 9 000 on 1 Aug → 12 000 on 9 Nov (100 days)
        c.execute("INSERT INTO vehicle_odometer (vehicle_id, date, km) VALUES (1,'2026-08-01',9000),(1,'2026-11-09',12000)")
        c.execute("INSERT INTO vehicle_reminders (id, vehicle_id, title, every_months, every_km, last_date, last_km) "
                  "VALUES (1,1,'Oil change',12,3000,'2026-03-01',9500)")
        c.execute("INSERT INTO vehicle_reminders (id, vehicle_id, title, every_months, last_date) "
                  "VALUES (2,1,'ITV',24,'2025-12-15')")
        c.commit()
        self.today = date(2026, 11, 19)

    def test_km_due_projected_from_pace(self):
        r = self.c.execute("SELECT * FROM vehicle_reminders WHERE id=1").fetchone()
        due = reminders.next_due(r, garage.readings(self.c, self.c.execute("SELECT * FROM vehicles").fetchone()), self.today)
        self.assertEqual(due["odometer"], 12300)            # 10 days on at 30/day
        self.assertEqual(due["km"], 12500)
        self.assertEqual(due["by"], "km")                   # 12 500 km comes before 1 Mar 2027
        self.assertEqual(due["date"], "2026-11-26")         # 200 km left / 30 a day ≈ 7 days

    def test_sync_into_plan_and_next_cycle(self):
        reminders.sync(self.c, self.day, self.today)
        tasks = {t["title"]: t for t in self.day.execute("SELECT * FROM tasks")}
        self.assertEqual(set(tasks), {"Scooter · Oil change", "Scooter · ITV"})
        self.assertEqual(tasks["Scooter · ITV"]["due_date"], "2027-12-15")
        self.assertEqual(tasks["Scooter · ITV"]["area"], "vehicles")
        # ticked off in Plan on 20 Nov → the next oil change counts from the dial that day
        self.day.execute("UPDATE tasks SET done_at='2026-11-20' WHERE title='Scooter · Oil change'")
        reminders.sync(self.c, self.day, self.today)
        r = self.c.execute("SELECT * FROM vehicle_reminders WHERE id=1").fetchone()
        self.assertEqual((r["last_date"], r["last_km"]), ("2026-11-20", 12330))
        open_ = self.day.execute("SELECT due_date FROM tasks WHERE title='Scooter · Oil change' AND done_at IS NULL").fetchall()
        self.assertEqual(len(open_), 1)
        # sold → its open tasks leave Plan
        self.c.execute("UPDATE vehicles SET sold_on='2026-11-21'")
        reminders.sync(self.c, self.day, self.today)
        self.assertEqual(self.day.execute("SELECT COUNT(*) FROM tasks WHERE done_at IS NULL").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
