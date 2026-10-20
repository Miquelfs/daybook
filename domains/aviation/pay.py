"""
Norwegian Spain (CLA II ESP) payslip model — FO / CPT.

A payslip for month P = fixed pay of P (prorated by P's jornada)
                      + variable pay earned in P−1 (hours, standby, sims, dietas…).

Calibrated against the real September 2026 payslip (FO level 4, 100%):
every devengo, the SS lines, the solidarity contribution, both IRPF lines and
the net (5.084,71 €) reproduce to the cent — see tests/test_pay.py.

Variable pay is reconciled day by day, planned (roster) vs actual (logbook):
  - standby with logged flights      → activated: not paid as SBY ("Guardia en base")
  - planned flying, nothing logged   → not flown (swap / cancellation)
  - flights on a planned day off     → extra duty — BDO candidate (paid only when confirmed)
  - location walk across days        → overnights away from base, sims abroad, and the
                                       positioning day home (dieta + "Posicionam. Vuelo")
  - future days of the month         → projected from the roster legs
Anything the data can't tell is set per day in roster_pay_overrides.
"""

from __future__ import annotations

import calendar
import sqlite3
from dataclasses import dataclass, field, asdict
from datetime import date as Date, timedelta

HOME_BASE_ICAO = "LEPA"
_SPAIN_ICAO_PREFIXES = ("LE", "GC", "GE")   # mainland + Balearics, Canaries, Ceuta/Melilla

# ── Rate tables (Appendix C, Table C.1) ───────────────────────────────────────
# 2025 table values. Later years apply the cumulative IPC factor to the
# IPC-linked items only — uniform, parking, licence insurance and dietas stayed
# flat on the 2026 slip.

_BASE_SALARY_2025 = {
    # monthly gross at 100 %, the two extra payments already prorated in
    ("CPT", 10): 11529.58, ("CPT", 9): 11195.75, ("CPT", 8): 10845.45,
    ("CPT", 7): 10530.78,  ("CPT", 6): 10225.28,  ("CPT", 5): 9928.67,
    ("CPT", 4): 9640.71,   ("CPT", 3): 9319.31,   ("CPT", 2): 9047.87,
    ("CPT", 1): 8784.34,
    ("FO",  10): 5631.08,  ("FO",  9): 5522.00,  ("FO",  8): 5388.88,
    ("FO",  7): 5284.04,   ("FO",  6): 5181.25,  ("FO",  5): 5080.48,
    ("FO",  4): 4981.68,   ("FO",  3): 3716.31,  ("FO",  2): 3642.44,
    ("FO",  1): 3570.65,
}

_IPC_ITEMS_2025 = {
    "FO": {
        "connectivity": 21.42,   # 4225 Plus conectividad
        "pension": 250.00,       # 41P0 Pensión Empresa (in kind)
        "blh": 9.91,             # 2210 Horas de vuelo (normal band)
        "blhs": 16.95,           # reduced-jornada band (from the guide — not yet seen on a slip)
        "blhp": 14.87,           # 2225 Horas de vuelo productividad (> 60 h)
        "sby": 39.66,            # 2206 Guardia en base
        "sim": 39.66,            # 5285 Plus por Simulador
        "positioning": 39.66,    # 5284 Posicionamiento vuelo
        "var_soc": 39.66,        # variable on SOC/VAC days
        "bdo": 510.00,           # bought day off
    },
    "CPT": {
        "connectivity": 42.84,
        "pension": 250.00,
        "blh": 21.05,
        "blhs": 36.00,           # = blh × 16.95/9.91 — CPT reduced band unverified
        "blhp": 31.58,
        "sby": 84.21,
        "sim": 84.21,
        "positioning": 84.21,
        "var_soc": 84.21,
        "bdo": 1021.00,
    },
}

_FLAT_ITEMS = {
    "uniform": 17.00,            # 4055 Plus uniformidad
    "parking": 28.00,            # 4224 Parking complement
    "licence_insurance": 63.25,  # 4083 Seguro pérdida licencia (in kind)
}

# Cumulative IPC factor vs the 2025 table (2026: +2.9 %). Unknown later years
# reuse the latest known factor until the new table lands.
_IPC_FACTOR = {2025: 1.0, 2026: 1.029}

