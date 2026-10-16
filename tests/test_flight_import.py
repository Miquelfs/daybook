import sqlite3
import unittest

from domains.aviation import flight_import as fi

SMS_OSL_PMI = """D85623/OSLPMI/15OCT26
1808/15OCT
SERXA/15809

166/1/0
167+0
A47/B73/C47

1/0kg
2/496kg
3/1564kg
4/0kg
C+M:0kg
B:124pcs
TOT 2060kg

Remarks:Final Figures sent from Altea FM"""

SMS_PMI_ARN = """D85600/PMIARN/10OCT26
1245/10OCT
SERPK/23492

181/1/1
182+1
A54/B77/C51

1/0kg
2/954kg
3/1670kg
4/0kg
C+M:0kg
B:165pcs
TOT 2624kg

Remarks:ACT AVG BW 15.9KG,"""


class ParseTest(unittest.TestCase):
    def test_osl_pmi(self):
        p = fi.parse(SMS_OSL_PMI)
        self.assertEqual((p["flight_number"], p["dep_iata"], p["arr_iata"], p["date"]), ("D85623", "OSL", "PMI", "2026-10-15"))
        self.assertEqual((p["aircraft_reg"], p["message_time_utc"]), ("SE-RXA", "18:08"))
        self.assertEqual((p["pax_adult"], p["pax_child"], p["pax_infant"], p["pax_total"]), (166, 1, 0, 167))
        self.assertEqual(p["zones"], {"A": 47, "B": 73, "C": 47})
        self.assertEqual(p["holds_kg"], {1: 0, 2: 496, 3: 1564, 4: 0})
        self.assertEqual((p["freight_kg"], p["bags_pcs"], p["hold_total_kg"], p["baggage_kg"]), (0, 124, 2060, 2060))
        self.assertIn("Final Figures", p["remarks"])

    def test_avg_bag_weight(self):
        p = fi.parse(SMS_PMI_ARN)
        self.assertEqual((p["aircraft_reg"], p["pax_total"], p["pax_infant"], p["avg_bag_kg"]), ("SE-RPK", 182, 1, 15.9))

    def test_registration_formats(self):
        self.assertEqual(fi.format_reg("GEZAA"), "G-EZAA")
        self.assertEqual(fi.format_reg("EIFIA"), "EI-FIA")
        self.assertEqual(fi.format_reg("LNNGK"), "LN-NGK")


class ApplyTest(unittest.TestCase):
    def test_waits_for_the_flight_then_fills_only_empty_fields(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("""CREATE TABLE flights(id, date, flight_number, dep_iata, arr_iata, dep_icao, arr_icao, aircraft_reg,
                     off_block_utc, takeoff_utc, landing_utc, on_block_utc, block_seconds, airborne_seconds,
                     pax_total, pax_adult, pax_child, pax_infant, baggage_kg, freight_kg,
                     fuel_block_kg, fuel_uplift_kg, fuel_burn_kg, fuel_trip_kg, is_sim INTEGER DEFAULT 0)""")
        ls = fi.save(c, fi.parse(SMS_OSL_PMI), SMS_OSL_PMI)
        self.assertEqual(fi.link_pending(c), 0)                       # flight not logged yet
        c.execute("""INSERT INTO flights (id, date, flight_number, dep_iata, arr_iata, aircraft_reg, pax_total)
                     VALUES ('n1','2026-10-15','D8 5623','OSL','PMI','SE-RXA', 170)""")
        self.assertEqual(fi.link_pending(c), 1)
        r = c.execute("SELECT * FROM flights WHERE id='n1'").fetchone()
        self.assertEqual(r["pax_total"], 170)                         # existing value kept
        self.assertEqual((r["pax_adult"], r["baggage_kg"]), (166, 2060))
        self.assertEqual(fi.for_flight(c, "n1")[0]["bags_pcs"], 124)
        self.assertEqual(c.execute("SELECT flight_id FROM flight_loadsheets WHERE id=?", (ls,)).fetchone()[0], "n1")


if __name__ == "__main__":
    unittest.main()
