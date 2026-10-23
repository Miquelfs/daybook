"""Mercadona ticket parsing + grocery analytics (spend by type, prices, avoid, recent)."""

import datetime as _dt
import sqlite3
import unittest

from domains.money import groceries
from domains.money.receipts import ReceiptParseError, parse_mercadona
from tests.helpers import ROOT

# pymupdf's text for the real 23/09/2026 ticket (one column cell per line)
TICKET = """MERCADONA, S.A.   A-46103834
AV ARGENTINA, 83
07011 PALMA
TELÉFONO:
971455506
23/09/2026 13:54
 OP: 626120
FACTURA SIMPLIFICADA: 2563-014-826697
Cnt. Descripción
P. Unit
Importe
1 GRIEGO LIGERO NAT
2,10
1 DOCHI CHEESECAKE
3,00
1 MUSLO DESHUESADO
2,50
1 CEBOLLA TUBO
1,70
1 QUESO FRESCO DESNATA
1,10
1 BUTIFARRA FRESCA
3,55
1 GALLETAS QUELITAS
2,15
1 LLAVES SUPER ÁCIDAS
1,00
1 QUESO CHEDDAR
2,85
1 TOM. RECETA ARTESANA
2,00
1 QUESO GRANA PADANO
3,29
1 AGUACATE
0,680 kg
5,00 €/kg
3,40
1 MANDARINA
0,516 kg
2,65 €/kg
1,37
1 BROCOLI
0,324 kg
3,00 €/kg
0,97
TOTAL (€)
30,98
TARJETA BANCARIA
30,98
IVA
BASE IMP. (€)
CUOTA (€)
TOTAL (€)
4%
18,20
0,73
18,93
TOTAL
29,15
1,83
30,98
"""


def ticket(items: str, total: str) -> str:
    head, _, _ = TICKET.partition("1 GRIEGO")
    return head + items + f"TOTAL (€)\n{total}\n"


class ParseTest(unittest.TestCase):
    def test_real_ticket(self):
        r = parse_mercadona(TICKET)
        self.assertEqual(r["store"], "Mercadona")
        self.assertEqual(r["purchased_at"], "2026-09-23 13:54")
        self.assertEqual(r["invoice_no"], "2563-014-826697")
        self.assertEqual(r["total"], 30.98)
        self.assertEqual(len(r["items"]), 14)
        self.assertEqual(r["items"][0], {
            "line_no": 1, "product": "GRIEGO LIGERO NAT", "quantity": 1.0,
            "weight_kg": None, "unit_price": 2.10, "amount": 2.10,
        })
        avocado = r["items"][11]
        self.assertEqual((avocado["product"], avocado["weight_kg"], avocado["unit_price"], avocado["amount"]),
                         ("AGUACATE", 0.68, 5.0, 3.40))

    def test_quantity_prints_unit_price_then_amount(self):
        r = parse_mercadona(ticket("2 LECHE SEMI\n0,89\n1,78\n1 PAN\n0,60\n", "2,38"))
        milk = r["items"][0]
        self.assertEqual((milk["quantity"], milk["unit_price"], milk["amount"]), (2.0, 0.89, 1.78))

    def test_prices_on_the_description_line(self):
        r = parse_mercadona(ticket("3 HUEVOS 1,20 3,60\n", "3,60"))
        self.assertEqual(r["items"][0]["product"], "HUEVOS")
        self.assertEqual(r["items"][0]["unit_price"], 1.20)

    def test_refuses_a_ticket_that_does_not_add_up(self):
        with self.assertRaises(ReceiptParseError):
            parse_mercadona(ticket("1 PAN\n0,60\n", "9,99"))

    def test_refuses_other_stores(self):
        with self.assertRaises(ReceiptParseError):
            parse_mercadona("LIDL SUPERMERCADOS\n1 PAN\n0,60\n")


