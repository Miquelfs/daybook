"""
Supermarket tickets → line items.

Mercadona's digital ticket (the PDF they email) has a real text layer, so it is
parsed here deterministically — no OCR, no AI. (El Corte Inglés only sends an
HTML email, so its tickets arrive as phone screenshots and are read by
receipt_vision; both end in check_total below.) The Mercadona text comes out one
column cell per line:

    1 GRIEGO LIGERO NAT        ← "<qty> <description>"
    2,10                       ← amount (qty > 1 prints the unit price first)
    1 AGUACATE
    0,680 kg                   ← loose produce: weight, €/kg, amount
    5,00 €/kg
    3,40
    TOTAL (€)
    30,98

The parser is strict: if the lines don't add up to the printed total it refuses
the ticket rather than store wrong prices.
"""

import re
from datetime import datetime

_MONEY = re.compile(r"^-?\d+,\d{2}$")
_WEIGHT = re.compile(r"^(\d+,\d+) kg$")
_PER_KG = re.compile(r"^(\d+,\d+) €/kg$")
_ITEM = re.compile(r"^(\d+) (.+)$")
# A description that carries its own price columns on the same line
_TRAILING_MONEY = re.compile(r"\s+(-?\d+,\d{2})$")


class ReceiptParseError(ValueError):
    pass


def check_total(items: list[dict], total: float, hint: str = "") -> None:
    """Refuse a ticket whose lines don't add up to its printed total — better no
    ticket than wrong prices."""
    if not items:
        raise ReceiptParseError("No items found on this ticket")
    got = sum(i["amount"] for i in items)
    if abs(got - total) > 0.011:
        raise ReceiptParseError(f"Items add up to {got:.2f} € but the ticket total is {total:.2f} €{hint}")


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def extract_text(pdf_bytes: bytes) -> str:
    """All pages' text. pymupdf is already on the Pi (roster imports use it)."""
    import fitz  # pymupdf

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise ReceiptParseError("Not a readable PDF") from e
    return "\n".join(page.get_text() for page in doc)


def parse_mercadona(text: str) -> dict:
    """Parse a Mercadona ticket's text into header fields + items.

    Returns {store, purchased_at, invoice_no, total, items: [{line_no, product,
    quantity, weight_kg, unit_price, amount}]}. Raises ReceiptParseError.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines or "MERCADONA" not in lines[0].upper():
        raise ReceiptParseError("Only Mercadona tickets are supported for now")

    purchased_at = invoice_no = None
    for ln in lines:
        m = re.search(r"(\d{2}/\d{2}/\d{4}) (\d{2}:\d{2})", ln)
        if m and not purchased_at:
            purchased_at = datetime.strptime(" ".join(m.groups()), "%d/%m/%Y %H:%M").strftime("%Y-%m-%d %H:%M")
        m = re.search(r"FACTURA SIMPLIFICADA:\s*(\S+)", ln)
        if m:
            invoice_no = m.group(1)

    try:
        start = lines.index("Importe") + 1
        end = next(i for i, ln in enumerate(lines) if ln.startswith("TOTAL (€)"))
        total = _num(lines[end + 1])
    except (ValueError, StopIteration, IndexError):
        raise ReceiptParseError("Couldn't find the item list on this ticket")

    items: list[dict] = []
    cur: dict | None = None

    def close(it: dict | None) -> None:
        if it is None:
            return
        money = it.pop("_money")
        if not money:
            raise ReceiptParseError(f"No price for {it['product']}")
        it["amount"] = money[-1]
        if it["weight_kg"] is None:
            it["unit_price"] = money[0] if len(money) > 1 else round(it["amount"] / it["quantity"], 2)
        items.append(it)

    for ln in lines[start:end]:
        m = _ITEM.match(ln)
        if m:
            close(cur)
            desc, money = m.group(2), []
            while (t := _TRAILING_MONEY.search(desc)):
                money.insert(0, _num(t.group(1)))
                desc = desc[: t.start()]
            cur = {
                "line_no": len(items) + 1, "product": desc.strip(), "quantity": float(m.group(1)),
                "weight_kg": None, "unit_price": None, "_money": money,
            }
            continue
        if cur is None:
            continue
        if (m := _WEIGHT.match(ln)):
            cur["weight_kg"] = _num(m.group(1))
        elif (m := _PER_KG.match(ln)):
            cur["unit_price"] = _num(m.group(1))
        elif _MONEY.match(ln):
            cur["_money"].append(_num(ln))
    close(cur)

    check_total(items, total)
    return {
        "store": "Mercadona", "purchased_at": purchased_at, "invoice_no": invoice_no,
        "total": total, "items": items,
    }
