"""
Roster PDF importer — Norwegian/NetLine duty plan format.

Parses both the summary calendar and the detailed duty blocks, extracting:
  - Per-day: duty_type, report_time, end_time  (→ roster table)
  - Per-leg: flight_number, route, times, aircraft  (→ roster_legs table)
  - Crew per leg: cockpit + cabin names  (→ roster_legs.cockpit_crew / cabin_crew JSON)

Duty type mapping from NetLine codes:
  FlD / FLD       → flying_duty
  Sby / SBM / SBS → standby
  Off / DO (+)    → day_off
  Dty / CBT / GRD → ground_duty   (training, admin, simulator)

Run standalone:
    python -m domains.aviation.roster_importer path/to/duty-plan.pdf [--db PATH]
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

DB_PATH = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"

# Month abbreviation → number (NetLine uses English month names)
_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}

# ── Duty type normalisation ────────────────────────────────────────────────────

_FLYING  = {"fld", "flightduty", "flight duty"}
_STANDBY = {"sby", "sbm", "sbs", "standby"}
_OFF     = {"off", "do"}
_GROUND  = {"dty", "cbt", "grd", "sim", "trg"}


def _normalise_duty(raw: str) -> str:
    key = raw.strip().lower()
    if key in _FLYING:   return "flying_duty"
    if key in _STANDBY:  return "standby"
    if key in _OFF:       return "day_off"
    if key in _GROUND:   return "ground_duty"
    return "unknown"


def _parse_time(raw: str) -> str | None:
    """Convert HHMM or HH:MM to HH:MM, return None if not a time."""
    s = raw.strip().replace(":", "")
    if re.fullmatch(r"\d{4}", s):
        return f"{s[:2]}:{s[2:]}"
    return None


# ── Data classes ───────────────────────────────────────────────────────────────

@dataclass
class RosterDay:
    date: str               # YYYY-MM-DD
    duty_type: str          # flying_duty | standby | day_off | ground_duty | unknown
    report_time: str | None # HH:MM local
    end_time: str | None    # HH:MM local
    raw_code: str           # original code from PDF (e.g. FlD, Sby, Off)


@dataclass
class RosterLeg:
    date: str
    flight_number: str      # e.g. "D8 5604"
    dep_iata: str
    arr_iata: str
    dep_time: str | None    # HH:MM local
    arr_time: str | None    # HH:MM local (! prefix stripped)
    aircraft_type: str | None
    cockpit_crew: list[str] = field(default_factory=list)  # full names
    cabin_crew: list[str]   = field(default_factory=list)
    leg_order: int = 1


# ── PDF parsing ────────────────────────────────────────────────────────────────

def parse_pdf(pdf_path: str | Path) -> tuple[str, list[RosterDay], list[RosterLeg]]:
    """
    Returns (period_label, [RosterDay], [RosterLeg]).
    period_label e.g. "2026-06"
    """
    import fitz  # pymupdf

    doc = fitz.open(str(pdf_path))

    # Concatenate all pages for detail + crew parsing; dedup ensures no double-counting.
    all_text = "\n".join(page.get_text() for page in doc)
    page0_text = doc[0].get_text()

    # ── 1. Period ──────────────────────────────────────────────────────────────
    period_match = re.search(
        r"Period:\s*(\d{2})(\w{3})(\d{2})\s*-\s*\d{2}\w{3}\d{2}", page0_text
    )
    if not period_match:
        raise ValueError("Could not find Period header in PDF")

    month_str = period_match.group(2)
    year_2    = period_match.group(3)
    month_num = _MONTHS[month_str]
    year      = 2000 + int(year_2)
    period_label = f"{year}-{month_num:02d}"

    # ── 2. Summary calendar (page 0 only, may repeat on later pages) ──────────
    line_re = re.compile(
        r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d{2})\s+"
        r"(FlD|Sby|SBM|SBS|Off|Dty|CBT|GRD|Sim|DO|FLD)\s*"
        r"(\d{4})?\s*(\d{4})?",
        re.IGNORECASE,
    )

    seen_days: dict[int, RosterDay] = {}

    for m in line_re.finditer(page0_text):
        d_num = int(m.group(1))
        if d_num in seen_days:
            continue
        raw_code = m.group(2)
        t_rep = _parse_time(m.group(3)) if m.group(3) else None
        t_end = _parse_time(m.group(4)) if m.group(4) else None
        try:
            full_date = date(year, month_num, d_num)
        except ValueError:
            continue
        seen_days[d_num] = RosterDay(
            date=full_date.isoformat(),
            duty_type=_normalise_duty(raw_code),
            report_time=t_rep,
            end_time=t_end,
            raw_code=raw_code,
        )

    if not seen_days:
        raise ValueError("No roster days found in PDF — check format")

    days = sorted(seen_days.values(), key=lambda r: r.date)

    # ── 3. Detail blocks — extract legs ───────────────────────────────────────
    # The detail block looks like (tokens separated by newlines in PDF text):
    #
    #   Thu25
    #   C/I  PMI  0615       ← check-in at base airport
    #   D8                   ← airline code (may be on its own line)
    #   5604                 ← flight number
    #   PMI  0715  !1025     ← dep_iata dep_time [!]arr_time
    #   GOT  S738            ← arr_iata  aircraft_type
    #   D8
    #   5605
    #   GOT  1110  !1415
    #   PMI  S738
    #   C/O  1435  PMI       ← sign-off
    #
    # We use a line-by-line state machine on the full concatenated text.

    legs: dict[tuple[str, str], RosterLeg] = {}  # (date, flight_number) → RosterLeg

    # Build a quick day-num → full date map
    day_date: dict[int, str] = {d_num: rd.date for d_num, rd in seen_days.items()}

    # Tokenise: split on newlines, strip whitespace, drop empty
    tokens = [t.strip() for t in all_text.splitlines() if t.strip()]

    # Weekday+day token: Mon01 … Sun31
    _WEEKDAY_DAY = re.compile(r"^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d{2})$", re.IGNORECASE)
    # Flight number digit part (4-5 digits)
    _FN_DIGITS = re.compile(r"^\d{4,5}$")
    # IATA airport code: 3 uppercase letters (allow mix with digits for rare codes)
    _IATA = re.compile(r"^[A-Z]{3}$")
    # Time: 4-digit HHMM or !HHMM
    _TIME = re.compile(r"^!?(\d{4})$")
    # Aircraft type: letters+digits mix, 3-6 chars, starts with letter
    _ACTYPE = re.compile(r"^[A-Z]\d{3}[A-Z0-9]{0,3}$")
    # Airline two-letter code (e.g. D8, DY, SK)
    _AIRLINE = re.compile(r"^[A-Z][A-Z0-9]$")

    i = 0
    current_date: str | None = None
    leg_order_counter: dict[str, int] = {}

    while i < len(tokens):
        tok = tokens[i]

        # Track current date from weekday+day tokens
        wd_m = _WEEKDAY_DAY.match(tok)
        if wd_m:
            d_num = int(wd_m.group(1))
            current_date = day_date.get(d_num)
            i += 1
            continue

        # Detect C/I (check-in) — next token is often the base airport, skip
        if tok == "C/I":
            i += 1
            continue

        # Detect C/O (check-out) — end of duty
        if tok == "C/O":
            i += 1
            continue

        # Detect airline code followed by flight number digits
        if _AIRLINE.match(tok) and current_date and i + 1 < len(tokens):
            next_tok = tokens[i + 1]
            if _FN_DIGITS.match(next_tok):
                airline = tok
                fn_digits = next_tok
                flight_number = f"{airline} {fn_digits}"
                i += 2

                # Now expect: DEP  dep_time  [!]arr_time  ARR  actype
                # Collect next 3-5 tokens carefully
                dep_iata = arr_iata = dep_time = arr_time = actype = None

                if i < len(tokens) and _IATA.match(tokens[i]):
                    dep_iata = tokens[i]; i += 1
                if i < len(tokens) and _TIME.match(tokens[i]):
                    dep_time = _parse_time(tokens[i].lstrip("!")); i += 1
                if i < len(tokens) and _TIME.match(tokens[i]):
                    arr_time = _parse_time(tokens[i].lstrip("!")); i += 1
                if i < len(tokens) and _IATA.match(tokens[i]):
                    arr_iata = tokens[i]; i += 1
                if i < len(tokens) and _ACTYPE.match(tokens[i]):
                    actype = tokens[i]; i += 1

                if dep_iata and arr_iata:
                    key = (current_date, flight_number)
                    if key not in legs:
                        order = leg_order_counter.get(current_date, 0) + 1
                        leg_order_counter[current_date] = order
                        legs[key] = RosterLeg(
                            date=current_date,
                            flight_number=flight_number,
                            dep_iata=dep_iata or "",
                            arr_iata=arr_iata or "",
                            dep_time=dep_time,
                            arr_time=arr_time,
                            aircraft_type=actype,
                            leg_order=order,
                        )
                continue

        i += 1

    # ── 4. Crew section — attach to legs ──────────────────────────────────────
    # The crew section starts with "Crew Information on Leg" and has blocks:
    #
    #   {WeekdayDay}
    #   D8
    #   {digits}
    #   {dep_iata}  {dep_time}  [!]{arr_time}  {arr_iata}
    #   cockpit:  {id}, {Name}
    #             {id}, {Name}
    #   cabin:    {id}, {Name}
    #             ...
    #
    # We parse by finding the header, then rescan tokens from that point.

    crew_header_idx: int | None = None
    for idx, tok in enumerate(tokens):
        if "Crew Information on Leg" in tok or tok == "Crew Information on Leg":
            crew_header_idx = idx
            break
        # The header may be split across tokens
        if idx + 2 < len(tokens):
            combo = " ".join(tokens[idx:idx+4])
            if "Crew Information on Leg" in combo:
                crew_header_idx = idx
                break

    if crew_header_idx is not None:
        j = crew_header_idx
        # Skip past any remaining header tokens
        while j < len(tokens) and ("Crew" in tokens[j] or "Information" in tokens[j] or "Leg" in tokens[j] or "on" in tokens[j]):
            j += 1

        # Second pass: find crew blocks
        # State: current_crew_date, current_flight_number, in_cockpit, in_cabin
        crew_date: str | None = None
        crew_fn: str | None = None
        in_cockpit = False
        in_cabin = False

        # Name pattern: "12345, Surname, Firstname" or "12345, Surname Firstname"
        # The ID is numeric; names follow after comma
        _CREW_LINE = re.compile(r"^(\d{4,6}),\s*(.+)$")

        while j < len(tokens):
            tok = tokens[j]

            # New date block
            wd_m = _WEEKDAY_DAY.match(tok)
            if wd_m:
                d_num = int(wd_m.group(1))
                crew_date = day_date.get(d_num)
                crew_fn = None
                in_cockpit = in_cabin = False
                j += 1
                continue

            # Airline + flight number
            if _AIRLINE.match(tok) and j + 1 < len(tokens) and _FN_DIGITS.match(tokens[j + 1]):
                crew_fn = f"{tok} {tokens[j+1]}"
                in_cockpit = in_cabin = False
                j += 2
                # Skip route tokens (dep_iata, times, arr_iata) — up to 4 tokens
                skipped = 0
                while skipped < 5 and j < len(tokens):
                    t2 = tokens[j]
                    if _IATA.match(t2) or _TIME.match(t2) or t2.startswith("!"):
                        j += 1; skipped += 1
                    else:
                        break
                continue

            # cockpit: / cabin: markers — may have crew inline: "cockpit: 12345, Name"
            tok_lower = tok.lower()
            if tok_lower.startswith("cockpit"):
                in_cockpit = True; in_cabin = False
                # Inline crew: "cockpit: 12345, Name ..."
                inline = re.sub(r"^cockpit:\s*", "", tok, flags=re.IGNORECASE).strip()
                inline_m = _CREW_LINE.match(inline)
                if inline_m and crew_date and crew_fn:
                    key = (crew_date, crew_fn)
                    if key in legs:
                        legs[key].cockpit_crew.append(inline_m.group(2).strip())
                j += 1
                continue
            if tok_lower.startswith("cabin"):
                in_cockpit = False; in_cabin = True
                inline = re.sub(r"^cabin:\s*", "", tok, flags=re.IGNORECASE).strip()
                inline_m = _CREW_LINE.match(inline)
                if inline_m and crew_date and crew_fn:
                    key = (crew_date, crew_fn)
                    if key in legs:
                        legs[key].cabin_crew.append(inline_m.group(2).strip())
                j += 1
                continue

            # Crew name line: "{id}, {Name}"
            crew_m = _CREW_LINE.match(tok)
            if crew_m and crew_date and crew_fn and (in_cockpit or in_cabin):
                name = crew_m.group(2).strip()
                key = (crew_date, crew_fn)
                if key in legs:
                    if in_cockpit:
                        legs[key].cockpit_crew.append(name)
                    else:
                        legs[key].cabin_crew.append(name)
                j += 1
                continue

            j += 1

    leg_list = sorted(legs.values(), key=lambda l: (l.date, l.leg_order))
    return period_label, days, leg_list


# ── DB upsert ──────────────────────────────────────────────────────────────────

def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS roster (
            date        TEXT PRIMARY KEY,
            duty_type   TEXT NOT NULL,
            report_time TEXT,
            end_time    TEXT,
            raw_code    TEXT,
            imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS roster_legs (
            id            TEXT PRIMARY KEY,
            date          TEXT NOT NULL,
            flight_number TEXT NOT NULL,
            dep_iata      TEXT,
            arr_iata      TEXT,
            dep_time      TEXT,
            arr_time      TEXT,
            aircraft_type TEXT,
            cockpit_crew  TEXT,
            cabin_crew    TEXT,
            leg_order     INTEGER DEFAULT 1,
            imported_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    """)
    conn.commit()


