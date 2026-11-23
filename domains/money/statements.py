"""
Bank statements, as a check on what you typed by hand.

Expenses are still entered one by one in Daybook — that habit is the point. A statement
exported from the bank is only read to find where the two disagree:

  parse(raw, filename)        CSV / XLSX / XLS from any bank (BBVA, Sabadell, Revolut, Trade
                              Republic…): the header row is found by its column names (Spanish or
                              English), amounts in either "1.234,56" or "1,234.56", one signed amount
                              column or separate debit / credit ones. A Trade Republic PDF has its own
                              reader (statement_tr.py, on the Pi); any other PDF is read by Claude.
  store(conn, account, …)     keeps the lines per account; a line already stored (same day, amount,
                              text and position among identical ones) is skipped, so overlapping
                              exports never double up.
  reconcile(conn, account…)   matches each bank line to one Daybook transaction — same amount within
                              a few days (card payments post a day or two late), then a near amount on
                              a similar name (a tip, a currency fee) — and reports what's only in the
                              bank, only in Daybook, the amounts that differ, and the balance gap.

Matching is recomputed on every read, so fixing an entry by hand is reflected at once. Only the
links you make yourself (or "Add to Daybook") and the lines you ignore are stored.

Closing the gap (all on the reconcile page):
  elsewhere                   a bank line you logged on another account (same amount, same days, and
                              that account's own statement doesn't have it) → move it here.
  add_line / add_all          create the Daybook entry from a bank line. Add all files each line by its
                              kind — an investment as a Transfer (mirrored on the matching investment
                              account), interest / dividends / cashback as Income, fees / tax as Finance —
                              and everything you'd have typed yourself as 🚨 Alert, to look at later.
  settle                      closes the period: what's still off is booked as an 🚨 Alert expense or
                              income (the gap before the statement starts, and the rest at its end),
                              and its unexplained lines stop showing. Settling the same period again
                              recomputes it; a new month adds its own. unsettle() reopens the last one.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import os
import re
import sqlite3
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher

log = logging.getLogger(__name__)

DATE_WINDOW = 4          # days a bank line may sit from the day you logged it
NEAR_WINDOW = 2          # … for a near-amount match
NEAR_ABS, NEAR_PCT = 3.0, 0.15   # a near amount: within €3 or 15 %, whichever is larger
NEAR_NAME = 0.45         # … and the names must look alike


class StatementError(ValueError):
    pass


@dataclass
class Line:
    date: str
    description: str
    amount: float
    balance: float | None = None
    currency: str | None = None
    kind: str | None = None               # KINDS — what sort of movement (from the bank's type column / text)


@dataclass
class Parsed:
    lines: list[Line]
    bank: str | None = None
    skipped: int = 0                      # rows that weren't completed movements (pending, reverted…)
    notes: list[str] = field(default_factory=list)


# What a movement is. Only card / transfer / other are things you'd log as spending; the rest are
# filed for you by "Add" (a stock buy is a Transfer to the investment account, interest is Income…).
KINDS = ("card", "transfer", "investment", "interest", "dividend", "cashback", "fee", "tax", "other")

_KIND_WORDS = [                                      # folded words → kind, first hit wins
    ("investment", ("savings plan", "plan de inversion", "sparplan", "round up", "roundup", "redondeo",
                    "saveback", "compra de valores", "venta de valores", "buy trade", "sell trade", " operar ",
                    " comercio ", "orden de compra", "orden de venta", "execution", "ejecucion", " etf ")),
    ("dividend", ("dividend", "dividendo", "distribucion", "ausschuttung")),
    ("interest", ("interest", "interes", "intereses", "zinsen", "rentabilidad")),
    ("cashback", ("cashback", "bonificacion", "reembolso promocional", " reward")),
    ("tax", ("impuesto", "retencion", "withholding", " tax ", "hacienda", "steuer")),
    ("fee", ("comision", " fee ", "commission")),
    ("card", (" card", "tarjeta", "pago con tarjeta", " compra ")),
    ("transfer", ("transfer", "bizum", "topup", "top up", "ingreso", "deposit", "exchange",
                  "traspaso", "recibo", "adeudo")),
]


def kind_of(*texts: object) -> str | None:
    """Best guess at a movement's kind from the bank's type column and / or its description."""
    blob = " " + re.sub(r"[^a-z0-9]+", " ", " ".join(_fold(t) for t in texts if t)) + " "
    if not blob.strip():
        return None
    for kind, words in _KIND_WORDS:
        if any(w in blob for w in words):
            return kind
    return None


# ── text helpers ──────────────────────────────────────────────────────────────

def _fold(s: object) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


_NOISE = {
    "compra", "compras", "tarjeta", "tarj", "pago", "pagos", "en", "de", "del", "la", "el", "los", "con",
    "card", "payment", "transaction", "to", "from", "debito", "credito", "mov", "movimiento", "adeudo",
    "recibo", "transferencia", "realizada", "recibida", "bizum", "apple", "pay", "contactless", "sl", "sa",
    "s.l", "s.a", "es", "esp", "spain", "espana", "palma", "mallorca", "num", "n",
}


def name_key(s: str) -> str:
    """'COMPRA TARJ. 4B12 MERCADONA AV ARGENTINA PALMA' → 'mercadona av argentina'."""
    words = re.findall(r"[a-z]+", _fold(s))
    return " ".join(w for w in words if w not in _NOISE and len(w) > 1)


def name_similarity(a: str, b: str) -> float:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return 0.0
    if ka in kb or kb in ka:
        return 1.0
    ta, tb = set(ka.split()), set(kb.split())
    overlap = len(ta & tb) / max(1, min(len(ta), len(tb)))
    ratio = SequenceMatcher(None, ka, kb).ratio()
    return max(overlap, ratio if ratio >= 0.6 else ratio / 2)   # loose letter overlap alone isn't a match


# ── numbers and dates ─────────────────────────────────────────────────────────

def parse_amount(v: object) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("−", "-").replace("\xa0", "").replace(" ", "")
    s = re.sub(r"(EUR|€|USD|\$|GBP|£)", "", s, flags=re.I)
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if s.endswith("-"):                     # "12,50-"
        neg, s = True, s[:-1]
    if not re.fullmatch(r"[+-]?[\d.,]+", s):
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):     # 1.234,56
            s = s.replace(".", "").replace(",", ".")
        else:                               # 1,234.56
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if s.count(",") == 1 else s.replace(",", "")
    elif s.count(".") > 1:                  # 1.234.567
        s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return -abs(n) if neg else n


_DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y")


def parse_date(v: object) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    s = re.split(r"[ T]", s, maxsplit=1)[0] if re.match(r"\d", s) else s
    for f in _DATE_FORMATS:
        try:
            d = datetime.strptime(s, f).date()
        except ValueError:
            continue
        if 2000 <= d.year <= 2100:
            return d.isoformat()
    return None


# ── reading the file into rows ────────────────────────────────────────────────

def _rows_csv(raw: bytes) -> list[list[object]]:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = "\n".join(text.splitlines()[:40])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delim = dialect.delimiter
    except csv.Error:
        delim = max(";,\t", key=sample.count)
    return [row for row in csv.reader(io.StringIO(text), delimiter=delim)]


def _rows_xlsx(raw: bytes) -> list[list[object]]:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    best: list[list[object]] = []
    for ws in wb.worksheets:                 # the sheet with the most rows is the movements
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        if len(rows) > len(best):
            best = rows
    return best


def _rows_xls(raw: bytes) -> list[list[object]]:
    import xlrd
    book = xlrd.open_workbook(file_contents=raw)
    best: list[list[object]] = []
    for sh in book.sheets():
        rows = []
        for i in range(sh.nrows):
            row = []
            for c in sh.row(i):
                if c.ctype == xlrd.XL_CELL_DATE:
                    row.append(xlrd.xldate_as_datetime(c.value, book.datemode))
                else:
                    row.append(c.value)
            rows.append(row)
        if len(rows) > len(best):
            best = rows
    return best


def _rows_html(raw: bytes) -> list[list[object]]:
    """Some banks' "Excel" export is an HTML table with an .xls name."""
    from html.parser import HTMLParser

    class P(HTMLParser):
        def __init__(self):
            super().__init__()
            self.rows, self.row, self.cell, self.inside = [], None, [], False

        def handle_starttag(self, tag, attrs):
            if tag == "tr":
                self.row = []
            elif tag in ("td", "th"):
                self.inside, self.cell = True, []

        def handle_endtag(self, tag):
            if tag in ("td", "th") and self.row is not None:
                self.row.append(" ".join("".join(self.cell).split()))
                self.inside = False
            elif tag == "tr" and self.row is not None:
                self.rows.append(self.row)
                self.row = None

        def handle_data(self, data):
            if self.inside:
                self.cell.append(data)

    p = P()
    p.feed(raw.decode("utf-8", "ignore") if b"charset=utf-8" in raw[:2000].lower() else raw.decode("latin-1"))
    return p.rows


