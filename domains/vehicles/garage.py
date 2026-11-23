"""
A vehicle's kilometres and what it costs.

  Kilometres  odometer readings you log (the truth). The km between two readings are shared out
              over the days you actually used the vehicle in between (its day tag, or GPS legs
              assigned to it) — weighted by what the GPS saw each day; a used day the GPS missed
              counts as an average day of that stretch. With no used day in a stretch, evenly.
              The GPS (routes.py) adds where you went.
  Costs       ordinary expenses — there is no second ledger. An expense is this vehicle's when it
              carries its vehicle_id (picked in Add transaction, or logged from the vehicle's page),
              or, for everything typed before vehicles existed, when it's a Transportation expense
              with one of the vehicle's subcategories.
  €/km        running costs ÷ odometer km over the same span (purchase price apart).
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date

KINDS = ("car", "scooter", "motorbike", "other")
DEFAULT_TAG = {"scooter": "motorcycle", "motorbike": "motorcycle", "car": "car_drive"}


def subcats(v: sqlite3.Row | dict) -> list[str]:
    try:
        return [s for s in json.loads(v["subcategories"] or "[]") if isinstance(s, str) and s.strip()]
    except (TypeError, ValueError):
        return []


def cost_where(v: sqlite3.Row | dict) -> tuple[str, list]:
    """SQL (on transactions) for this vehicle's expenses."""
    subs = [s.strip().lower() for s in subcats(v)]
    sql = "deleted_at IS NULL AND COALESCE(transaction_type,'Expense') = 'Expense' AND (vehicle_id = ?"
    params: list = [v["id"]]
    if subs:
        sql += (" OR (vehicle_id IS NULL AND category = 'Transportation' AND LOWER(TRIM(subcategory)) IN ("
                + ",".join("?" * len(subs)) + "))")
        params += subs
    return sql + ")", params


def _month(d: str) -> str:
    return d[:7]


def _month_split(a: date, b: date, km: float, out: dict[str, float]) -> None:
    """km spread evenly over the days from a to b."""
    days = (b - a).days
    if days <= 0:
        out[b.isoformat()[:7]] += km
        return
    per_day, cur = km / days, a
    while cur < b:                                      # month by month, not day by day
        nxt = date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
        stop = min(nxt, b)
        out[cur.isoformat()[:7]] += per_day * (stop - cur).days
        cur = stop


def spread_km(readings: list[tuple[str, float]], used: dict[str, float] | None = None) -> dict[str, float]:
    """Odometer readings → km per month.

    `used`: day → GPS km on the days you used the vehicle (0 when the GPS saw nothing). Each stretch
    between two readings gives its km to its used days (after the first reading, up to the second),
    in proportion to their GPS km; a used day without GPS weighs as the stretch's average GPS day
    (all equal when none has GPS). A stretch with no used day is spread evenly."""
    out: dict[str, float] = defaultdict(float)
    used = used or {}
    pts = sorted(readings)
    for (d0, k0), (d1, k1) in zip(pts, pts[1:]):
        km = k1 - k0
        if km <= 0:
            continue
        days = sorted(d for d in used if d0 < d <= d1)
        if not days:
            _month_split(date.fromisoformat(d0), date.fromisoformat(d1), km, out)
            continue
        seen = [used[d] for d in days if used[d] > 0]
        fill = sum(seen) / len(seen) if seen else 1.0
        w = {d: (used[d] if used[d] > 0 else fill) for d in days}
        total = sum(w.values())
        for d in days:
            out[d[:7]] += km * w[d] / total
    return {k: v for k, v in out.items() if v}


def usage_days(conn: sqlite3.Connection, v) -> dict[str, float]:
    """day → GPS km for every day you used this vehicle (its tag on the day, or legs assigned to it)."""
    from domains.vehicles.routes import day_tags
    used: dict[str, float] = {}
    if v["day_tag"]:
        for d in day_tags({v["day_tag"]}):
            used[d] = 0.0
    for r in conn.execute("SELECT date, SUM(km) km FROM vehicle_legs WHERE vehicle_id=? GROUP BY date", (v["id"],)):
        used[r["date"]] = float(r["km"] or 0)
    return used


