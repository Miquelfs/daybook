"""Trade Republic PDF reader — on a PDF laid out like the real one (built here with reportlab)."""

import io
import unittest

try:
    import fitz  # noqa: F401
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    HAVE = True
except ImportError:
    HAVE = False

from domains.money import statements as st

ROWS = [  # day, month, (tipo lines), (description lines), in, out, balance
    ("01", "oct", ["Bonificación"], ["Saveback cash reward"], "12,15", None, "10.721,30"),
    ("01", "oct", ["Interés"], ["Interest payment"], "14,05", None, "10.735,35"),
    ("01", "oct", ["Transacción", "con tarjeta"], ["PRONTO FOTO PALMA"], None, "1,00", "10.734,35"),
    ("01", "oct", ["Transacción", "con tarjeta"], ["UCO BAKERY"], None, "5,80", "10.728,55"),
    ("02", "oct", ["Operar"], ["Savings plan execution XF000BTC0017 Bitcoin, quantity: 0.000126"], None, "9,94", "10.718,61"),
    ("02", "oct", ["Transacción", "con tarjeta"], ["SUN AND MOON"], None, "0,99", "10.717,62"),
    # page 2
    ("03", "oct", ["Transferencia"], ["Outgoing transfer for Miquel to", "ES12 0182 0000 0000 0000"], None, "1.000,00", "9.717,62"),
    ("31", "oct", ["Transacción", "con tarjeta"], ["MERCADONA"], None, "23,40", "9.694,22"),
]


def build_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    H = A4[1]
    X = {"date": 40, "tipo": 75, "desc": 150, "in": 400, "out": 455, "bal": 555}

    def header(y):
        c.setFont("Helvetica-Bold", 7)
        c.drawString(X["date"], y, "FECHA"); c.drawString(X["tipo"], y, "TIPO"); c.drawString(X["desc"], y, "DESCRIPCIÓN")
        c.drawString(X["in"], y + 4, "ENTRADA DE"); c.drawString(X["in"], y - 4, "DINERO")
        c.drawString(X["out"], y + 4, "SALIDA DE"); c.drawString(X["out"], y - 4, "DINERO")
        c.drawRightString(X["bal"], y, "BALANCE")

    def row(y, r):
        d, m, tipo, desc, i, o, b = r
        c.setFont("Helvetica", 8)
        c.drawString(X["date"], y, f"{d} {m}"); c.drawString(X["date"], y - 10, "2026")
        for k, t in enumerate(tipo):
            c.drawString(X["tipo"], y - 10 * k, t)
        for k, t in enumerate(desc):
            c.drawString(X["desc"], y - 10 * k, t)
        if i: c.drawString(X["in"], y, f"{i} €")
        if o: c.drawString(X["out"], y, f"{o} €")
        c.drawRightString(X["bal"], y, f"{b} €")

    c.setFont("Helvetica", 8)
    c.drawString(40, H - 40, "TRADE REPUBLIC BANK GMBH · Miquel Example · Carrer Fals 1, Palma")
    c.drawString(40, H - 52, "IBAN ES00 0000 0000 0000 0000 0000 · 01 oct 2026 - 31 oct 2026")
    c.setFont("Helvetica-Bold", 14); c.drawString(40, H - 90, "RESUMEN DE ESTADO DE CUENTA")
    c.setFont("Helvetica-Bold", 7)
    for x, t in ((40, "PRODUCTO"), (180, "BALANCE INICIAL"), (280, "ENTRADA DE DINERO"), (390, "SALIDA DE DINERO")):
        c.drawString(x, H - 115, t)
    c.drawRightString(555, H - 115, "BALANCE FINAL")
    c.setFont("Helvetica", 8)
    c.drawString(40, H - 130, "Cuenta corriente"); c.drawString(180, H - 130, "10.709,15 €")
    c.drawString(280, H - 130, "26,20 €"); c.drawString(390, H - 130, "1.041,13 €"); c.drawRightString(555, H - 130, "9.694,22 €")
    c.setFont("Helvetica-Bold", 14); c.drawString(40, H - 175, "TRANSACCIONES DE CUENTA")
    header(H - 200)
    y = H - 225
    for r in ROWS[:6]:
        row(y, r); y -= 40
    c.setFont("Helvetica", 6); c.drawString(40, 30, "Trade Republic Bank GmbH · Página 1 de 2")
    c.showPage()
    header(H - 60)
    y = H - 85
    for r in ROWS[6:]:
        row(y, r); y -= 40
    c.setFont("Helvetica-Bold", 14); c.drawString(40, y - 20, "FONDOS DEL MERCADO MONETARIO")
    c.setFont("Helvetica", 8)
    row(y - 60, ("05", "oct", ["Compra"], ["Should not be read"], None, "500,00", "1.234,00"))
    c.save()
    return buf.getvalue()


@unittest.skipUnless(HAVE, "pymupdf / reportlab not installed")
class TradeRepublicPdf(unittest.TestCase):
    def test_reads_the_table_and_checks_itself(self):
        p = st.parse(build_pdf(), "extracto.pdf")             # never reaches Claude: no anthropic call here
        self.assertEqual(p.bank, "Trade Republic")
        self.assertEqual(len(p.lines), 8)
        first, inv, transfer = p.lines[0], p.lines[4], p.lines[6]
        self.assertEqual((first.date, first.amount, first.balance, first.kind), ("2026-10-01", 12.15, 10721.30, "cashback"))
        self.assertEqual(p.lines[1].kind, "interest")
        self.assertEqual((p.lines[2].description, p.lines[2].amount, p.lines[2].kind), ("PRONTO FOTO PALMA", -1.0, "card"))
        self.assertEqual((inv.amount, inv.kind), (-9.94, "investment"))
        self.assertIn("Bitcoin", inv.description)
        self.assertEqual((transfer.amount, transfer.kind), (-1000.0, "transfer"))
        self.assertIn("ES12", transfer.description)            # a wrapped description is joined
        self.assertEqual(p.lines[-1].date, "2026-10-31")
        self.assertTrue(any("adds up to the summary" in n for n in p.notes), p.notes)


if __name__ == "__main__":
    unittest.main()
