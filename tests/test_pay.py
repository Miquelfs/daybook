"""Payslip model: August 2026 activity must reproduce the real September 2026 slip."""

import sqlite3
import unittest

from domains.aviation import pay

# Logged August 2026 flights (date, dep, arr, block seconds) — 62.28 h total
AUG_FLIGHTS = [
    ("2026-08-01", "LEPA", "ENZV", 11220), ("2026-08-01", "ENZV", "LEPA", 11700),
    ("2026-08-02", "LEPA", "ENGM", 12360), ("2026-08-02", "ENGM", "LEPA", 12240),
    ("2026-08-03", "LEPA", "EKCH", 10200), ("2026-08-03", "EKCH", "LEPA", 10560),
    ("2026-08-04", "LEPA", "ENTO", 11760), ("2026-08-04", "ENTO", "LEPA", 11640),
    ("2026-08-09", "LEPA", "ESSA", 12840), ("2026-08-09", "ESSA", "LEPA", 13140),
    ("2026-08-11", "LEPA", "ENZV", 11460), ("2026-08-11", "ENZV", "LEPA", 11760),
    ("2026-08-13", "LEPA", "ESGG", 11700), ("2026-08-13", "ESGG", "LEPA", 10560),
    ("2026-08-19", "LEPA", "EKCH", 11700),
    ("2026-08-27", "LEPA", "ENGM", 12540), ("2026-08-27", "ENGM", "LEPA", 14640),
    ("2026-08-28", "LEPA", "EKCH", 9600), ("2026-08-28", "EKCH", "LEPA", 12600),
]

# Published roster (22 Aug has no entry)
AUG_ROSTER = {
    **{d: ("flying_duty", "FlD") for d in (1, 2, 3, 4, 8, 12, 13, 19, 27, 28)},
    **{d: ("standby", "Sby") for d in (9, 11, 26, 29)},
    **{d: ("day_off", "Off") for d in (5, 6, 7, 14, 15, 16, 17, 18, 23, 24, 25, 30, 31)},
    10: ("ground_duty", "Dty"), 20: ("ground_duty", "Sim"), 21: ("ground_duty", "Sim"),
}


def db():
    c = sqlite3.connect(":memory:")
    c.executescript("""
        CREATE TABLE flights(id INTEGER PRIMARY KEY, date, dep_icao, arr_icao, off_block_utc,
                             block_seconds, is_sim INTEGER DEFAULT 0);
        CREATE TABLE roster(date PRIMARY KEY, duty_type, report_time, end_time, raw_code);
        CREATE TABLE roster_legs(date, flight_number, dep_iata, arr_iata, dep_time, arr_time, leg_order);
        CREATE TABLE airports(icao, iata);
    """)
    for i, (d, dep, arr, bs) in enumerate(AUG_FLIGHTS):
        c.execute("INSERT INTO flights(date, dep_icao, arr_icao, off_block_utc, block_seconds) VALUES (?,?,?,?,?)",
                  (d, dep, arr, f"{d}T{i:02d}:00", bs))
    for day, (dt, code) in AUG_ROSTER.items():
        c.execute("INSERT INTO roster(date, duty_type, raw_code) VALUES (?,?,?)", (f"2026-08-{day:02d}", dt, code))
    return c


def amounts(slip):
    return {x["key"]: x for x in slip["fixed"] + slip["variable"]}