PER_DIEM_TYPES = (
    "int_no_overnight", "int_int_overnight", "int_nat_overnight",
    "nat_no_overnight", "nat_nat_overnight",
)
PER_DIEM_RATE = {
    "int_no_overnight": 66.11,    # 8212 Despl. intl. sin pernocta
    "int_int_overnight": 91.35,   # 8214 Pernocta internacional
    "int_nat_overnight": 66.11,
    "nat_no_overnight": 50.00,
    "nat_nat_overnight": 60.00,
}
# IRPF/SS-exempt part of each dieta (RIRPF art. 9 — flight crew limits). The
# slip excludes the full 66.11 / 91.35 from both the SS and the IRPF base.
PER_DIEM_EXEMPT = {
    "int_no_overnight": 66.11,
    "int_int_overnight": 91.35,
    "int_nat_overnight": 53.34,
    "nat_no_overnight": 36.06,
    "nat_nat_overnight": 53.34,
}
PER_DIEM_LABEL = {
    "int_no_overnight": "Intl, no overnight",
    "int_int_overnight": "Intl overnight abroad",
    "int_nat_overnight": "Intl, overnight in Spain",
    "nat_no_overnight": "National, no overnight",
    "nat_nat_overnight": "National overnight",
}

# Social Security (worker share)
_SS_CAP = {2025: 4909.50, 2026: 5101.20}                # monthly base ceiling
_SS_COMMON = {2025: 0.0483, 2026: 0.0485}               # 4.70 % + MEI
SS_UNEMPLOYMENT = 0.0155
SS_TRAINING = 0.0010
# Solidarity contribution on pay above the ceiling, worker share per band:
# (cap, 110 %], (110 %, 150 %], > 150 %
_SS_SOLIDARITY = {2025: (0.0015, 0.0017, 0.0019), 2026: (0.0019, 0.0021, 0.0024)}

_STANDBY_CODES = {"sby", "sbm", "sbs", "standby"}
_SIM_CODES = {"sim"}
_VACATION_CODES = {"vac", "vc", "al", "hol", "soc", "lve", "lv", "ulv", "pl", "par", "mat", "ptv", "anl"}  # = roster_importer._VACATION
_NOT_WORKING = (None, "day_off", "vacation")
_WORK_TYPES = {"flying_duty", "standby", "ground_duty"}


def _by_year(table: dict, year: int):
    if year in table:
        return table[year]
    known = sorted(table)
    return table[known[-1]] if year > known[-1] else table[known[0]]


def rates(category: str, level: int, year: int) -> dict:
    """All unit rates for a category/level in a given year (100 % jornada)."""
    category = category if category in ("FO", "CPT") else "FO"
    f = _by_year(_IPC_FACTOR, year)
    r = {k: round(v * f, 2) for k, v in _IPC_ITEMS_2025[category].items()}
    r["base"] = round(_BASE_SALARY_2025.get((category, level), 0.0) * f, 2)
    r.update(_FLAT_ITEMS)
    return r


def blh_threshold(jornada_pct: int) -> float:
    """End of the normal BLH band: 60 h at 100 %, −5 h per 10 % reduction."""
    j = max(50, min(100, jornada_pct))
    return 60.0 - (100 - j) / 2.0


def is_spain(icao: str | None) -> bool:
    return bool(icao) and icao.upper().startswith(_SPAIN_ICAO_PREFIXES)


