"""Bank statement parsing + reconciliation against hand-typed transactions."""

import io
import unittest

from domains.money import statements as st
from domains.money.money_db import init_money_db
from infrastructure.db.money_connection import get_money_connection
from tests.helpers import tmpdir

BBVA_CSV = """Últimos movimientos
Cuenta;ES12 0182 ****
F.Valor;Fecha;Concepto;Movimiento;Importe;Divisa;Disponible;Divisa;Observaciones
05/11/2026;05/11/2026;MERCADONA AV ARGENTINA;Pago con tarjeta;-23,40;EUR;1.476,60;EUR;
04/11/2026;03/11/2026;BAR CAN JOAN;Pago con tarjeta;-12,50;EUR;1.500,00;EUR;
03/11/2026;03/11/2026;NOMINA AEROLINEA;Transferencia recibida;1.512,50;EUR;1.512,50;EUR;
""".encode("cp1252")

REVOLUT_CSV = b"""Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-02 10:01:00,2026-11-03 09:00:00,Uber,-8.20,0.00,EUR,COMPLETED,91.80
CARD_PAYMENT,Current,2026-11-02 11:00:00,,Zara,-40.00,0.00,EUR,PENDING,
TRANSFER,Current,2026-11-04 12:00:00,2026-11-04 12:00:00,To EUR Savings,-1000.00,0.00,EUR,REVERTED,
EXCHANGE,Current,2026-11-05 12:00:00,2026-11-05 12:00:00,Exchanged to USD,-50.00,0.50,EUR,COMPLETED,41.30
"""


class Parsing(unittest.TestCase):
    def test_amounts(self):
        self.assertEqual(st.parse_amount("1.234,56"), 1234.56)
        self.assertEqual(st.parse_amount("-1,234.56"), -1234.56)
        self.assertEqual(st.parse_amount("-12,50 €"), -12.5)
        self.assertEqual(st.parse_amount("12,50-"), -12.5)
        self.assertEqual(st.parse_amount("−12.00"), -12.0)
        self.assertIsNone(st.parse_amount("abc"))

    def test_bbva_semicolon_newest_first(self):
        p = st.parse(BBVA_CSV, "movimientos.csv")
        self.assertEqual(p.bank, None)                  # nothing says BBVA in it — fine
        self.assertEqual([l.date for l in p.lines], ["2026-11-03", "2026-11-03", "2026-11-05"])
        # operation date ("Fecha") beats value date; same-day order follows the running balance
        self.assertEqual([l.amount for l in p.lines], [1512.5, -12.5, -23.4])
        self.assertEqual(p.lines[-1].balance, 1476.6)
        self.assertIn("MERCADONA", p.lines[-1].description)

    def test_revolut_skips_pending_and_reverted_and_takes_fee(self):
        p = st.parse(REVOLUT_CSV, "account-statement.csv")
        self.assertEqual(p.bank, "Revolut")
        self.assertEqual(p.skipped, 2)
        self.assertEqual([(l.date, l.amount) for l in p.lines], [("2026-11-02", -8.2), ("2026-11-05", -50.5)])

    @unittest.skipUnless(__import__("importlib").util.find_spec("openpyxl"), "openpyxl not installed")
    def test_xlsx_debit_credit_columns(self):
        import openpyxl
        from datetime import datetime
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Banco Sabadell"])
        ws.append([])
        ws.append(["Fecha operación", "Concepto", "Cargo", "Abono", "Saldo"])
        ws.append([datetime(2026, 11, 1), "GASOLINERA REPSOL", 45.0, None, 955.0])
        ws.append([datetime(2026, 11, 2), "DEVOLUCION AMAZON", None, 19.99, 974.99])
        buf = io.BytesIO()
        wb.save(buf)
        p = st.parse(buf.getvalue(), "x.xlsx")
        self.assertEqual(p.bank, "Sabadell")
        self.assertEqual([(l.date, l.amount) for l in p.lines], [("2026-11-01", -45.0), ("2026-11-02", 19.99)])

    def test_no_columns(self):
        with self.assertRaises(st.StatementError):
            st.parse(b"hello;world\n1;2\n")

    def test_names(self):
        self.assertGreaterEqual(st.name_similarity("COMPRA TARJ. 4B12 MERCADONA AV ARGENTINA PALMA", "Mercadona"), 0.99)
        self.assertLess(st.name_similarity("BAR CAN JOAN", "Mercadona"), 0.45)