# ── finding the columns ───────────────────────────────────────────────────────

# Earlier names win: the day you paid beats the day it was valued.
_COLS = {
    "date": ["fecha operacion", "f. operacion", "f.operacion", "fecha de operacion", "started date", "fecha",
             "date", "booking date", "transaction date", "datum", "data", "fecha contable", "completed date",
             "fecha valor", "f. valor", "f.valor", "value date"],
    "desc": ["concepto", "descripcion", "description", "movimiento", "detalle", "payee", "merchant", "beneficiario",
             "observaciones", "remitente", "referencia", "name", "nombre", "counterparty", "texto"],
    "amount": ["importe", "amount", "cantidad", "import", "importe (eur)", "importe eur", "betrag", "valor"],
    "debit": ["cargo", "cargos", "debe", "debit", "money out", "paid out", "salida", "gasto"],
    "credit": ["abono", "abonos", "haber", "credit", "money in", "paid in", "entrada", "ingreso"],
    "balance": ["saldo", "balance", "saldo disponible", "saldo contable", "disponible"],
    "fee": ["fee", "comision", "comisiones"],
    "state": ["state", "estado", "status"],
    "currency": ["currency", "divisa", "moneda"],
    "type": ["tipo", "type", "transaction type", "tipo de transaccion", "tipo de movimiento", "categoria"],
}


def _match_col(header: list[str], names: list[str], used: set[int]) -> int | None:
    for n in names:                                       # exact names first, in preference order
        for i, h in enumerate(header):
            if i not in used and h == n:
                return i
    for n in names:                                       # then "importe (€)", "fecha operación:"…
        for i, h in enumerate(header):
            if i not in used and h.startswith(n) and len(h) <= len(n) + 8:
                return i
    return None