def prev_month(month: str) -> str:
    y, m = map(int, month.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def next_month(month: str) -> str:
    y, m = map(int, month.split("-"))
    return f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS roster_pay_overrides (
            date          TEXT PRIMARY KEY,
            standby_paid  INTEGER,   -- 1/0; NULL = auto (paid unless activated)
            per_diem      TEXT,      -- a PER_DIEM_TYPES value, 'none'; NULL = auto
            positioning   INTEGER,   -- count of paid positionings; NULL = auto
            bdo           REAL,      -- 1 = BDO, 0.5 = half day; NULL/0 = none
            note          TEXT,
            updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE TABLE IF NOT EXISTS pay_settings (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            category     TEXT    NOT NULL DEFAULT 'FO',
            level        INTEGER NOT NULL DEFAULT 4,
            irpf_pct     REAL    NOT NULL DEFAULT 25.55,
            jornada_pct  INTEGER NOT NULL DEFAULT 100
        );
        INSERT OR IGNORE INTO pay_settings (id) VALUES (1);
        CREATE TABLE IF NOT EXISTS pay_jornada (
            month        TEXT PRIMARY KEY,   -- YYYY-MM
            jornada_pct  INTEGER NOT NULL    -- 50–100; months without a row use pay_settings
        );
    """)
    conn.commit()


def get_settings(conn: sqlite3.Connection) -> dict:
    ensure_tables(conn)
    r = conn.execute("SELECT category, level, irpf_pct, jornada_pct FROM pay_settings WHERE id = 1").fetchone()
    return {"category": r[0], "level": r[1], "irpf_pct": r[2], "jornada_pct": r[3]}


def jornada_for(conn: sqlite3.Connection, month: str, default: int = 100) -> int:
    """Working percentage for a month — its own row, else the settings default."""
    ensure_tables(conn)
    r = conn.execute("SELECT jornada_pct FROM pay_jornada WHERE month = ?", (month,)).fetchone()
    return r[0] if r else default


def set_jornada(conn: sqlite3.Connection, month: str, pct: int | None) -> None:
    """Set a month's working percentage; None clears it back to the default."""
    ensure_tables(conn)
    if pct is None:
        conn.execute("DELETE FROM pay_jornada WHERE month = ?", (month,))
    else:
        conn.execute("""INSERT INTO pay_jornada (month, jornada_pct) VALUES (?, ?)
                        ON CONFLICT(month) DO UPDATE SET jornada_pct = excluded.jornada_pct""", (month, pct))
    conn.commit()


# ── Day reconciliation ────────────────────────────────────────────────────────

@dataclass
class DayLine:
    date: str
    planned: str | None              # roster duty_type
    planned_code: str | None         # roster raw_code (FlD, Sby, Sim…)
    status: str                      # see _status()
    projected: bool                  # future day: legs taken from the roster
    route: str                       # "LEPA → EKCH → LEPA"
    block_hours: float
    sectors: int
    activated: bool = False
    bdo_candidate: bool = False
    sim: bool = False
    vacation: bool = False
    sleeps_at: str | None = None     # ICAO where the night is spent when away
    # auto values
    auto_standby_paid: bool = False
    auto_per_diem: str | None = None
    auto_positioning: int = 0
    # overrides (None = auto)
    override: dict = field(default_factory=dict)
    # effective values used for pay
    standby_paid: bool = False
    per_diem: str | None = None
    positioning: int = 0
    bdo: float = 0.0
    note: str | None = None


def _iata_to_icao(conn: sqlite3.Connection) -> dict[str, str]:
    try:
        return {r[0].upper(): r[1].upper()
                for r in conn.execute("SELECT iata, icao FROM airports WHERE iata IS NOT NULL AND iata != ''")}
    except sqlite3.OperationalError:
        return {}


def _leg_hours(dep: str | None, arr: str | None) -> float:
    try:
        dh, dm = map(int, dep.split(":"))
        ah, am = map(int, arr.split(":"))
    except (AttributeError, ValueError):
        return 0.0
    mins = (ah * 60 + am) - (dh * 60 + dm)
    return (mins + 1440 if mins < 0 else mins) / 60.0


def _day_per_diem(airports: list[str], last_arr: str) -> str:
    international = any(not is_spain(a) for a in airports)
    if last_arr == HOME_BASE_ICAO:
        return "int_no_overnight" if international else "nat_no_overnight"
    if not is_spain(last_arr):
        return "int_int_overnight"
    return "int_nat_overnight" if international else "nat_nat_overnight"


def _status(planned: str | None, code: str, flew: bool, activated: bool, projected: bool) -> str:
    if activated:
        return "activated"                       # standby → called out
    if planned == "flying_duty" and not flew and not projected:
        return "not_flown"                       # swap / cancellation
    if flew and planned in _NOT_WORKING:
        return "extra_duty"                      # worked a day off — BDO?
    if flew and planned == "ground_duty" and code not in _SIM_CODES:
        return "changed"
    return "as_planned"


def reconcile_month(conn: sqlite3.Connection, month: str, today: str | None = None) -> list[DayLine]:
    """Planned (roster) vs actual (logbook) for every day of `month`."""
    ensure_tables(conn)
    today = today or Date.today().isoformat()
    y, m = map(int, month.split("-"))
    first = Date(y, m, 1)
    days = [first + timedelta(d) for d in range(calendar.monthrange(y, m)[1])]
    start, end = days[0].isoformat(), days[-1].isoformat()

    roster = {}
    try:
        for r in conn.execute("SELECT date, duty_type, raw_code FROM roster WHERE date BETWEEN ? AND ?", (start, end)):
            roster[r[0]] = (r[1], (r[2] or "").strip())
    except sqlite3.OperationalError:
        pass

    legs_planned: dict[str, list] = {}
    try:
        for r in conn.execute("""SELECT date, dep_iata, arr_iata, dep_time, arr_time FROM roster_legs
                                 WHERE date BETWEEN ? AND ? ORDER BY date, leg_order""", (start, end)):
            legs_planned.setdefault(r[0], []).append(r)
    except sqlite3.OperationalError:
        pass

    flights: dict[str, list] = {}
    sim_flight_days: set[str] = set()
    for r in conn.execute("""SELECT date, dep_icao, arr_icao, block_seconds, is_sim FROM flights
                             WHERE date BETWEEN ? AND ? ORDER BY date, off_block_utc""", (start, end)):
        if r[4]:
            sim_flight_days.add(r[0])
        elif r[1]:
            flights.setdefault(r[0], []).append(r)

    overrides = {r[0]: {"standby_paid": r[1], "per_diem": r[2], "positioning": r[3], "bdo": r[4], "note": r[5]}
                 for r in conn.execute("""SELECT date, standby_paid, per_diem, positioning, bdo, note
                                          FROM roster_pay_overrides WHERE date BETWEEN ? AND ?""", (start, end))}

    # Where did we sleep the night before the 1st? (last flight within a week)
    away = None
    prev = conn.execute("""SELECT arr_icao FROM flights WHERE is_sim = 0 AND date < ? AND date >= ?
                           ORDER BY date DESC, off_block_utc DESC LIMIT 1""",
                        (start, (first - timedelta(7)).isoformat())).fetchone()
    if prev and prev[0] and prev[0].upper() != HOME_BASE_ICAO:
        away = prev[0].upper()

    iata = None
    out: list[DayLine] = []
    for d in days:
        ds = d.isoformat()
        planned, code = roster.get(ds, (None, ""))
        code_l = code.lower()
        actual = flights.get(ds, [])
        projected = False
        hops: list[str] = []
        block = 0.0
        if actual:
            hops = [actual[0][1].upper()] + [(f[2] or "").upper() for f in actual]
            block = sum((f[3] or 0) for f in actual) / 3600.0
        elif ds >= today and planned == "flying_duty" and legs_planned.get(ds):
            projected = True
            if iata is None:
                iata = _iata_to_icao(conn)
            lp = legs_planned[ds]
            hops = [iata.get((lp[0][1] or "").upper(), (lp[0][1] or "").upper())] + \
                   [iata.get((l[2] or "").upper(), (l[2] or "").upper()) for l in lp]
            block = sum(_leg_hours(l[3], l[4]) for l in lp)
        flew = bool(hops)

        is_sby = planned == "standby" or code_l in _STANDBY_CODES
        activated = is_sby and flew and not projected
        line = DayLine(
            date=ds, planned=planned, planned_code=code or None,
            status=_status(planned, code_l, flew, activated, ds >= today),
            projected=projected, route=" → ".join(hops), block_hours=round(block, 4),
            sectors=max(0, len(hops) - 1),
            activated=activated,
            bdo_candidate=flew and planned in _NOT_WORKING,
            sim=code_l in _SIM_CODES or ds in sim_flight_days,
            vacation=(planned == "vacation" or code_l in _VACATION_CODES) and not flew,
        )
        line.auto_standby_paid = is_sby and not flew

        # Location walk → dieta / positioning
        if flew:
            last = hops[-1]
            line.auto_per_diem = _day_per_diem(hops, last)
            away = None if last == HOME_BASE_ICAO else last
        elif away:
            if planned in _WORK_TYPES:
                # duty while still away (sim abroad, layover standby…) → another night out
                line.auto_per_diem = "int_int_overnight" if not is_spain(away) else "int_nat_overnight"
            else:
                # first non-working day away → positioned home as passenger
                line.auto_per_diem = "int_no_overnight" if not is_spain(away) else "nat_no_overnight"
                line.auto_positioning = 1
                away = None
        if away and line.auto_per_diem:
            line.sleeps_at = away

        o = overrides.get(ds, {})
        line.override = {k: v for k, v in o.items() if v is not None}
        line.standby_paid = bool(o["standby_paid"]) if o.get("standby_paid") is not None else line.auto_standby_paid
        pd = o.get("per_diem")
        line.per_diem = (None if pd == "none" else pd) if pd is not None else line.auto_per_diem
        line.positioning = o["positioning"] if o.get("positioning") is not None else line.auto_positioning
        line.bdo = float(o.get("bdo") or 0.0)
        line.note = o.get("note")
        out.append(line)
    return out


# ── Payslip ───────────────────────────────────────────────────────────────────

def _r(x: float) -> float:
    return round(x + 1e-9, 2)


def social_security(cotizable: float, year: int) -> dict:
    """Worker SS on the monthly contribution base (pay minus exempt dietas)."""
    cap = _by_year(_SS_CAP, year)
    base = min(cotizable, cap)
    common = _r(base * _by_year(_SS_COMMON, year))
    unemployment = _r(base * SS_UNEMPLOYMENT)
    training = _r(base * SS_TRAINING)
    excess = max(0.0, cotizable - cap)
    bands = (min(excess, cap * 0.10), min(max(0.0, excess - cap * 0.10), cap * 0.40), max(0.0, excess - cap * 0.50))
    solidarity = _r(sum(b * t for b, t in zip(bands, _by_year(_SS_SOLIDARITY, year))))
    return {
        "base": _r(base), "cap": cap, "excess": _r(excess),
        "common": common, "unemployment": unemployment, "training": training, "solidarity": solidarity,
        "total": _r(common + unemployment + training + solidarity),
    }


def payslip(conn: sqlite3.Connection, activity_month: str, *, category: str = "FO", level: int = 4,
            irpf_pct: float = 25.55, jornada_pct: int | None = None, jornada_prev_pct: int | None = None,
            default_jornada: int = 100, today: str | None = None) -> dict:
    """
    Estimate the payslip paid for `activity_month` + 1: fixed pay of that month
    (prorated by its jornada) plus the variable pay earned during `activity_month`
    (hour bands set by the activity month's jornada). Jornadas default to the
    per-month values in pay_jornada.
    """
    category = category.upper() if category and category.upper() in ("FO", "CPT") else "FO"
    pay_month = next_month(activity_month)
    if jornada_pct is None:
        jornada_pct = jornada_for(conn, pay_month, default_jornada)
    if jornada_prev_pct is None:
        jornada_prev_pct = jornada_for(conn, activity_month, default_jornada)
    fixed_r = rates(category, level, int(pay_month[:4]))
    var_r = rates(category, level, int(activity_month[:4]))
    j = jornada_pct / 100.0

    # ── Fixed (payslip month, prorated by its jornada) ────────────────────────
    base = _r(fixed_r["base"] * j)
    extra = _r(int(base / 7 * 100) / 100)        # 1202 Paga extra prorrateada (1/7, as on the slip)
    fixed = [
        {"code": "1001", "key": "base_salary", "label": "Salario base", "amount": _r(base - extra)},
        {"code": "1202", "key": "extra_pay", "label": "Paga extra prorrateada", "amount": extra},
        {"code": "4055", "key": "uniform", "label": "Plus uniformidad", "amount": _r(fixed_r["uniform"] * j)},
        {"code": "4225", "key": "connectivity", "label": "Plus conectividad", "amount": _r(fixed_r["connectivity"] * j)},
        {"code": "4224", "key": "parking", "label": "Parking complement", "amount": _r(fixed_r["parking"] * j)},
        {"code": "4083", "key": "licence_insurance", "label": "Seguro pérdida licencia", "amount": fixed_r["licence_insurance"], "in_kind": True},
        {"code": "41P0", "key": "pension", "label": "Pensión empresa", "amount": fixed_r["pension"], "in_kind": True},
    ]

    # ── Variable (activity month) ─────────────────────────────────────────────
    lines = reconcile_month(conn, activity_month, today=today)
    block = round(sum(l.block_hours for l in lines), 2)
    block_actual = round(sum(l.block_hours for l in lines if not l.projected), 2)
    thr = blh_threshold(jornada_prev_pct)
    h_normal = round(min(block, thr), 2)
    h_reduced = round(max(0.0, min(block, 60.0) - thr), 2)
    h_prod = round(max(0.0, block - 60.0), 2)

    sby_days = sum(1 for l in lines if l.standby_paid)
    sim_days = sum(1 for l in lines if l.sim)
    vac_days = sum(1 for l in lines if l.vacation)
    positionings = sum(l.positioning for l in lines)
    bdo_units = sum(l.bdo for l in lines)
    per_diem_counts = {t: sum(1 for l in lines if l.per_diem == t) for t in PER_DIEM_TYPES}

    variable = [
        {"code": "2210", "key": "blh", "label": "Horas de vuelo", "units": h_normal, "rate": var_r["blh"]},
        {"code": "2215", "key": "blhs", "label": "Horas de vuelo (tramo reducido)", "units": h_reduced, "rate": var_r["blhs"]},
        {"code": "2225", "key": "blhp", "label": "Horas de vuelo productividad", "units": h_prod, "rate": var_r["blhp"]},
        {"code": "2206", "key": "standby", "label": "Guardia en base", "units": sby_days, "rate": var_r["sby"]},
        {"code": "5285", "key": "sim", "label": "Plus por simulador", "units": sim_days, "rate": var_r["sim"]},
        {"code": "5284", "key": "positioning", "label": "Posicionamiento vuelo", "units": positionings, "rate": var_r["positioning"]},
        {"code": "BDO", "key": "bdo", "label": "Día libre comprado (BDO)", "units": bdo_units, "rate": var_r["bdo"]},
        {"code": "SOC", "key": "var_soc", "label": "VAR on SOC/VAC", "units": vac_days, "rate": var_r["var_soc"]},
    ]
    for t in PER_DIEM_TYPES:
        variable.append({"code": {"int_no_overnight": "8212", "int_int_overnight": "8214"}.get(t, "DIET"),
                         "key": t, "label": PER_DIEM_LABEL[t], "units": per_diem_counts[t],
                         "rate": PER_DIEM_RATE[t], "per_diem": True})
    for v in variable:
        v["amount"] = _r(v["units"] * v["rate"])
    variable = [v for v in variable if v["units"]]

    # ── Totals, SS, IRPF ──────────────────────────────────────────────────────
    gross = _r(sum(x["amount"] for x in fixed) + sum(v["amount"] for v in variable))
    in_kind = _r(sum(x["amount"] for x in fixed if x.get("in_kind")))
    dietas = _r(sum(v["amount"] for v in variable if v.get("per_diem")))
    dietas_exempt = _r(sum(per_diem_counts[t] * PER_DIEM_EXEMPT[t] for t in PER_DIEM_TYPES))
    cash_gross = _r(gross - in_kind)

    ss = social_security(gross - dietas_exempt, int(pay_month[:4]))
    irpf_base = _r(cash_gross - dietas_exempt)
    irpf_rate = irpf_pct / 100.0
    irpf = _r(irpf_base * irpf_rate)
    irpf_in_kind = _r(fixed_r["licence_insurance"] * irpf_rate)
    net = _r(cash_gross - ss["total"] - irpf - irpf_in_kind)

    return {
        "activity_month": activity_month,
        "payslip_month": pay_month,
        "category": category, "level": level,
        "irpf_pct": irpf_pct, "jornada_pct": jornada_pct, "jornada_prev_pct": jornada_prev_pct,
        "block_hours": block, "block_hours_actual": block_actual,
        "blh_threshold": thr,
        "projected_days": sum(1 for l in lines if l.projected),
        "fixed": fixed,
        "variable": variable,
        "gross": gross,
        "in_kind": in_kind,
        "cash_gross": cash_gross,
        "dietas": dietas,
        "dietas_exempt": dietas_exempt,
        "social_security": ss,
        "irpf_base": irpf_base,
        "irpf": irpf,
        "irpf_in_kind": irpf_in_kind,
        "deductions": _r(in_kind + ss["total"] + irpf + irpf_in_kind),
        "net": net,
        "days": [asdict(l) for l in lines],
        "flags": {
            "activated": [l.date for l in lines if l.activated],
            "not_flown": [l.date for l in lines if l.status == "not_flown"],
            "extra_duty": [l.date for l in lines if l.status == "extra_duty"],
            "bdo_unconfirmed": [l.date for l in lines if l.bdo_candidate and not l.bdo and "bdo" not in l.override],
        },
    }
