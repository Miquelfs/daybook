"""
Trade Republic account statement (PDF, "Extracto de cuenta") — read on the Pi, no AI.

The PDF has a summary box (RESUMEN DE ESTADO DE CUENTA: balance inicial, entrada, salida, balance
final) and a table (TRANSACCIONES DE CUENTA) with FECHA · TIPO · DESCRIPCIÓN · ENTRADA DE DINERO ·
SALIDA DE DINERO · BALANCE. Cells wrap ("01 oct" / "2026", "Transacción" / "con tarjeta"), so the
table is read by word positions:

  columns   from the header row's x positions (repeated on each page, else the last page's are kept)
  rows      start at each date in the FECHA column ("01" + a month); a row runs to the next date
  amounts   "12,15 €": the rightmost is the balance; the other is money in or out by which header
            (ENTRADA / SALIDA) it sits under
  section   ends at the next heading as large as "TRANSACCIONES DE CUENTA" (later sections — funds,
            notes — are never read as movements)

Then it checks itself: the lines' in / out must add up to the summary's, and each balance must
follow from the one before. Anything off is said in the import notes.
"""

from __future__ import annotations

import re

from domains.money.statements import Line, Parsed, StatementError, _chain_errors, _fold, kind_of, parse_amount

MONTHS = {
    "ene": 1, "jan": 1, "feb": 2, "mar": 3, "abr": 4, "apr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "aug": 8,
    "sep": 9, "sept": 9, "set": 9, "oct": 10, "okt": 10, "nov": 11, "dic": 12, "dec": 12, "dez": 12,
}
TIPO_KIND = [                                    # folded TIPO → kind, first hit wins
    ("tarjeta", "card"), ("card", "card"),
    ("bonificacion", "cashback"), ("saveback", "cashback"), ("cashback", "cashback"),
    ("interes", "interest"), ("interest", "interest"),
    ("dividend", "dividend"),
    ("operar", "investment"), ("comercio", "investment"), ("trade", "investment"), ("plan de inversion", "investment"),
    ("impuesto", "tax"), ("tax", "tax"),
    ("comision", "fee"), ("fee", "fee"),
    ("transferencia", "transfer"), ("transfer", "transfer"), ("ingreso", "transfer"),
]
_AMOUNT = re.compile(r"^-?[\d.]+,\d{2}$")
_ROW_REACH = 60                                  # pt below a page's last date that still belongs to its row


def looks_like(text: str) -> bool:
    t = _fold(text)
    return "trade republic" in t and "transacciones de cuenta" in t and "entrada de dinero" in t


def _kind(tipo: str, desc: str) -> str | None:
    t = _fold(tipo)
    for word, kind in TIPO_KIND:
        if word in t:
            return kind
    return kind_of(tipo, desc)


def _lines_of(words, tol: float = 3.0):
    """Words grouped into visual lines (by y), each sorted left to right."""
    rows: list[list] = []
    for w in sorted(words, key=lambda w: (round(w[1]), w[0])):
        if rows and abs(rows[-1][0][1] - w[1]) <= tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [sorted(r, key=lambda w: w[0]) for r in rows]


def _amounts(ws) -> list[tuple[float, float]]:
    """(x0, value) for every "1.234,56 €" in these words."""
    out = []
    for w in ws:
        tok = w[4].replace("€", "").strip()
        if _AMOUNT.match(tok):
            v = parse_amount(tok)
            if v is not None:
                out.append((w[0], v))
    return out


def _heading_size(page) -> float | None:
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            text = "".join(s["text"] for s in l["spans"])
            if "TRANSACCIONES DE CUENTA" in text.upper():
                return max(s["size"] for s in l["spans"])
    return None


def _headings(page, size: float) -> list[tuple[float, str]]:
    """(y, text) of every line set as large as the section headings."""
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            spans = [s for s in l["spans"] if s["text"].strip()]
            if spans and max(s["size"] for s in spans) >= size * 0.95:
                out.append((l["bbox"][1], "".join(s["text"] for s in spans).strip()))
    return out


def _columns(words):
    """x positions of the table's columns, from its header row (FECHA … BALANCE), and the header's y."""
    for f in words:
        if _fold(f[4]) != "fecha":
            continue
        near = [w for w in words if abs(w[1] - f[1]) <= 14]
        get = lambda name: next((w for w in near if _fold(w[4]).startswith(name)), None)
        tipo, desc, ent, sal, bal = get("tipo"), get("descripcion"), get("entrada"), get("salida"), get("balance")
        if tipo and desc and ent and sal and bal:
            return {"date": f[0], "tipo": tipo[0], "desc": desc[0], "in": ent[0], "out": sal[0], "bal": bal[2],
                    "y": max(w[3] for w in near)}
    return None