def _find_header(rows: list[list[object]]) -> tuple[int, dict[str, int | list[int]]] | None:
    for r, row in enumerate(rows[:60]):
        header = [_fold(c).rstrip(":").strip() for c in row]
        used: set[int] = set()
        cols: dict[str, int | list[int]] = {}
        d = _match_col(header, _COLS["date"], used)
        if d is None:
            continue
        used.add(d)
        cols["date"] = d
        for key in ("amount", "debit", "credit", "balance", "fee", "state", "currency", "type"):
            i = _match_col(header, _COLS[key], used)
            if i is not None:
                cols[key] = i
                used.add(i)
        if "amount" not in cols and not ("debit" in cols or "credit" in cols):
            continue
        descs = []
        for n in _COLS["desc"]:
            for i, h in enumerate(header):
                if i not in used and (h == n or h.startswith(n)) and i not in descs:
                    descs.append(i)
        cols["desc"] = sorted(descs)
        return r, cols
    return None


def _guess_bank(rows: list[list[object]], filename: str | None) -> str | None:
    blob = _fold(" ".join(str(c) for row in rows[:12] for c in row if c) + " " + (filename or ""))
    for key, name in (("revolut", "Revolut"), ("bbva", "BBVA"), ("sabadell", "Sabadell"), ("trade republic", "Trade Republic"),
                      ("caixabank", "CaixaBank"), ("santander", "Santander"), ("ing", "ING"), ("n26", "N26"), ("wise", "Wise")):
        if re.search(rf"\b{key}\b", blob):
            return name
    header = _find_header(rows)
    if header and {"fee", "state"} <= set(header[1]):
        return "Revolut"
    return None


def _cell(row: list[object], i: int | None) -> object:
    return row[i] if i is not None and i < len(row) else None


def parse_rows(rows: list[list[object]], filename: str | None = None) -> Parsed:
    found = _find_header(rows)
    if not found:
        raise StatementError("Couldn't find the movements in that file — it needs a date and an amount column")
    h, cols = found
    out: list[Line] = []
    skipped = 0
    for row in rows[h + 1:]:
        if not any(c not in (None, "") for c in row):
            continue
        d = parse_date(_cell(row, cols["date"]))
        if not d:
            continue
        state = _fold(_cell(row, cols.get("state")))
        if state and state not in ("completed", "completado", "completada", "ok", "booked", "settled"):
            skipped += 1                                  # pending / reverted / declined
            continue
        if "amount" in cols:
            amt = parse_amount(_cell(row, cols["amount"]))
        else:
            deb = parse_amount(_cell(row, cols.get("debit")))
            cre = parse_amount(_cell(row, cols.get("credit")))
            if deb is None and cre is None:
                amt = None
            else:
                amt = (abs(cre) if cre else 0.0) - (abs(deb) if deb else 0.0)
        if amt is None:
            continue
        fee = parse_amount(_cell(row, cols.get("fee")))
        if fee:
            amt -= abs(fee)
        desc = " · ".join(dict.fromkeys(str(_cell(row, i)).strip() for i in cols["desc"]
                                        if str(_cell(row, i) or "").strip())) or "(no description)"
        bal = parse_amount(_cell(row, cols.get("balance")))
        cur = str(_cell(row, cols.get("currency")) or "").strip().upper() or None
        typ = str(_cell(row, cols.get("type")) or "").strip()
        out.append(Line(date=d, description=desc[:300], amount=round(amt, 2), balance=bal, currency=cur,
                        kind=kind_of(typ, desc) or ("card" if typ else None)))
    if not out:
        raise StatementError("Found the columns but no movements under them")
    return Parsed(lines=_chronological(out), bank=_guess_bank(rows, filename), skipped=skipped)


def _chain_errors(lines: list[Line]) -> int:
    """How many lines don't follow from the one before (balance_prev + amount ≠ balance)."""
    bad = 0
    for a, b in zip(lines, lines[1:]):
        if a.balance is not None and b.balance is not None and abs(a.balance + b.amount - b.balance) > 0.011:
            bad += 1
    return bad


def _chronological(lines: list[Line]) -> list[Line]:
    """Oldest first. Banks list newest first more often than not; within a day only the running
    balance tells the order, so try both directions and keep the one whose balances chain."""
    if len(lines) < 2:
        return lines
    rev = list(reversed(lines))
    if any(l.balance is not None for l in lines):
        fwd_ok = all(a.date <= b.date for a, b in zip(lines, lines[1:]))
        rev_ok = all(a.date <= b.date for a, b in zip(rev, rev[1:]))
        if fwd_ok and rev_ok:                              # all one day
            return lines if _chain_errors(lines) <= _chain_errors(rev) else rev
        if rev_ok and not fwd_ok:
            return rev
        if fwd_ok:
            return lines
    if lines[0].date > lines[-1].date:
        lines = rev
    return sorted(lines, key=lambda l: l.date)            # stable: keeps the file's order within a day


# ── PDF: let Claude read it ───────────────────────────────────────────────────

