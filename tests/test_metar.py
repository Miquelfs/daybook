import sqlite3
import unittest
from datetime import datetime, timezone

from domains.aviation import metar


class ParseTest(unittest.TestCase):
    def test_real_lepa(self):
        m = metar.parse("LEPA 060000Z 06004KT 9999 FEW020 20/19 Q1018 NOSIG")
        self.assertEqual((m["wind_dir"], m["wind_kt"], m["gust_kt"], m["vis_m"]), (60, 4, None, 10000))
        self.assertIsNone(m["ceiling_ft"])
        self.assertEqual((m["temp_c"], m["dew_c"], m["qnh_hpa"], m["category"]), (20, 19, 1018, "VFR"))

    def test_gusts_rain_low_ceiling(self):
        m = metar.parse("EGKK 101950Z 23022G38KT 4000 -RA BR BKN008 OVC015 08/07 Q0991 TEMPO 2000 RA")
        self.assertEqual((m["wind_kt"], m["gust_kt"], m["vis_m"], m["ceiling_ft"]), (22, 38, 4000, 800))
        self.assertEqual(m["wx"], ["-RA", "BR"])          # the TEMPO trend isn't read as current weather
        self.assertEqual(m["category"], "IFR")
        c = metar.conditions(m)
        self.assertTrue(c["gusty"] and c["low_ceiling"] and c["low_visibility"] and c["precipitation"] and c["imc"])
        self.assertFalse(c["thunderstorm"])

    def test_cavok_vrb_negative_temp_cb(self):
        m = metar.parse("LOWI 120920Z VRB03KT CAVOK M02/M08 Q1031")
        self.assertEqual((m["wind_dir"], m["vis_m"], m["temp_c"], m["dew_c"]), (None, 10000, -2, -8))
        m2 = metar.parse("LEMD 151620Z 27015KT 9999 VCTS SCT040CB 28/12 Q1012")
        self.assertTrue(metar.conditions(m2)["thunderstorm"])

    def test_us_statute_miles_and_altimeter(self):
        m = metar.parse("KJFK 121651Z 31012KT 1 1/2SM BR OVC004 12/11 A2992")
        self.assertEqual((m["vis_m"], m["ceiling_ft"], m["qnh_hpa"], m["category"]), (2414, 400, 1013, "LIFR"))


class SyncTest(unittest.TestCase):
    def test_nearest_before_takeoff_and_landing(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("""CREATE TABLE flights(id, date, dep_icao, arr_icao, takeoff_utc, landing_utc,
                     off_block_utc, on_block_utc, is_sim INTEGER DEFAULT 0)""")
        today = datetime.now(timezone.utc).date().isoformat()
        c.execute("INSERT INTO flights VALUES('f1',?,'LEPA','EGKK',?,?,NULL,NULL,0)",
                  (today, f"{today}T09:12:00+00:00", f"{today}T11:20:00+00:00"))
        d = today.replace("-", "")[6:8]

        def fake(station, start, end):
            base = datetime.fromisoformat(today).replace(tzinfo=timezone.utc)
            if station == "LEPA":
                return [(base.replace(hour=8, minute=30), f"LEPA {d}0830Z 06004KT 9999 FEW020 20/19 Q1018"),
                        (base.replace(hour=9, minute=0), f"LEPA {d}0900Z 07008KT 9999 FEW020 21/18 Q1018"),
                        (base.replace(hour=9, minute=30), f"LEPA {d}0930Z 07010KT 9999 FEW020 22/18 Q1018")]
            return [(base.replace(hour=11, minute=55), f"EGKK {d}1155Z 23025G40KT 3000 RA BKN006 10/09 Q0990")]

        s = metar.sync(c, days=2, verbose=False, fetcher=fake)
        self.assertEqual((s["found"], s["missing"], s["requests"]), (1, 1, 2))
        tk = c.execute("SELECT obs_time, wind_kt FROM flight_metars WHERE phase='takeoff'").fetchone()
        self.assertTrue(tk["obs_time"].endswith("09:00:00+00:00"))   # latest BEFORE 09:12, not 09:30
        ld = c.execute("SELECT obs_time FROM flight_metars WHERE phase='landing'").fetchone()
        self.assertIsNone(ld["obs_time"])                              # 11:55 is > 30 min after 11:20
        self.assertEqual(metar.sync(c, days=2, verbose=False, fetcher=fake)["events"], 0)   # no refetch


if __name__ == "__main__":
    unittest.main()
