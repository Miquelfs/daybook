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


if __name__ == "__main__":
    unittest.main()
