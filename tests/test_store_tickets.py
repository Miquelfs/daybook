"""El Corte Inglés screenshot tickets (vision call stubbed), product labels, and the store comparison."""

import datetime as _dt
import unittest
from unittest import mock

from domains.money import grocery_labels, groceries, receipt_vision
from domains.money.receipts import ReceiptParseError
from tests.test_receipts import money_db

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def eci_row(product, amount, generic, qty=1, weight=None, unit=None, pack_g=None):
    return {"product": product, "quantity": qty, "weight_kg": weight, "unit_price": unit, "amount": amount,
            "generic": generic, "pack_g": pack_g}


# What the vision call returns for the 24 Oct 2026 El Corte Inglés email
ECI = {
    "is_ticket": True, "store": "El Corte Inglés", "purchased_at": "2026-10-24 20:00",
    "operation_no": "0494-1852", "total": 6.99,
    "items": [
        eci_row("CALDO POLLO BAJO SAL", 2.30, "caldo de pollo bajo en sal", unit=2.30),
        eci_row("BANANA AUTOS. AUTOSERVICI", 0.52, "plátano", weight=0.335, unit=1.56),
        eci_row("TOFU NATURAL 290G SP", 1.80, "tofu natural", unit=1.80, pack_g=290),
        eci_row("LIMON GRANEL", 1.12, "limón", weight=0.375, unit=2.99),
        eci_row("MARAVILLA GALLO PAQU", 1.25, "pasta maravilla", unit=1.25),
    ],
}


class ScreenshotTicketTest(unittest.TestCase):
    def parse(self, data, images=(PNG, PNG)):
        with mock.patch.object(receipt_vision, "_call_model", return_value=data):
            return receipt_vision.parse_screenshots(list(images))

    def test_reads_the_ticket(self):
        t = self.parse(ECI)
        self.assertEqual((t["store"], t["total"], t["invoice_no"]), ("El Corte Inglés", 6.99, "0494-1852"))
        self.assertEqual(len(t["items"]), 5)
        banana = t["items"][1]
        self.assertEqual((banana["weight_kg"], banana["unit_price"], banana["quantity"]), (0.335, 1.56, 1.0))
        self.assertEqual(t["items"][2]["pack_g"], 290)

    def test_a_line_read_twice_is_refused(self):
        dup = {**ECI, "items": ECI["items"] + [ECI["items"][-1]]}   # overlap counted twice
        with self.assertRaisesRegex(ReceiptParseError, "missing or repeated"):
            self.parse(dup)

    def test_not_a_ticket_and_no_total(self):
        with self.assertRaisesRegex(ReceiptParseError, "doesn't look like"):
            self.parse({**ECI, "is_ticket": False, "items": []})
        with self.assertRaisesRegex(ReceiptParseError, "TOTAL COMPRA"):
            self.parse({**ECI, "total": None})

    def test_image_types(self):
        self.assertEqual(receipt_vision.normalise_image(PNG)[1], "image/png")
        with self.assertRaises(ReceiptParseError):
            receipt_vision.normalise_image(b"not an image")


