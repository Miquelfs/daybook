"""
Bank statements, as a check on what you typed by hand.

Expenses are still entered one by one in Daybook — that habit is the point. A statement
exported from the bank is only read to find where the two disagree:

  parse(raw, filename)        CSV / XLSX / XLS from any bank (BBVA, Sabadell, Revolut, Trade
                              Republic…): the header row is found by its column names (Spanish or
                              English), amounts in either "1.234,56" or "1,234.56", one signed amount
                              column or separate debit / credit ones. A PDF is read by Claude.
  store(conn, account, …)     keeps the lines per account; a line already stored (same day, amount,
                              text and position among identical ones) is skipped, so overlapping
                              exports never double up.
  reconcile(conn, account…)   matches each bank line to one Daybook transaction — same amount within
                              a few days (card payments post a day or two late), then a near amount on
                              a similar name (a tip, a currency fee) — and reports what's only in the
                              bank, only in Daybook, the amounts that differ, and the balance gap.

Matching is recomputed on every read, so fixing an entry by hand is reflected at once. Only the
links you make yourself (or "Add to Daybook") and the lines you ignore are stored.
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


@dataclass
class Parsed:
    lines: list[Line]
    bank: str | None = None
    skipped: int = 0                      # rows that weren't completed movements (pending, reverted…)
    notes: list[str] = field(default_factory=list)


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
    return max(overlap, SequenceMatcher(None, ka, kb).ratio())


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
        for key in ("amount", "debit", "credit", "balance", "fee", "state", "currency"):
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
        out.append(Line(date=d, description=desc[:300], amount=round(amt, 2), balance=bal, currency=cur))
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
                },
                "required": ["date", "description", "amount", "balance"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["bank", "lines"],
    "additionalProperties": False,
}


def _parse_pdf(raw: bytes) -> Parsed:
    import fitz  # pymupdf
    doc = fitz.open(stream=raw, filetype="pdf")
    text = "\n".join(p.get_text() for p in doc)
    if len(text.strip()) < 40:
        raise StatementError("That PDF has no text in it (a scan?) — export a CSV or Excel instead")
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=STATEMENT_MODEL,
        max_tokens=16000,
        output_config={"format": {"type": "json_schema", "schema": _PDF_SCHEMA}},
        messages=[{"role": "user", "content": (
            "This is the text of a bank account statement (probably Spanish). List every movement, oldest first, "
            "exactly as printed: date as YYYY-MM-DD (the operation date when two are given), the description, the "
            "amount signed (negative = money out of the account), and the balance after it if the statement prints "
            "one (else null). Skip headers, totals and the opening/closing balance rows.\n\n" + text[:150_000])}],
    )
    data = json.loads(next(b.text for b in msg.content if b.type == "text"))
    lines = [Line(date=d, description=str(l["description"])[:300], amount=round(float(l["amount"]), 2),
                  balance=l.get("balance"))
             for l in data["lines"] if (d := parse_date(l["date"]))]
    if not lines:
        raise StatementError("Couldn't find any movements in that PDF")
    return Parsed(lines=_chronological(lines), bank=data.get("bank"), notes=["Read from a PDF by Claude — check the totals"])


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
                 (import_id, account, date, seq, description, amount, balance, currency, fingerprint)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (import_id, account, l.date, seq, l.description, l.amount, l.balance, l.currency, _fingerprint(l, seen[k])),
        )
        new += c.rowcount
        if not c.rowcount and l.balance is not None:      # a re-export can carry a balance the first one lacked
            conn.execute("UPDATE statement_lines SET balance = COALESCE(balance, ?) WHERE account=? AND fingerprint=?",
                         (l.balance, account, _fingerprint(l, seen[k])))
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
             AND COALESCE(transaction_type,'') != 'Account Setup'""",
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
               "balance": l["balance"], "currency": l["currency"]}
        if l["id"] in match:
            tid, how = match[l["id"]]
            t = _txn(txns[tid])
            row.update(txn=t, how=how, days_off=(_d(t["date"]) - _d(l["date"])).days)
            (differs if abs(t["amount"] - l["amount"]) >= 0.005 else matched).append(row)
        elif l["ignored"]:
            ignored.append(row)
        else:
            row["suggest"] = suggest(conn, l["description"], l["amount"])
            row["candidates"] = [_txn(t) for t in sorted(
                (t for t in txns.values() if t["id"] not in taken and (t["amount"] < 0) == (l["amount"] < 0)
                 and abs((_d(t["date"]) - _d(l["date"])).days) <= 7),
                key=lambda t: (abs(t["amount"] - l["amount"]), abs((_d(t["date"]) - _d(l["date"])).days)))[:4]]
            missing.append(row)
    only_daybook = [_txn(t) for t in sorted(txns.values(), key=lambda t: t["date"])
                    if t["id"] not in taken and start <= t["date"] <= end]

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
        "missing": missing, "differs": differs, "only_daybook": only_daybook, "matched": matched, "ignored": ignored,
    }


def suggest(conn: sqlite3.Connection, description: str, amount: float) -> dict:
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