class Reconcile(unittest.TestCase):
    def setUp(self):
        path = tmpdir() / "money.db"
        init_money_db(path)
        self.c = get_money_connection(path)
        add = lambda i, d, n, a, cat="Restaurant", typ="Expense": self.c.execute(
            "INSERT INTO transactions (id, source, date, name, amount, account, category, transaction_type) "
            "VALUES (?,?,?,?,?,?,?,?)", (i, "local", d, n, a, "BBVA", cat, typ))
        add("setup", "2026-01-01", "Opening", 0.0, "Account Setup", "Account Setup")
        add("pay", "2026-11-03", "Salary", 1512.5, "Income", "Income")
        add("bar", "2026-11-03", "Can Joan", -10.0)               # forgot the tip → near match
        add("ghost", "2026-11-04", "Cinema", -9.0)                # never happened in the bank
        self.c.commit()
        st.store(self.c, "BBVA", st.parse(BBVA_CSV), "movimientos.csv")

    def test_report(self):
        r = st.reconcile(self.c, "BBVA")
        self.assertEqual(r["counts"]["matched"], 1)               # salary
        self.assertEqual(r["counts"]["differs"], 1)               # bar: 10 vs 12.50
        self.assertEqual(r["differs"][0]["txn"]["id"], "bar")
        self.assertEqual(r["counts"]["missing"], 1)               # Mercadona not typed
        self.assertEqual(r["missing"][0]["amount"], -23.4)
        self.assertEqual([t["id"] for t in r["only_daybook"]], ["ghost"])
        b = r["balance"]
        self.assertEqual(b["bank_opening"], 0.0)
        self.assertEqual(b["bank_closing"], 1476.6)
        self.assertEqual(b["daybook_closing"], 1493.5)
        # the gap is exactly what the lists explain: −missing + only-in-Daybook − amount differences
        self.assertAlmostEqual(b["closing_gap"] - b["opening_gap"],
                               -r["totals"]["missing"] + r["totals"]["only_daybook"] - r["totals"]["differs"])
        self.assertEqual(b["unexplained"], 0)
        self.assertEqual(b["breaks"], [])

    def test_reimport_dedups(self):
        again = st.store(self.c, "BBVA", st.parse(BBVA_CSV), "again.csv")
        self.assertEqual(again["lines_new"], 0)

    def test_manual_link_and_ignore(self):
        r = st.reconcile(self.c, "BBVA")
        merc = r["missing"][0]["id"]
        self.c.execute("UPDATE statement_lines SET txn_id='ghost' WHERE id=?", (merc,))
        self.c.commit()
        r = st.reconcile(self.c, "BBVA")
        self.assertEqual(r["counts"]["missing"], 0)
        self.assertEqual(r["counts"]["only_daybook"], 0)
        self.c.execute("UPDATE statement_lines SET txn_id=NULL, ignored=1 WHERE id=?", (merc,))
        self.c.commit()
        self.assertEqual(st.reconcile(self.c, "BBVA")["counts"]["ignored"], 1)

    def test_logged_on_another_account_moves_here(self):
        self.c.execute("INSERT INTO transactions (id, source, date, name, amount, account, category, transaction_type) "
                       "VALUES ('merc','local','2026-11-05','Mercadona',-23.4,'Revolut','Groceries','Expense')")
        self.c.commit()
        r = st.reconcile(self.c, "BBVA")
        self.assertEqual([t["id"] for t in r["missing"][0]["elsewhere"]], ["merc"])
        st.move_here(self.c, r["missing"][0]["id"], "merc")
        r = st.reconcile(self.c, "BBVA")
        self.assertEqual(r["counts"]["missing"], 0)
        self.assertEqual(self.c.execute("SELECT account FROM transactions WHERE id='merc'").fetchone()[0], "BBVA")

    def test_add_all_as_alerts_then_settle(self):
        out = st.add_all(self.c, "BBVA")
        self.assertEqual(out, {"alert": 1, "filed": 0, "left": 0})
        t = self.c.execute("SELECT category, amount, notes FROM transactions WHERE category='Alert'").fetchone()
        self.assertEqual((t[0], t[1]), ("Alert", -23.4))
        self.assertIn("MERCADONA", t[2])
        r = st.reconcile(self.c, "BBVA")
        self.assertEqual(r["counts"]["missing"], 0)
        self.assertNotEqual(r["balance"]["closing_gap"], 0)          # the ghost cinema and the tip still differ
        added = st.settle(self.c, "BBVA")
        self.assertEqual(len(added), 1)                              # no gap before the statement → one adjustment
        r = st.reconcile(self.c, "BBVA")
        self.assertAlmostEqual(r["balance"]["closing_gap"], 0, places=2)
        # Daybook had too little (a −9 cinema the bank never saw, less a 2.50 tip it missed) → a +6.50 🚨 Alert income
        adj = self.c.execute("SELECT category, transaction_type, amount FROM transactions WHERE source_id LIKE 'bankcheck:%'").fetchone()
        self.assertEqual(tuple(adj), ("Alert", "Income", 6.5))
        # the period is closed: the ghost is set aside, not listed, and the adjustment isn't "only in Daybook"
        self.assertEqual(r["only_daybook"], [])
        self.assertEqual(r["counts"]["only_daybook"], 0)
        self.assertEqual([t["id"] for t in r["settled"]["only_daybook"]], ["ghost"])
        again = st.settle(self.c, "BBVA")                            # same period again: replaces, never piles up
        self.assertEqual(len(again), 1)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM transactions WHERE source_id LIKE 'bankcheck:%'").fetchone()[0], 1)
        st.unsettle(self.c, "BBVA")                                  # reopen
        r = st.reconcile(self.c, "BBVA")
        self.assertEqual([t["id"] for t in r["only_daybook"]], ["ghost"])
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM transactions WHERE source_id LIKE 'bankcheck:%'").fetchone()[0], 0)