def _summary(words) -> dict | None:
    """The RESUMEN box: balance inicial, entrada, salida, balance final."""
    for line in _lines_of(words):
        if any(_fold(w[4]) == "inicial" for w in line):
            below = [l for l in _lines_of([w for w in words if w[1] > line[0][3]])]
            for l in below[:4]:
                a = _amounts(l)
                if len(a) >= 4:
                    v = [x for _, x in a[:4]]
                    return {"opening": v[0], "in": v[1], "out": v[2], "closing": v[3]}
    return None


def parse_pdf(raw: bytes) -> Parsed:
    try:
        import pymupdf as fitz
    except ImportError:                          # older pymupdf
        import fitz
    doc = fitz.open(stream=raw, filetype="pdf")
    size = None
    cols = None
    in_section = False
    summary = None
    lines: list[Line] = []
    totals = {"in": 0.0, "out": 0.0}
    for page in doc:
        words = page.get_text("words")             # (x0, y0, x1, y1, text, block, line, word)
        if summary is None:
            summary = _summary(words)
        size = size or _heading_size(page)
        if size is None:
            continue
        heads = _headings(page, size)
        start_y, end_y = (0.0 if in_section else None), page.rect.height
        for y, text in heads:
            if "TRANSACCIONES DE CUENTA" in text.upper():
                start_y, in_section = y, True
            elif start_y is not None and y > start_y:
                end_y, in_section = min(end_y, y), False          # the next section: the table is over
                break
        if start_y is None:
            continue
        page_cols = _columns([w for w in words if start_y <= w[1] < end_y])
        cols = page_cols or cols
        if not cols:
            continue
        top = page_cols["y"] if page_cols else start_y
        body = [w for w in words if top < w[1] < end_y]
        date_col = [w for w in body if cols["date"] - 4 <= w[0] < cols["tipo"] - 2]
        anchors = []
        for w in date_col:
            if re.fullmatch(r"\d{1,2}", w[4]):
                mon = next((m for m in date_col if abs(m[1] - w[1]) <= 3 and m[0] > w[0]
                            and _fold(m[4]).rstrip(".")[:4] in MONTHS), None)
                if mon:
                    anchors.append((w[1], int(w[4]), MONTHS[_fold(mon[4]).rstrip(".")[:4]]))
        anchors.sort()
        for i, (y, d, m) in enumerate(anchors):
            y_end = anchors[i + 1][0] - 2 if i + 1 < len(anchors) else min(end_y, y + _ROW_REACH)
            band = [w for w in body if y - 3 <= w[1] < y_end]
            year = next((int(w[4]) for w in band if cols["date"] - 4 <= w[0] < cols["tipo"] - 2
                         and re.fullmatch(r"(19|20)\d{2}", w[4])), None)
            if not year:
                continue
            text_of = lambda x0, x1: " ".join(w[4] for line in _lines_of([w for w in band if x0 <= w[0] < x1])
                                              for w in line).strip()
            tipo = text_of(cols["tipo"] - 2, cols["desc"] - 2)
            desc = text_of(cols["desc"] - 2, cols["in"] - 2)
            amts = _amounts([w for w in band if w[0] >= cols["in"] - 4])
            if len(amts) < 2:
                continue
            balance = amts[-1][1]
            x, v = amts[-2]
            signed = abs(v) if abs(x - cols["in"]) < abs(x - cols["out"]) else -abs(v)
            totals["in" if signed > 0 else "out"] += abs(v)
            lines.append(Line(date=f"{year:04d}-{m:02d}-{d:02d}", description=(desc or tipo)[:300],
                              amount=round(signed, 2), balance=balance, kind=_kind(tipo, desc)))
    if not lines:
        raise StatementError("Couldn't find the movements in that Trade Republic statement")

    notes = ["Trade Republic statement, read on the Pi"]
    breaks = _chain_errors(lines)
    if summary:
        off = [f"{k} {totals[k]:.2f} vs {summary[k]:.2f}" for k in ("in", "out") if abs(totals[k] - summary[k]) > 0.011]
        if off:
            notes.append("⚠ doesn't add up to the summary (" + ", ".join(off) + ") — some lines may be missing")
        elif abs(summary["opening"] + summary["in"] - summary["out"] - summary["closing"]) <= 0.011 and not breaks:
            notes.append(f"adds up to the summary ({len(lines)} lines, {summary['opening']:,.2f} → {summary['closing']:,.2f})")
    if breaks:
        notes.append(f"⚠ the running balance skips in {breaks} place{'s' if breaks != 1 else ''}")
    return Parsed(lines=lines, bank="Trade Republic", notes=notes)
