"""Vehicles: odometer km spread over months, costs from expenses, GPS legs."""

import json
import unittest

from domains.money.money_db import init_money_db
from domains.vehicles import garage, routes
from infrastructure.db.money_connection import get_money_connection
from tests.helpers import tmpdir


class Km(unittest.TestCase):
    def test_spread_even_pace(self):
        m = garage.spread_km([("2026-01-16", 1000), ("2026-03-16", 1590)])   # 59 days, 10 km/day
        self.assertAlmostEqual(m["2026-01"], 160)
        self.assertAlmostEqual(m["2026-02"], 280)
        self.assertAlmostEqual(m["2026-03"], 150)


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


if __name__ == "__main__":
    unittest.main()