class Kinds(unittest.TestCase):
    def test_kind_words(self):
        self.assertEqual(st.kind_of("Saveback", "iShares Core MSCI World"), "investment")
        self.assertEqual(st.kind_of("Transferencia", "Ingreso a Trade Republic"), "transfer")
        self.assertEqual(st.kind_of("Taxi Palma"), None)
        self.assertEqual(st.kind_of("Abono nómina"), None)
        self.assertEqual(st.kind_of("Pago de intereses"), "interest")
        self.assertEqual(st.kind_of("Transacción con tarjeta", "Mercadona"), "card")
        self.assertEqual(st.kind_of("CARD_PAYMENT"), "card")

    def test_trade_republic_pdf_in_parts(self):
        from unittest import mock
        import json as _json
        pages = [f"page {i}\n" + "x" * 9000 for i in range(4)]
        calls = []

        class Msg:
            def __init__(self, text, stop="end_turn"):
                self.stop_reason = stop
                self.content = [type("B", (), {"type": "text", "text": text})()]

        def create(**kw):
            text = kw["messages"][0]["content"]
            calls.append(text)
            i = len(calls)
            return Msg(_json.dumps({"bank": "Trade Republic", "lines": [
                {"date": f"2026-10-0{i}", "description": f"Saveback · ETF {i}", "amount": -1.5, "balance": None, "kind": "investment"},
                {"date": f"2026-10-0{i}", "description": "Mercadona", "amount": -10.0, "balance": None, "kind": "card"}]}))

        client = mock.Mock()
        client.messages.create.side_effect = create
        import sys, types
        fake = types.SimpleNamespace(Anthropic=lambda: client, APIError=type("APIError", (Exception,), {}))
        with mock.patch.object(st, "_pdf_pages", return_value=pages), mock.patch.dict(sys.modules, {"anthropic": fake}):
            p = st.parse(b"%PDF-1.7 fake", "tr.pdf")
        self.assertGreater(len(calls), 1)                            # read in parts
        self.assertEqual(p.bank, "Trade Republic")
        self.assertEqual({l.kind for l in p.lines}, {"investment", "card"})
        self.assertTrue(any("investment" in n for n in p.notes))

    def test_investment_account_and_filing(self):
        path = tmpdir() / "money.db"
        init_money_db(path)
        c = get_money_connection(path)
        self.assertEqual(st.investment_account_for(c, "Trade Republic Cash"), "Trade Republic Wealth")
        self.assertEqual(st.suggest(c, "Pago de intereses", 3.2, "interest")["category"], "Income")


TR_CSV = """Fecha;Tipo;Descripción;Importe;Balance
02/10/2026;Operar;Savings plan execution IE00B4L5Y983 iShares Core MSCI World, quantity: 0.1;-10,00;990,00
02/10/2026;Operar;Savings plan execution XF000BTC0017 Bitcoin, quantity: 0.0001;-9,94;980,06
03/10/2026;Operar;Savings plan execution IE00BK5BQT80 Vanguard FTSE All-World, quantity: 0.1;-10,00;970,06
02/11/2026;Operar;Savings plan execution IE00B4L5Y983 iShares Core MSCI World, quantity: 0.1;-10,00;960,06
""".encode()