class StoreComparisonTest(unittest.TestCase):
    def setUp(self):
        c = self.c = money_db()
        c.executescript("""
            INSERT INTO transactions (id, date, name, amount, category, transaction_type)
              VALUES ('m', '2026-10-20', 'Mercadona', -4.10, 'Groceries', 'Expense'),
                     ('e', '2026-10-24', 'El Corte Inglés', -6.99, 'Groceries', 'Expense');
            INSERT INTO receipts (id, transaction_id, store, total, pdf_path) VALUES
              (1, 'm', 'Mercadona', 4.10, '1.pdf'), (2, 'e', 'El Corte Inglés', 6.99, '');
            INSERT INTO receipt_items (receipt_id, line_no, product, quantity, weight_kg, unit_price, amount) VALUES
              (1, 1, 'TOFU NATURAL', 1, NULL, 1.45, 1.45),
              (1, 2, 'PLATANO', 1, 0.9, 1.65, 1.49),
              (1, 3, 'GALLETAS QUELITAS', 1, NULL, 1.16, 1.16),
              (2, 1, 'TOFU NATURAL 290G SP', 1, NULL, 1.80, 1.80),
              (2, 2, 'BANANA AUTOS. AUTOSERVICI', 1, 0.335, 1.56, 0.52),
              (2, 3, 'LIMON GRANEL', 1, 0.375, 2.99, 1.12),
              (2, 4, 'CALDO POLLO BAJO SAL', 1, NULL, 2.30, 2.30),
              (2, 5, 'MARAVILLA GALLO PAQU', 1, NULL, 1.25, 1.25);
        """)
        grocery_labels.save(c, [{**i, "generic": i["generic"]} for i in ECI["items"]])

    def test_labels_missing_products_once(self):
        self.assertEqual(set(grocery_labels.missing(self.c)), {"TOFU NATURAL", "PLATANO", "GALLETAS QUELITAS"})
        fake = lambda names: [{"product": "TOFU NATURAL", "generic": "Tofu natural", "pack_g": 400},
                              {"product": "PLATANO", "generic": "plátano", "pack_g": None},
                              {"product": "NOT ASKED", "generic": "x", "pack_g": None}]
        self.assertEqual(grocery_labels.label_missing(self.c, call=fake), 2)
        self.assertEqual(grocery_labels.missing(self.c), ["GALLETAS QUELITAS"])
        # an existing label is never overwritten
        grocery_labels.save(self.c, [{"product": "PLATANO", "generic": "banana"}])
        self.assertEqual(self.c.execute("SELECT generic FROM grocery_products WHERE product='PLATANO'").fetchone()[0],
                         "plátano")

    def test_side_by_side(self):
        grocery_labels.label_missing(self.c, call=lambda names: [
            {"product": "TOFU NATURAL", "generic": "tofu natural", "pack_g": 400},
            {"product": "PLATANO", "generic": "plátano", "pack_g": None}])
        d = groceries.stores(self.c, "3m", today=_dt.date(2026, 10, 25))
        self.assertEqual([s["store"] for s in d["stores"]], ["El Corte Inglés", "Mercadona"])
        self.assertAlmostEqual(d["total"], 11.09, places=2)

        m = {x["generic"]: x for x in d["matches"]}
        self.assertEqual(set(m), {"tofu natural", "plátano"})
        tofu = m["tofu natural"]           # per kg: 1.45/0.4 = 3.63 vs 1.80/0.29 = 6.21
        self.assertEqual((tofu["basis"], tofu["cheapest"]), ("kg", "Mercadona"))
        self.assertEqual([o["price"] for o in tofu["offers"]], [3.62, 6.21])
        self.assertEqual(m["plátano"]["cheapest"], "El Corte Inglés")   # 1.56/kg vs 1.65/kg

        eci = next(e for e in d["elsewhere"] if e["store"] == "El Corte Inglés")
        self.assertEqual(eci["items"], 2)
        self.assertAlmostEqual(eci["paid"], 2.32, places=2)
        # tofu: 0.29 kg × 3.62 = 1.05; banana 0.335 kg × 1.65 = 0.55
        self.assertAlmostEqual(eci["would_pay"], 1.60, places=2)

    def test_reset_keeps_the_label(self):
        self.c.execute("UPDATE grocery_products SET grp='Pantry' WHERE product='LIMON GRANEL'")
        self.c.execute("UPDATE grocery_products SET grp=NULL, avoid=NULL WHERE product='LIMON GRANEL'")
        row = self.c.execute("SELECT generic FROM grocery_products WHERE product='LIMON GRANEL'").fetchone()
        self.assertEqual(row[0], "limón")


if __name__ == "__main__":
    unittest.main()