class ClassifyTest(unittest.TestCase):
    def test_groups(self):
        cases = {
            "BACON 11% QUESO 32%": "Meat & fish",      # meat wins over the cheese
            "ÑOQUIS DE PATATA": "Pantry",               # not a potato
            "CEBOLLA CONG ZIP": "Fruit & veg",          # frozen veg is still veg
            "PIZZA PEPPERONI": "Frozen & ready",
            "PAÑUELO LOCION": "Household",
            "GEL AFEITAR SENS.": "Personal care",
            "LLAVES SUPER ÁCIDAS": "Sweets & snacks",
            "COLA ZERO": "Drinks",
            "SOMETHING NEW": "Other",
        }
        for name, group in cases.items():
            self.assertEqual(groceries.rule_group(name), group, name)

    def test_avoid(self):
        self.assertTrue(groceries.rule_avoid("DOCHI CHEESECAKE"))
        self.assertTrue(groceries.rule_avoid("GRIEGO AZUCAR CAÑA"))
        self.assertFalse(groceries.rule_avoid("GRIEGO SIN AZUCAR"))
        self.assertFalse(groceries.rule_avoid("COLA ZERO"))
        self.assertFalse(groceries.rule_avoid("QUESO CHEDDAR"))

    def test_override_wins(self):
        ov = {"COLA ZERO": {"grp": None, "avoid": 1}}
        self.assertEqual(groceries.classify("COLA ZERO", ov), ("Drinks", True))


def money_db() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript((ROOT / "infrastructure/db/money_schema.sql").read_text())
    return c


def add_ticket(c, txn_id, day, items, deleted=False):
    """items: [(product, amount)] or [(product, amount, weight_kg, per_kg)]"""
    total = round(sum(i[1] for i in items), 2)
    c.execute(
        "INSERT INTO transactions (id, date, name, amount, category, transaction_type, deleted_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (txn_id, day, "Mercadona", -total, "Groceries", "Expense", "x" if deleted else None),
    )
    rid = c.execute(
        "INSERT INTO receipts (transaction_id, store, total, pdf_path) VALUES (?,?,?,?)",
        (txn_id, "Mercadona", total, "x.pdf"),
    ).lastrowid
    for n, it in enumerate(items, 1):
        weight, per_kg = (it[2], it[3]) if len(it) > 2 else (None, it[1])
        c.execute(
            "INSERT INTO receipt_items (receipt_id, line_no, product, weight_kg, unit_price, amount) "
            "VALUES (?,?,?,?,?,?)",
            (rid, n, it[0], weight, per_kg, it[1]),
        )


class AnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.c = money_db()
        add_ticket(self.c, "a", "2026-09-23", [
            ("QUESO CHEDDAR", 2.85), ("DOCHI CHEESECAKE", 3.00), ("AGUACATE", 3.40, 0.68, 5.00),
        ])
        add_ticket(self.c, "b", "2026-10-13", [
            ("QUESO CHEDDAR", 2.95), ("BOLSA PLASTICO", 0.15), ("AGUACATE", 2.75, 0.5, 5.50),
        ])
        add_ticket(self.c, "gone", "2026-10-14", [("QUESO CHEDDAR", 9.99)], deleted=True)
        self.today = _dt.date(2026, 10, 23)

    def test_price_history(self):
        prods = {p["product"]: p for p in groceries.products(self.c)}
        cheddar = prods["QUESO CHEDDAR"]
        self.assertEqual([h["price"] for h in cheddar["history"]], [2.85, 2.95])   # deleted txn ignored
        self.assertEqual(cheddar["change_pct"], 3.5)
        self.assertTrue(prods["AGUACATE"]["per_kg"])
        self.assertEqual(prods["AGUACATE"]["last_price"], 5.50)                     # €/kg, not the line total
        self.assertEqual(groceries.products(self.c)[0]["product"], "AGUACATE")      # biggest move first

    def test_summary(self):
        s = groceries.summary(self.c, "month", today=self.today)                     # October only
        self.assertEqual(s["receipts"], 1)
        self.assertEqual(s["total"], 5.85)
        self.assertEqual(s["avoid_total"], 0)
        self.assertEqual(groceries.summary(self.c, "week", today=self.today)["receipts"], 0)
        last = groceries.summary(self.c, "ticket", today=self.today)                 # deleted one skipped
        self.assertEqual((last["receipts"], last["start"], last["total"]), (1, "2026-10-13", 5.85))
        s = groceries.summary(self.c, "3m", today=self.today)
        self.assertEqual(s["start"], "2026-08-01")
        self.assertEqual(s["avoid_items"][0]["product"], "DOCHI CHEESECAKE")
        self.assertEqual({g["group"] for g in s["groups"]},
                         {"Dairy & eggs", "Sweets & snacks", "Fruit & veg", "Household"})
        self.assertEqual([m["month"] for m in s["months"]], ["2026-09", "2026-10"])

    def test_recent_skips_non_food(self):
        names = [r["product"] for r in groceries.recent(self.c, 14, today=self.today)]
        self.assertEqual(names, ["AGUACATE", "QUESO CHEDDAR"])


if __name__ == "__main__":
    unittest.main()