class SeptemberSlipTest(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.slip = pay.payslip(self.c, "2026-08", today="2026-10-20")
        self.a = amounts(self.slip)

    def test_fixed_lines(self):
        self.assertEqual(self.slip["payslip_month"], "2026-09")
        for key, amount in {"base_salary": 4393.85, "extra_pay": 732.30, "uniform": 17.00,
                            "connectivity": 22.04, "parking": 28.00, "licence_insurance": 63.25,
                            "pension": 257.25}.items():
            self.assertAlmostEqual(self.a[key]["amount"], amount, places=2, msg=key)

    def test_variable_lines(self):
        expect = {"blh": (60, 612.00), "blhp": (2.28, 34.88), "standby": (2, 81.62), "sim": (2, 81.62),
                  "positioning": (1, 40.81), "int_no_overnight": (10, 661.10), "int_int_overnight": (3, 274.05)}
        for key, (units, amount) in expect.items():
            self.assertAlmostEqual(self.a[key]["units"], units, places=2, msg=key)
            self.assertAlmostEqual(self.a[key]["amount"], amount, places=2, msg=key)
        self.assertEqual({v["key"] for v in self.slip["variable"]}, set(expect))

    def test_totals_ss_irpf_net(self):
        s = self.slip
        self.assertAlmostEqual(s["gross"], 7299.77, places=2)
        self.assertAlmostEqual(s["social_security"]["base"], 5101.20, places=2)
        self.assertAlmostEqual(s["social_security"]["common"], 247.41, places=2)
        self.assertAlmostEqual(s["social_security"]["unemployment"], 79.07, places=2)
        self.assertAlmostEqual(s["social_security"]["training"], 5.10, places=2)
        self.assertAlmostEqual(s["social_security"]["solidarity"], 2.55, places=2)
        self.assertAlmostEqual(s["irpf_base"], 6044.12, places=2)
        self.assertAlmostEqual(s["irpf"], 1544.27, places=2)
        self.assertAlmostEqual(s["irpf_in_kind"], 16.16, places=2)
        self.assertAlmostEqual(s["deductions"], 2215.06, places=2)
        self.assertAlmostEqual(s["net"], 5084.71, places=2)

    def test_reconciliation_flags(self):
        f = self.slip["flags"]
        self.assertEqual(f["activated"], ["2026-08-09", "2026-08-11"])
        self.assertEqual(f["not_flown"], ["2026-08-08", "2026-08-12"])
        days = {d["date"]: d for d in self.slip["days"]}
        self.assertEqual(days["2026-08-20"]["per_diem"], "int_int_overnight")   # sim in CPH
        self.assertEqual(days["2026-08-22"]["positioning"], 1)                  # home as pax
        self.assertEqual(days["2026-08-22"]["per_diem"], "int_no_overnight")


class OverrideTest(unittest.TestCase):
    def test_bdo_and_standby_overrides(self):
        c = db()
        pay.ensure_tables(c)
        c.execute("INSERT INTO flights(date, dep_icao, arr_icao, off_block_utc, block_seconds) "
                  "VALUES ('2026-08-30','LEPA','EGKK','x',8000), ('2026-08-30','EGKK','LEPA','y',8000)")
        c.execute("INSERT INTO roster_pay_overrides(date, bdo) VALUES ('2026-08-30', 1)")
        c.execute("INSERT INTO roster_pay_overrides(date, standby_paid) VALUES ('2026-08-26', 0)")
        slip = pay.payslip(c, "2026-08", today="2026-10-20")
        a = amounts(slip)
        self.assertEqual(slip["flags"]["extra_duty"], ["2026-08-30"])
        self.assertEqual(slip["flags"]["bdo_unconfirmed"], [])
        self.assertAlmostEqual(a["bdo"]["amount"], 524.79, places=2)
        self.assertEqual(a["standby"]["units"], 1)


class ProjectionTest(unittest.TestCase):
    def test_future_flying_days_use_roster_legs(self):
        c = db()
        c.execute("INSERT INTO roster VALUES ('2026-10-27','flying_duty','06:55','16:20','FlD')")
        c.executemany("INSERT INTO roster_legs VALUES ('2026-10-27','D8',?,?,?,?,?)",
                      [("PMI", "ARN", "07:55", "11:35", 1), ("ARN", "PMI", "12:20", "16:00", 2)])
        c.executemany("INSERT INTO airports VALUES (?,?)", [("LEPA", "PMI"), ("ESSA", "ARN")])
        day = next(d for d in pay.reconcile_month(c, "2026-10", today="2026-10-20") if d.date == "2026-10-27")
        self.assertTrue(day.projected)
        self.assertAlmostEqual(day.block_hours, 7.33, places=2)
        self.assertEqual(day.per_diem, "int_no_overnight")


class JornadaTest(unittest.TestCase):
    def test_per_month_jornada(self):
        """Activity month's % sets the hour bands; payslip month's % prorates the fixed pay."""
        c = db()
        pay.set_jornada(c, "2026-08", 80)     # August flown at 80 %
        pay.set_jornada(c, "2026-09", 60)     # September payslip at 60 %
        slip = pay.payslip(c, "2026-08", today="2026-10-20")
        a = amounts(slip)
        self.assertEqual((slip["jornada_prev_pct"], slip["jornada_pct"]), (80, 60))
        # 62.28 h at 80 %: 50 h normal, 10 h reduced band, 2.28 h productivity
        self.assertEqual((a["blh"]["units"], a["blhs"]["units"], a["blhp"]["units"]), (50, 10, 2.28))
        self.assertAlmostEqual(a["blhs"]["amount"], 174.40, places=2)
        # fixed pay at 60 %
        self.assertAlmostEqual(a["base_salary"]["amount"] + a["extra_pay"]["amount"], 3075.69, places=2)
        self.assertAlmostEqual(a["connectivity"]["amount"], 13.22, places=2)
        # standby / dietas are not prorated
        self.assertAlmostEqual(a["standby"]["amount"], 81.62, places=2)

    def test_unset_months_use_default(self):
        c = db()
        self.assertEqual(pay.jornada_for(c, "2026-12", 90), 90)
        pay.set_jornada(c, "2026-12", 70)
        self.assertEqual(pay.jornada_for(c, "2026-12", 90), 70)
        pay.set_jornada(c, "2026-12", None)
        self.assertEqual(pay.jornada_for(c, "2026-12", 90), 90)


class RulesTest(unittest.TestCase):
    def test_jornada_bands(self):
        self.assertEqual(pay.blh_threshold(100), 60)
        self.assertEqual(pay.blh_threshold(80), 50)
        self.assertEqual(pay.blh_threshold(50), 35)

    def test_canaries_are_spain(self):
        self.assertTrue(pay.is_spain("GCLP"))
        self.assertFalse(pay.is_spain("EKCH"))


if __name__ == "__main__":
    unittest.main()


class VacationTest(unittest.TestCase):
    def test_vacation_days_pay_var_soc(self):
        c = db()
        for d in range(11, 16):
            c.execute("INSERT INTO roster(date, duty_type, raw_code) VALUES (?, 'vacation', 'VAC')", (f"2026-09-{d:02d}",))
        a = amounts(pay.payslip(c, "2026-09", today="2026-10-20"))
        self.assertEqual(a["var_soc"]["units"], 5)
        self.assertAlmostEqual(a["var_soc"]["amount"], 204.05, places=2)   # 5 × 40.81


class SummaryParseTest(unittest.TestCase):
    def test_vacation_and_unknown_codes_are_kept(self):
        from domains.aviation.roster_importer import parse_summary
        text = "Fri11 VAC\nSat12 AL\nSun13 FlD 0635 1505\nMon14 XYZ\nTue15 Off\nTue15\nC/I PMI 0615"
        days = parse_summary(text, 2026, 9)
        self.assertEqual({d: (r.duty_type, r.raw_code) for d, r in days.items()}, {
            11: ("vacation", "VAC"), 12: ("vacation", "AL"), 13: ("flying_duty", "FlD"),
            14: ("unknown", "XYZ"), 15: ("day_off", "Off"),
        })
        self.assertEqual((days[13].report_time, days[13].end_time), ("06:35", "15:05"))