class SavingsPlans(unittest.TestCase):
    def setUp(self):
        path = tmpdir() / "money.db"
        init_money_db(path)
        self.c = c = get_money_connection(path)
        c.executescript("""
            INSERT INTO holdings (id, account, ticker, isin, name, asset_class, quantity) VALUES
              ('tr-world','Trade Republic Wealth','EUNL.DE','IE00B4L5Y983','iShares World','equity_etf',1),
              ('tr-btc','Trade Republic Wealth','BTC-EUR','XF000BTC0017','Bitcoin','crypto',1),
              ('mi-sp','My Investor','IE00B03HD191','IE00B03HD191','Vanguard SP','equity_etf',1);
            INSERT INTO investment_plans (id, holding_id, source_account, amount_eur, cadence, day_of_month, start_date, next_execution_date)
              VALUES (1,'tr-world','My Investor',10,'monthly',1,'2026-01-01','2026-12-01'),
                     (2,'tr-btc','Trade Republic Cash',10,'monthly',1,'2026-01-01','2026-12-01'),
                     (3,'mi-sp','My Investor',10,'weekly',NULL,'2026-01-01','2026-12-01');
            INSERT INTO transactions (id, source, date, name, amount, account, category, transaction_type) VALUES
              ('btc-oct','local','2026-10-01','DCA: BTC-EUR (monthly)',-10,'Trade Republic Cash','Finance','Finance'),
              ('sp-oct','local','2026-10-03','DCA: IE00B03HD191 (weekly)',-10,'My Investor','Finance','Finance'),
              ('w-oct','local','2026-10-01','DCA: EUNL.DE (monthly)',-10,'My Investor','Finance','Finance');
            INSERT INTO investment_plan_executions (plan_id, execution_date, amount_eur, price_eur, quantity_added, transaction_id, status)
              VALUES (2,'2026-10-01',10,1,10,'btc-oct','success'),(3,'2026-10-03',10,1,10,'sp-oct','success'),
                     (1,'2026-10-01',10,1,10,'w-oct','success');
        """)
        c.commit()
        st.store(c, "Trade Republic Cash", st.parse(TR_CSV, "tr.csv"), "tr.csv")

    def test_isin_matching_and_other_funds(self):
        r = st.reconcile(self.c, "Trade Republic Cash")
        btc = next(l for l in r["differs"] if "Bitcoin" in l["description"])      # a day and 6 cents off → same fund
        self.assertEqual((btc["txn"]["id"], btc["how"]), ("btc-oct", "isin"))
        vang = next(l for l in r["missing"] if "Vanguard" in l["description"])
        self.assertEqual(vang["elsewhere"], [])                 # My Investor's S&P plan is another fund
        world = next(l for l in r["missing"] if "World" in l["description"] and l["date"] == "2026-10-02")
        self.assertEqual([t["id"] for t in world["elsewhere"]], ["w-oct"])        # same fund, booked on My Investor

    def test_plan_check(self):
        plans = {p["isin"]: p for p in st.savings_plans(self.c, "Trade Republic Cash")}
        self.assertEqual(plans["IE00B4L5Y983"]["issues"], ["account"])
        self.assertEqual(plans["IE00B4L5Y983"]["cadence"], "monthly")
        self.assertEqual(plans["XF000BTC0017"]["issues"], [])
        self.assertEqual(plans["IE00BK5BQT80"]["issues"], ["no_holding"])
        self.assertEqual(st.move_plan_executions(self.c, 1, "Trade Republic Cash", "2026-10-01", "2026-11-30"), 1)
        self.assertEqual(self.c.execute("SELECT account FROM transactions WHERE id='w-oct'").fetchone()[0], "Trade Republic Cash")

    def test_book_past_runs_from_the_statement(self):
        # the World plan existed on the wrong account; after fixing it, the Nov run is still unbooked
        plans = {p["isin"]: p for p in st.savings_plans(self.c, "Trade Republic Cash")}
        self.assertEqual(plans["IE00B4L5Y983"]["unbooked"], 2)
        out = st.book_plan_runs(self.c, "Trade Republic Cash", "IE00B4L5Y983", add_units=True)
        self.assertEqual((out["booked"], out["amount"]), (2, 20.0))
        self.assertAlmostEqual(out["units"], 0.2)
        r = st.reconcile(self.c, "Trade Republic Cash")
        self.assertFalse([l for l in r["missing"] if l.get("isin") == "IE00B4L5Y983"])
        q = self.c.execute("SELECT quantity FROM holdings WHERE id='tr-world'").fetchone()[0]
        self.assertAlmostEqual(q, 1.2)
        n = self.c.execute("SELECT COUNT(*) FROM investment_plan_executions WHERE plan_id=1").fetchone()[0]
        self.assertEqual(n, 3)

    def test_booking_inside_a_settled_period_resettles(self):
        st.settle(self.c, "Trade Republic Cash")
        gap = lambda: st.reconcile(self.c, "Trade Republic Cash")["balance"]["closing_gap"]
        self.assertAlmostEqual(gap(), 0, places=2)
        st.book_plan_runs(self.c, "Trade Republic Cash", "IE00B4L5Y983")
        self.assertAlmostEqual(gap(), 0, places=2)             # the adjustment shrank instead of counting twice

    def test_add_all_files_investments_like_plans(self):
        st.add_all(self.c, "Trade Republic Cash")
        rows = self.c.execute("SELECT name, category, transaction_type FROM transactions WHERE notes LIKE 'From the bank%'").fetchall()
        self.assertTrue(rows)
        self.assertTrue(all(r["category"] == "Finance" and r["transaction_type"] == "Finance" for r in rows))
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM transactions WHERE account='Trade Republic Wealth'").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