STATEMENT_MODEL = os.getenv("STATEMENT_MODEL", "claude-opus-5-5")
PDF_CHUNK_CHARS = 14_000          # text per request — a long statement is read in parts, side by side
PDF_WORKERS = 4
_PDF_SCHEMA = {
    "type": "object",
    "properties": {
        "bank": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "date": {"type": "string"},
                    "description": {"type": "string"},
                    "amount": {"type": "number"},
                    "balance": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "kind": {"type": "string", "enum": list(KINDS)},
                },
                "required": ["date", "description", "amount", "balance", "kind"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["bank", "lines"],
    "additionalProperties": False,
}

_PDF_PROMPT = """This is the text of part of a bank or broker account statement (probably Spanish; Trade Republic, \
BBVA, Revolut…). {part}List every money movement in it, in the order printed:
- date as YYYY-MM-DD (the operation date when two are given)
- description: the merchant / counterparty / security, as printed (add the bank's type word in front when it helps, \
e.g. "Saveback · iShares Core MSCI World")
- amount signed from the account's point of view: negative = money out of the cash account, positive = money in. \
When the statement has separate in / out columns ("Entrada de dinero" / "Salida de dinero"), use them for the sign.
- balance: the running balance after it if printed, else null
- kind: card (card payment or refund), transfer (bank transfer, Bizum, top-up, direct debit), investment (buying or \
selling shares / ETFs / crypto, savings plan executions, round-ups, saveback), interest, dividend, cashback (cashback, \
bonuses, rewards), fee, tax (withholding), other.
Skip headers, page footers, totals, summaries, the portfolio / holdings overview and the opening / closing balance rows. \
If this part has no movements, return an empty list.

"""


def _pdf_pages(raw: bytes) -> list[str]:
    try:
        import pymupdf as fitz
    except ImportError:                          # older pymupdf
        import fitz
    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception as e:
        raise StatementError(f"That PDF couldn't be opened ({type(e).__name__})")
    if doc.needs_pass:
        raise StatementError("That PDF is password-protected — export it again without a password")
    return [p.get_text() for p in doc]


def _pdf_chunks(pages: list[str]) -> list[str]:
    chunks, cur = [], ""
    for p in pages:
        if cur and len(cur) + len(p) > PDF_CHUNK_CHARS:
            chunks.append(cur)
            cur = ""
        cur += p + "\n"
    if cur.strip():
        chunks.append(cur)
    # a single huge page still goes in pieces (split on lines)
    out = []
    for c in chunks:
        while len(c) > PDF_CHUNK_CHARS * 1.5:
            cut = c.rfind("\n", 0, PDF_CHUNK_CHARS)
            cut = cut if cut > 0 else PDF_CHUNK_CHARS
            out.append(c[:cut])
            c = c[cut:]
        out.append(c)
    return out


def _read_chunk(client, text: str, i: int, n: int, depth: int = 0) -> dict:
    part = f"This is part {i + 1} of {n}. " if n > 1 else ""
    msg = client.messages.create(
        model=STATEMENT_MODEL,
        max_tokens=32000,
        output_config={"format": {"type": "json_schema", "schema": _PDF_SCHEMA}},
        messages=[{"role": "user", "content": _PDF_PROMPT.format(part=part) + text}],
    )
    if msg.stop_reason == "max_tokens":            # too many movements for one answer → halves
        if depth >= 3 or len(text) < 2000:
            raise StatementError("That PDF has more movements on one page than can be read at once — export a CSV instead")
        mid = text.rfind("\n", 0, len(text) // 2) or len(text) // 2
        a, b = _read_chunk(client, text[:mid], i, n, depth + 1), _read_chunk(client, text[mid:], i, n, depth + 1)
        return {"bank": a.get("bank") or b.get("bank"), "lines": a["lines"] + b["lines"]}
    if msg.stop_reason == "refusal":
        raise StatementError("Claude wouldn't read that PDF — export a CSV or Excel instead")
    return json.loads(next(b.text for b in msg.content if b.type == "text"))


def _parse_pdf(raw: bytes) -> Parsed:
    pages = _pdf_pages(raw)
    if len("".join(pages).strip()) < 40:
        raise StatementError("That PDF has no text in it (a scan?) — export a CSV or Excel instead")
    from domains.money import statement_tr
    if statement_tr.looks_like("\n".join(pages[:3])):  # its own reader: stays on the Pi, checks itself
        try:
            return statement_tr.parse_pdf(raw)
        except StatementError:
            log.warning("Trade Republic reader found nothing — asking Claude instead")
    import anthropic
    from concurrent.futures import ThreadPoolExecutor
    client = anthropic.Anthropic()
    chunks = _pdf_chunks(pages)
    try:
        with ThreadPoolExecutor(PDF_WORKERS) as ex:
            parts = list(ex.map(lambda ic: _read_chunk(client, ic[1], ic[0], len(chunks)), enumerate(chunks)))
    except anthropic.APIError as e:
        log.exception("statement PDF: Claude call failed")
        raise StatementError(f"Claude couldn't read it just now ({type(e).__name__}) — try again in a minute")
    except (json.JSONDecodeError, StopIteration):
        log.exception("statement PDF: unreadable answer")
        raise StatementError("Claude's reading of that PDF came back broken — try again, or export a CSV")
    lines = []
    for data in parts:
        for l in data["lines"]:
            d = parse_date(l["date"])
            if not d:
                continue
            kind = l.get("kind") if l.get("kind") in KINDS else kind_of(l["description"])
            lines.append(Line(date=d, description=str(l["description"])[:300], amount=round(float(l["amount"]), 2),
                              balance=l.get("balance"), kind=kind))
    if not lines:
        raise StatementError("Couldn't find any movements in that PDF")
    bank = next((p.get("bank") for p in parts if p.get("bank")), None)
    notes = ["Read from a PDF by Claude — check the totals"]
    inv = sum(1 for l in lines if l.kind == "investment")
    if inv:
        notes.append(f"{inv} investment movement{'s' if inv != 1 else ''} (buys, savings plan, round-ups, saveback)")
    return Parsed(lines=_chronological(lines), bank=bank, notes=notes)


def parse(raw: bytes, filename: str | None = None) -> Parsed:
    if not raw:
        raise StatementError("Empty file")
    head = raw[:8]
    if head.startswith(b"%PDF"):
        return _parse_pdf(raw)
    if head.startswith(b"PK"):
        rows = _rows_xlsx(raw)
    elif head.startswith(b"\xd0\xcf\x11\xe0"):
        rows = _rows_xls(raw)
    elif b"<table" in raw[:20000].lower() or b"<html" in raw[:2000].lower():
        rows = _rows_html(raw)
    else:
        rows = _rows_csv(raw)
    return parse_rows(rows, filename)


# ── storing ───────────────────────────────────────────────────────────────────

def _fingerprint(l: Line, n: int) -> str:
    key = f"{l.date}|{l.amount:.2f}|{_fold(l.description)}|{n}"
    return hashlib.sha1(key.encode()).hexdigest()[:20]


def store(conn: sqlite3.Connection, account: str, parsed: Parsed, filename: str | None) -> dict:
    lines = parsed.lines
    cur = conn.execute(
        "INSERT INTO statement_imports (account, filename, bank, period_start, period_end, lines_total) VALUES (?,?,?,?,?,?)",
        (account, filename, parsed.bank, lines[0].date, lines[-1].date, len(lines)),
    )
    import_id = cur.lastrowid
    seen: dict[tuple, int] = {}
    new = 0
    for seq, l in enumerate(lines):
        k = (l.date, l.amount, _fold(l.description))
        seen[k] = seen.get(k, 0) + 1
        c = conn.execute(
            """INSERT OR IGNORE INTO statement_lines
                 (import_id, account, date, seq, description, amount, balance, currency, fingerprint, kind)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (import_id, account, l.date, seq, l.description, l.amount, l.balance, l.currency, _fingerprint(l, seen[k]),
             l.kind or kind_of(l.description)),
        )
        new += c.rowcount
        if not c.rowcount:                    # a re-export can carry a balance / kind the first one lacked
            conn.execute("UPDATE statement_lines SET balance = COALESCE(balance, ?), kind = COALESCE(?, kind) "
                         "WHERE account=? AND fingerprint=?", (l.balance, l.kind, account, _fingerprint(l, seen[k])))
    conn.execute("UPDATE statement_imports SET lines_new=? WHERE id=?", (new, import_id))
    conn.commit()
    return {"import_id": import_id, "account": account, "bank": parsed.bank, "period_start": lines[0].date,
            "period_end": lines[-1].date, "lines_total": len(lines), "lines_new": new,
            "skipped": parsed.skipped, "notes": parsed.notes}


# ── reconciling ───────────────────────────────────────────────────────────────

def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def _shift(s: str, days: int) -> str:
    return (_d(s) + timedelta(days=days)).isoformat()


def _near(a: float, b: float) -> bool:
    return (a < 0) == (b < 0) and abs(a - b) <= max(NEAR_ABS, NEAR_PCT * abs(a))


def balance_on(conn: sqlite3.Connection, account: str, day: str) -> float:
    """Daybook's balance for an account at the end of a day (every transaction, Account Setup included)."""
    r = conn.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account=? AND deleted_at IS NULL AND date<=?",
                     (account, day)).fetchone()
    return round(r[0], 2)


def coverage(conn: sqlite3.Connection, account: str) -> tuple[str, str] | None:
    r = conn.execute("SELECT MIN(date), MAX(date) FROM statement_lines WHERE account=?", (account,)).fetchone()
    return (r[0], r[1]) if r and r[0] else None


def _txn(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "date": r["date"], "name": r["name"], "amount": r["amount"],
            "category": r["category"], "subcategory": r["subcategory"]}


def reconcile(conn: sqlite3.Connection, account: str, start: str | None = None, end: str | None = None) -> dict:
    cov = coverage(conn, account)
    if not cov:
        return {"account": account, "has_statement": False}
    start, end = start or cov[0], end or cov[1]
    lines = [dict(r) for r in conn.execute(
        """SELECT l.*, i.imported_at FROM statement_lines l JOIN statement_imports i ON i.id = l.import_id
           WHERE l.account=? AND l.date BETWEEN ? AND ? ORDER BY l.date, l.import_id, l.seq""",
        (account, start, end))]
    txns = {r["id"]: r for r in conn.execute(
        """SELECT id, date, name, amount, category, subcategory FROM transactions
           WHERE account=? AND deleted_at IS NULL AND date BETWEEN ? AND ?
             AND COALESCE(transaction_type,'') != 'Account Setup'
             AND COALESCE(source_id,'') NOT LIKE 'bankcheck:%'""",
        (account, _shift(start, -DATE_WINDOW), _shift(end, DATE_WINDOW)))}
    # Links you made by hand may point anywhere (another month, another account) — honour them.
    manual_ids = [l["txn_id"] for l in lines if l["txn_id"]]
    if manual_ids:
        q = ",".join("?" * len(manual_ids))
        for r in conn.execute(f"SELECT id, date, name, amount, category, subcategory FROM transactions "
                              f"WHERE id IN ({q}) AND deleted_at IS NULL", manual_ids):
            txns[r["id"]] = r

    taken: set[str] = set()
    match: dict[int, tuple[str, str]] = {}               # line id → (txn id, how)
    for l in lines:
        if l["txn_id"] and l["txn_id"] in txns and l["txn_id"] not in taken:
            match[l["id"]] = (l["txn_id"], "manual")
            taken.add(l["txn_id"])

    open_lines = [l for l in lines if l["id"] not in match and not l["ignored"]]

    def pass_(window: int, fits, how: str):
        cands = []
        for l in open_lines:
            if l["id"] in match:
                continue
            for t in txns.values():
                if t["id"] in taken:
                    continue
                gap = abs((_d(t["date"]) - _d(l["date"])).days)
                if gap > window or not fits(l, t):
                    continue
                sim = name_similarity(l["description"], t["name"])
                cands.append((gap - sim * 1.5 + abs(l["amount"] - t["amount"]) / 10, l["id"], t["id"]))
        for _, lid, tid in sorted(cands):                 # best pairs first, each side used once
            if lid in match or tid in taken:
                continue
            match[lid] = (tid, how)
            taken.add(tid)

    pass_(DATE_WINDOW, lambda l, t: abs(l["amount"] - t["amount"]) < 0.005, "exact")
    pass_(NEAR_WINDOW, lambda l, t: _near(l["amount"], t["amount"])
          and name_similarity(l["description"], t["name"]) >= NEAR_NAME, "near")

    matched, differs, missing, ignored = [], [], [], []
    for l in lines:
        row = {"id": l["id"], "date": l["date"], "description": l["description"], "amount": l["amount"],
               "balance": l["balance"], "currency": l["currency"], "kind": l["kind"]}
        if l["id"] in match:
            tid, how = match[l["id"]]
            t = _txn(txns[tid])
            row.update(txn=t, how=how, days_off=(_d(t["date"]) - _d(l["date"])).days)
            (differs if abs(t["amount"] - l["amount"]) >= 0.005 else matched).append(row)
        elif l["ignored"]:
            ignored.append(row)
        else:
            row["suggest"] = suggest(conn, l["description"], l["amount"], l["kind"])
            row["elsewhere"] = elsewhere(conn, account, l)
            row["candidates"] = [_txn(t) for t in sorted(
                (t for t in txns.values() if t["id"] not in taken and (t["amount"] < 0) == (l["amount"] < 0)
                 and abs((_d(t["date"]) - _d(l["date"])).days) <= 7),
                key=lambda t: (abs(t["amount"] - l["amount"]), abs((_d(t["date"]) - _d(l["date"])).days)))[:4]]
            missing.append(row)
    only_daybook = [_txn(t) for t in sorted(txns.values(), key=lambda t: t["date"])
                    if t["id"] not in taken and start <= t["date"] <= end]
    # A settled period is closed: its leftovers are in the 🚨 adjustment, so they're set aside.
    through = settled_through(conn, account)
    settled = {"through": through, "missing": [], "only_daybook": []}
    if through:
        settled["missing"] = [r for r in missing if r["date"] <= through]
        settled["only_daybook"] = [t for t in only_daybook if t["date"] <= through]
        missing = [r for r in missing if r["date"] > through]
        only_daybook = [t for t in only_daybook if t["date"] > through]

    # Balances: what the bank printed vs what Daybook adds up to, at both ends of the period.
    with_bal = [l for l in lines if l["balance"] is not None]
    bal = None
    if with_bal:
        first, last = with_bal[0], with_bal[-1]
        bank_open = round(first["balance"] - first["amount"], 2)
        open_day = _shift(first["date"], -1)
        db_open, db_close = balance_on(conn, account, open_day), balance_on(conn, account, last["date"])
        bal = {
            "opening_date": open_day, "bank_opening": bank_open, "daybook_opening": db_open,
            "opening_gap": round(db_open - bank_open, 2),
            "closing_date": last["date"], "bank_closing": round(last["balance"], 2), "daybook_closing": db_close,
            "closing_gap": round(db_close - last["balance"], 2),
            "chain_breaks": _chain_errors([Line(l["date"], "", l["amount"], l["balance"]) for l in with_bal]),
        }

    s = lambda rows, k="amount": round(sum(r[k] for r in rows), 2)
    return {
        "account": account, "has_statement": True, "start": start, "end": end, "coverage": list(cov),
        "counts": {"lines": len(lines), "matched": len(matched), "differs": len(differs), "missing": len(missing),
                   "only_daybook": len(only_daybook), "ignored": len(ignored)},
        "totals": {"missing": s(missing), "only_daybook": s(only_daybook),
                   "differs": round(sum(r["amount"] - r["txn"]["amount"] for r in differs), 2),
                   "bank_out": round(sum(l["amount"] for l in lines if l["amount"] < 0), 2),
                   "bank_in": round(sum(l["amount"] for l in lines if l["amount"] > 0), 2)},
        "balance": bal,
        "mirror_account": investment_account_for(conn, account),
        "settled": settled,
        "adjustments": [dict(r) for r in conn.execute(
            "SELECT id, date, name, amount FROM transactions WHERE source_id LIKE ? AND deleted_at IS NULL ORDER BY date",
            (f"bankcheck:{account}:%",))],
        "missing": missing, "differs": differs, "only_daybook": only_daybook, "matched": matched, "ignored": ignored,
    }


KIND_FILING = {                     # kind → (category, subcategory) when Daybook has nothing like it yet
    "investment": ("Transfer", None),
    "interest": ("Income", "Interest"),
    "dividend": ("Income", "Dividends"),
    "cashback": ("Income", "Cashback"),
    "fee": ("Finance", "Fees"),
    "tax": ("Finance", "Taxes"),
}
ALERT = "Alert"


def suggest(conn: sqlite3.Connection, description: str, amount: float, kind: str | None = None) -> dict:
    """A name and category for 'Add to Daybook': the past entry whose name looks most like the bank's text."""
    key = name_key(description)
    best, best_sim = None, 0.0
    if key:
        words = sorted(key.split(), key=len, reverse=True)[:2]
        q = " OR ".join("LOWER(name) LIKE ?" for _ in words)
        rows = conn.execute(
            f"""SELECT name, category, subcategory, COUNT(*) n FROM transactions
                WHERE deleted_at IS NULL AND ({q}) GROUP BY name, category, subcategory ORDER BY n DESC LIMIT 40""",
            [f"%{w}%" for w in words]).fetchall()
        for r in rows:
            sim = name_similarity(description, r["name"])
            if sim > best_sim:
                best, best_sim = r, sim
    if best and best_sim >= 0.5:
        return {"name": best["name"], "category": best["category"], "subcategory": best["subcategory"]}
    words = [w for w in re.findall(r"[A-Za-zÀ-ÿ]+", description) if _fold(w) not in _NOISE and len(w) > 2]
    pretty = " ".join(words[:3]).title() or description[:40]
    if kind in KIND_FILING:
        cat, sub = KIND_FILING[kind]
        return {"name": pretty, "category": cat, "subcategory": sub}
    return {"name": pretty, "category": None if amount < 0 else "Income", "subcategory": None}


def status(conn: sqlite3.Connection) -> list[dict]:
    """Per account with a statement: how far it reaches and whether the balances still agree."""
    out = []
    for (account,) in conn.execute("SELECT DISTINCT account FROM statement_lines ORDER BY account").fetchall():
        r = reconcile(conn, account)
        out.append({"account": account, "coverage": r["coverage"], "missing": r["counts"]["missing"],
                    "only_daybook": r["counts"]["only_daybook"], "differs": r["counts"]["differs"],
                    "closing_gap": r["balance"]["closing_gap"] if r["balance"] else None,
                    "last_import": conn.execute("SELECT MAX(imported_at) FROM statement_imports WHERE account=?",
                                                (account,)).fetchone()[0]})
    return out


# ── closing the gap ───────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def elsewhere(conn: sqlite3.Connection, account: str, line: dict) -> list[dict]:
    """Entries logged on another account that look like this bank line: same amount within
    DATE_WINDOW days, not paired with any statement line, and not on that account's own statement."""
    rows = conn.execute(
        """SELECT t.id, t.date, t.name, t.amount, t.category, t.subcategory, t.account FROM transactions t
           WHERE t.account IS NOT NULL AND t.account != ? AND t.deleted_at IS NULL
             AND COALESCE(t.transaction_type,'') != 'Account Setup'
             AND ABS(t.amount - ?) < 0.005 AND t.date BETWEEN ? AND ?
             AND NOT EXISTS (SELECT 1 FROM statement_lines s WHERE s.txn_id = t.id)
             AND NOT EXISTS (SELECT 1 FROM statement_lines s WHERE s.account = t.account
                             AND ABS(s.amount - t.amount) < 0.005
                             AND s.date BETWEEN date(t.date, ?) AND date(t.date, ?))
           ORDER BY ABS(julianday(t.date) - julianday(?)) LIMIT 2""",
        (account, line["amount"], _shift(line["date"], -DATE_WINDOW), _shift(line["date"], DATE_WINDOW),
         f"-{DATE_WINDOW} day", f"+{DATE_WINDOW} day", line["date"])).fetchall()
    return [_txn(r) | {"account": r["account"]} for r in rows]


def move_here(conn: sqlite3.Connection, line_id: int, txn_id: str) -> None:
    """The bank line is that entry, logged on the wrong account: move it to the statement's account and pair them."""
    l = conn.execute("SELECT account FROM statement_lines WHERE id=?", (line_id,)).fetchone()
    conn.execute("UPDATE transactions SET account=?, source='local', updated_at=? WHERE id=?", (l["account"], _now(), txn_id))
    conn.execute("UPDATE statement_lines SET txn_id=NULL WHERE txn_id=?", (txn_id,))
    conn.execute("UPDATE statement_lines SET txn_id=?, ignored=0 WHERE id=?", (txn_id, line_id))
    conn.commit()


def investment_account_for(conn: sqlite3.Connection, account: str) -> str | None:
    """The investment account a cash account's buys go to: same first word ("Trade Republic Cash" →
    "Trade Republic Wealth"), else none."""
    from domains.money.money_config import INVESTMENT_ACCOUNTS, INVESTMENT_TYPES
    names = set(INVESTMENT_ACCOUNTS)
    try:
        names |= {r[0] for r in conn.execute("SELECT name FROM accounts WHERE account_type IN (%s)" %
                                             ",".join("?" * len(INVESTMENT_TYPES)), tuple(INVESTMENT_TYPES))}
    except sqlite3.OperationalError:
        pass
    head = _fold(account).split()[:2]
    best = [n for n in sorted(names) if n != account and _fold(n).split()[:len(head)] == head]
    if not best and head:
        best = [n for n in sorted(names) if n != account and _fold(n).split()[:1] == head[:1]]
    return best[0] if best else None


def add_line(conn: sqlite3.Connection, line_id: int, name: str, category: str, subcategory: str | None = None,
             notes: str | None = None, vehicle_id: int | None = None, mirror_account: str | None = None) -> str:
    """Create the Daybook entry from a bank line (and, for a buy / sell, its mirror on the investment account)."""
    from domains.money.money_config import classify
    l = conn.execute("SELECT * FROM statement_lines WHERE id=?", (line_id,)).fetchone()
    txn_id = "local-" + str(uuid.uuid4())
    conn.execute(
        """INSERT INTO transactions (id, source, date, name, amount, account, category, subcategory,
                                     transaction_type, notes, vehicle_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (txn_id, "local", l["date"], (name or "").strip() or l["description"][:60], l["amount"], l["account"],
         category, (subcategory or "").strip() or None, classify(category), notes or None, vehicle_id))
    if mirror_account and classify(category) == "Transfer":
        conn.execute(
            """INSERT INTO transactions (id, source, date, name, amount, account, category, transaction_type, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            ("local-" + str(uuid.uuid4()), "local", l["date"], (name or "").strip() or l["description"][:60],
             -l["amount"], mirror_account, "Transfer", "Transfer", f"Mirror of {l['account']} (bank statement)"))
    conn.execute("UPDATE statement_lines SET txn_id=?, ignored=0 WHERE id=?", (txn_id, line_id))
    conn.commit()
    return txn_id


def add_all(conn: sqlite3.Connection, account: str, start: str | None = None, end: str | None = None) -> dict:
    """Every line only in the bank → Daybook. Investments, interest, dividends, cashback, fees and tax by
    their kind; the rest as 🚨 Alert (named like a past entry when there is one). Lines that look logged
    on another account are left for you to move."""
    rep = reconcile(conn, account, start, end)
    added = {"alert": 0, "filed": 0, "left": 0}
    mirror = rep.get("mirror_account")
    for l in rep.get("missing") or []:
        if l.get("elsewhere"):
            added["left"] += 1
            continue
        sug = l["suggest"]
        if l.get("kind") in KIND_FILING:
            cat, sub = KIND_FILING[l["kind"]]
            if sug.get("category") and sug["category"] != ALERT and _fold(sug["category"]) != "transfer" \
                    and l["kind"] != "investment":
                cat, sub = sug["category"], sug.get("subcategory")
            add_line(conn, l["id"], sug["name"], cat, sub, f"From the bank statement: {l['description']}",
                     mirror_account=mirror if l["kind"] == "investment" else None)
            added["filed"] += 1
        else:
            guess = f" (looks like {sug['category']})" if sug.get("category") else ""
            add_line(conn, l["id"], sug["name"], ALERT, None,
                     f"🚨 Only in the bank statement — check what it was{guess}: {l['description']}")
            added["alert"] += 1
    return added


def settled_through(conn: sqlite3.Connection, account: str) -> str | None:
    r = conn.execute("SELECT MAX(through) FROM statement_settlements WHERE account=?", (account,)).fetchone()
    return r[0] if r else None


def settle(conn: sqlite3.Connection, account: str, start: str | None = None, end: str | None = None) -> list[dict]:
    """Close the period: book what's still off as 🚨 Alert — an expense when Daybook had too much, an
    income when too little — the gap already there before the statement starts, then the rest at its
    end. Settling the same period again recomputes its adjustments (other months' stay)."""
    cov = coverage(conn, account)
    if not cov:
        raise StatementError("No statement for this account yet")
    start, end = start or cov[0], end or cov[1]
    conn.execute("DELETE FROM transactions WHERE source_id LIKE ? AND date BETWEEN ? AND ?",
                 (f"bankcheck:{account}:%", _shift(start, -1), end))            # ours, recomputed
    conn.execute("DELETE FROM statement_settlements WHERE account=? AND through BETWEEN ? AND ?", (account, start, end))
    conn.commit()
    rep = reconcile(conn, account, start, end)
    b = rep.get("balance")
    out = []

    def book(day: str, amount: float, name: str, note: str, tag: str):
        if abs(amount) < 0.005:
            return
        tid = "local-" + str(uuid.uuid4())
        conn.execute(
            """INSERT INTO transactions (id, source, date, name, amount, account, category, transaction_type, notes, source_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (tid, "local", day, name, round(amount, 2), account, ALERT, "Expense" if amount < 0 else "Income", note,
             f"bankcheck:{account}:{tag}:{day}"))
        out.append({"id": tid, "date": day, "name": name, "amount": round(amount, 2)})

    if b:
        book(b["opening_date"], -b["opening_gap"], "🚨 Bank check · off before this statement",
             f"Daybook was {b['opening_gap']:+.2f} off the bank on {b['opening_date']}, before the statement starts.", "open")
        book(b["closing_date"], -(b["closing_gap"] - b["opening_gap"]), "🚨 Bank check · unexplained difference",
             f"What {start} → {b['closing_date']} still disagreed on after the lines were sorted. Fix the real entries "
             "and press Settle again to recompute it.", "close")
    conn.execute("INSERT INTO statement_settlements (account, start, through) VALUES (?,?,?)",
                 (account, start, b["closing_date"] if b else end))
    conn.commit()
    return out


def unsettle(conn: sqlite3.Connection, account: str) -> None:
    """Reopen the last settled period: its adjustments go, its lines show again."""
    r = conn.execute("SELECT id, start, through FROM statement_settlements WHERE account=? ORDER BY through DESC, id DESC LIMIT 1",
                     (account,)).fetchone()
    if not r:
        return
    conn.execute("DELETE FROM transactions WHERE source_id LIKE ? AND date BETWEEN ? AND ?",
                 (f"bankcheck:{account}:%", _shift(r["start"], -1), r["through"]))
    conn.execute("DELETE FROM statement_settlements WHERE id=?", (r["id"],))
    conn.commit()