def upsert_roster(
    days: list[RosterDay],
    legs: list[RosterLeg],
    db_path: Path = DB_PATH,
) -> int:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _ensure_tables(conn)

    count = 0
    for day in days:
        conn.execute(
            """
            INSERT INTO roster (date, duty_type, report_time, end_time, raw_code)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                duty_type   = excluded.duty_type,
                report_time = excluded.report_time,
                end_time    = excluded.end_time,
                raw_code    = excluded.raw_code,
                imported_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            """,
            (day.date, day.duty_type, day.report_time, day.end_time, day.raw_code),
        )
        count += 1

    for leg in legs:
        leg_id = f"{leg.date}_{leg.flight_number.replace(' ', '')}"
        conn.execute(
            """
            INSERT INTO roster_legs
                (id, date, flight_number, dep_iata, arr_iata, dep_time, arr_time,
                 aircraft_type, cockpit_crew, cabin_crew, leg_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                dep_iata      = excluded.dep_iata,
                arr_iata      = excluded.arr_iata,
                dep_time      = excluded.dep_time,
                arr_time      = excluded.arr_time,
                aircraft_type = excluded.aircraft_type,
                cockpit_crew  = excluded.cockpit_crew,
                cabin_crew    = excluded.cabin_crew,
                leg_order     = excluded.leg_order,
                imported_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            """,
            (
                leg_id,
                leg.date,
                leg.flight_number,
                leg.dep_iata,
                leg.arr_iata,
                leg.dep_time,
                leg.arr_time,
                leg.aircraft_type,
                json.dumps(leg.cockpit_crew),
                json.dumps(leg.cabin_crew),
                leg.leg_order,
            ),
        )

    conn.commit()
    conn.close()
    return count


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, sys

    parser = argparse.ArgumentParser(description="Import roster PDF into daybook DB")
    parser.add_argument("pdf", help="Path to duty-plan PDF")
    parser.add_argument("--db", default=str(DB_PATH), help="SQLite DB path")
    parser.add_argument("--dry-run", action="store_true", help="Print parsed data, don't write")
    args = parser.parse_args()

    try:
        period, days, legs = parse_pdf(args.pdf)
        print(f"Parsed {len(days)} days, {len(legs)} legs for {period}")
        for d in days:
            print(f"  {d.date}  {d.raw_code:<6}  {d.duty_type:<14}  {d.report_time or '':>5} → {d.end_time or '':>5}")
        print()
        for leg in legs:
            crew_str = f"  cockpit={leg.cockpit_crew}  cabin={len(leg.cabin_crew)} FA" if leg.cockpit_crew else ""
            print(f"  {leg.date}  {leg.flight_number}  {leg.dep_iata}→{leg.arr_iata}  {leg.dep_time or '?'}–{leg.arr_time or '?'}  {leg.aircraft_type or ''}{crew_str}")
        if not args.dry_run:
            n = upsert_roster(days, legs, Path(args.db))
            print(f"\n✓ Upserted {n} rows into {args.db}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