def readings(conn: sqlite3.Connection, v) -> list[tuple[str, float]]:
    rs = [(r["date"], r["km"]) for r in conn.execute(
        "SELECT date, km FROM vehicle_odometer WHERE vehicle_id=? ORDER BY date, km", (v["id"],))]
    if v["bought_on"] and v["bought_km"] is not None and not any(d <= v["bought_on"] for d, _ in rs):
        rs.insert(0, (v["bought_on"], float(v["bought_km"])))
    return rs


def summary(conn: sqlite3.Connection, v, months: int = 12) -> dict:
    today = date.today()
    y, mo = today.year, today.month - (months - 1)
    while mo <= 0:
        y, mo = y - 1, mo + 12
    since = date(y, mo, 1).isoformat()
    rs = readings(conn, v)
    used = usage_days(conn, v)
    by_month_km = spread_km(rs, used)
    odo_now = rs[-1][1] if rs else None
    odo_from = rs[0][1] if rs else None
    km_total = round(odo_now - odo_from, 1) if rs and len(rs) > 1 else 0.0
    km_period = round(sum(k for m, k in by_month_km.items() if m >= since[:7]), 1)

    where, params = cost_where(v)
    txns = conn.execute(f"SELECT id, date, name, amount, subcategory, vehicle_id FROM transactions WHERE {where} "
                        f"ORDER BY date DESC", params).fetchall()
    cost_total = round(-sum(t["amount"] for t in txns), 2)
    cost_period = round(-sum(t["amount"] for t in txns if t["date"] >= since), 2)
    by_month_cost: dict[str, float] = defaultdict(float)
    by_sub: dict[str, list[float]] = defaultdict(lambda: [0.0, 0])
    for t in txns:
        by_month_cost[_month(t["date"])] -= t["amount"]
        s = by_sub[(t["subcategory"] or "Other").strip() or "Other"]
        s[0] -= t["amount"]
        s[1] += 1
    # cost over the odometer's span, so €/km compares like with like
    span_cost = None
    if rs and len(rs) > 1 and km_total > 0:
        span_cost = -sum(t["amount"] for t in txns if rs[0][0] <= t["date"] <= rs[-1][0])

    gps = conn.execute("SELECT date, SUM(km) km FROM vehicle_legs WHERE vehicle_id=? GROUP BY date ORDER BY date DESC",
                       (v["id"],)).fetchall()
    by_month_gps: dict[str, float] = defaultdict(float)
    for g in gps:
        by_month_gps[_month(g["date"])] += g["km"]

    series = []
    m = date.fromisoformat(since)
    while m <= today:
        key = m.isoformat()[:7]
        series.append({"month": key, "km": round(by_month_km.get(key, 0.0), 1),
                       "gps_km": round(by_month_gps.get(key, 0.0), 1), "cost": round(by_month_cost.get(key, 0.0), 2)})
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)

    last = rs[-1] if rs else None
    return {
        "vehicle": vehicle_out(v),
        "odometer": odo_now,
        "last_reading": {"date": last[0], "km": last[1]} if last else None,
        "reading_age_days": (today - date.fromisoformat(last[0])).days if last else None,
        "km_total": km_total,
        "km_period": km_period,
        "cost_total": cost_total,
        "cost_period": cost_period,
        "per_km": round(span_cost / km_total, 3) if span_cost is not None else None,
        "per_km_period": round(cost_period / km_period, 3) if km_period > 0 else None,
        "per_month": round(cost_period / months, 2),
        "by_subcategory": sorted(({"subcategory": k, "amount": round(a, 2), "count": n} for k, (a, n) in by_sub.items()),
                                 key=lambda x: -x["amount"]),
        "series": series,
        "days_used": len(used),
        "days_used_period": sum(1 for d in used if d >= since),
        "gps": {"days": len(gps), "km": round(sum(g["km"] for g in gps), 1),
                "km_period": round(sum(g["km"] for g in gps if g["date"] >= since), 1)},
        "months": months,
    }


def vehicle_out(v) -> dict:
    d = dict(v)
    d["subcategories"] = subcats(v)
    return d


def overview(conn: sqlite3.Connection) -> list[dict]:
    out = []
    for v in conn.execute("SELECT * FROM vehicles ORDER BY sold_on IS NOT NULL, id").fetchall():
        s = summary(conn, v)
        out.append({k: s[k] for k in ("vehicle", "odometer", "reading_age_days", "km_period", "cost_period",
                                      "per_km_period", "per_month", "gps", "days_used_period")})
    return out
