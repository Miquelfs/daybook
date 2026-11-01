"""
A planned trip's board — the bookings and to-dos laid out by day, like the Notion
board it usually starts as (`import_notion_csv` takes that board's CSV export) —
and, day by day, what the rest of the daybook knows about it: the ride planned
(its GPX course from the tour block) and the one ridden, the night's sleep, and
what you spent.

Items are plain rows (planned_trip_cards): a name, kinds ("Flights, Transportation"),
the day it sits on (a stay runs to its check-out), where, the price in € and/or the
trip's currency, what's paid, booked or not. Items dated before the trip, or not
dated, sit in a "Before" column.
"""

from __future__ import annotations

import csv
import io
import re
import sqlite3
from datetime import date, timedelta

from domains.plans.metrics import _has_table

FIELDS = ("name", "kinds", "date", "end_date", "place", "price_eur", "price_local", "paid_eur", "booked", "notes", "url")


def items(conn: sqlite3.Connection, planned_id: int) -> list[dict]:
    if not _has_table(conn, "planned_trip_cards"):
        return []
    return [dict(r) | {"booked": bool(r["booked"])} for r in conn.execute(
        "SELECT * FROM planned_trip_cards WHERE planned_id=? ORDER BY date IS NOT NULL, date, id", (planned_id,))]


def save_item(conn: sqlite3.Connection, planned_id: int, fields: dict, item_id: int | None = None) -> int:
    vals = {k: fields[k] for k in FIELDS if k in fields}
    if "booked" in vals:
        vals["booked"] = 1 if vals["booked"] else 0
    if item_id is None:
        vals["planned_id"] = planned_id
        cur = conn.execute(f"INSERT INTO planned_trip_cards ({', '.join(vals)}) VALUES ({', '.join('?' * len(vals))})",
                           list(vals.values()))
        item_id = cur.lastrowid
    elif vals:
        conn.execute(f"UPDATE planned_trip_cards SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?",
                     [*vals.values(), item_id])
    conn.commit()
    return item_id


def delete_item(conn: sqlite3.Connection, item_id: int) -> None:
    conn.execute("DELETE FROM planned_trip_cards WHERE id=?", (item_id,))
    conn.commit()


def cost_eur(it: dict, fx: float | None) -> float | None:
    """What an item costs in €: its € price, else the local price at the trip's rate, else what was paid."""
    if it.get("price_eur"):
        return it["price_eur"]
    if it.get("price_local") and fx:
        return round(it["price_local"] / fx, 2)
    return it.get("paid_eur") or None


# ── Notion CSV import ────────────────────────────────────────────────────────

_DMY = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def _dates(s: str) -> tuple[str | None, str | None]:
    """'10/11/2026' or '11/11/2026 → 13/11/2026' (Notion, day first) → ISO start, end."""
    found = [date(int(y), int(m), int(d)).isoformat() for d, m, y in _DMY.findall(s or "")]
    return (found[0] if found else None), (found[1] if len(found) > 1 else None)


def _money(s: str) -> float | None:
    s = re.sub(r"[^\d.\-]", "", (s or "").replace(",", ""))
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _day_label(s: str) -> str | None:
    """'DAY 3: Taipei - Hualien' → 'Taipei - Hualien'; 'DAY 8' / 'Pre-Departure' → None."""
    m = re.match(r"\s*day\s*\d+\s*:\s*(.+)", s or "", re.I)
    return m.group(1).strip() if m else None


def import_notion_csv(conn: sqlite3.Connection, planned_id: int, text: str) -> dict:
    """Load a Notion board export. Rows are matched by name, so importing again updates instead of
    duplicating; the board's day titles fill the day outline where it's empty."""
    from domains.plans import planned_trips as pt
    trip = conn.execute("SELECT * FROM planned_trips WHERE id=?", (planned_id,)).fetchone()
    if trip is None:
        raise ValueError("trip not found")
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    if not rows or "Name" not in rows[0]:
        raise ValueError("expected a Notion CSV export with a Name column")
    headers = list(rows[0])
    local_col = next((h for h in headers if h.startswith("Price ") and h != "Price EUR"), None)
    existing = {r["name"].strip().lower(): r["id"] for r in conn.execute(
        "SELECT id, name FROM planned_trip_cards WHERE planned_id=?", (planned_id,))}
    notes = {d for (d,) in conn.execute("SELECT date FROM planned_trip_days WHERE planned_id=?", (planned_id,))}
    added = updated = named = 0
    rates = []
    for r in rows:
        name = (r.get("Name") or "").strip()
        if not name:
            continue
        start, end = _dates(r.get("Date", ""))
        paid = _money(r.get("Paid EUR", "")) or _money(r.get("Paid", ""))
        fields = {
            "name": name, "kinds": (r.get("Type") or "").strip() or None, "date": start, "end_date": end,
            "place": (r.get("Place") or "").strip() or None, "price_eur": _money(r.get("Price EUR", "")),
            "price_local": _money(r.get(local_col, "")) if local_col else None, "paid_eur": paid or None,
            "booked": (r.get("Booked") or "").strip().lower() in ("yes", "true", "1"),
            "notes": (r.get("Notes") or r.get("Description") or "").strip() or None,
            "url": (r.get("URL") or "").strip() or None,
        }
        if fields["price_local"] and paid and not fields["price_eur"]:
            rates.append(fields["price_local"] / paid)
        iid = existing.get(name.lower())
        save_item(conn, planned_id, fields, iid)
        if iid:
            updated += 1
        else:
            added += 1
        label = _day_label(r.get("Day", ""))
        if label and start and trip["start_date"] <= start <= trip["end_date"] and start not in notes:
            pt.set_day(conn, planned_id, start, label)
            notes.add(start)
            named += 1
    patch = {}
    if local_col and not trip["currency"]:
        patch["currency"] = local_col.removeprefix("Price ").strip()
    if rates and not trip["fx_rate"]:
        patch["fx_rate"] = round(sum(rates) / len(rates), 2)
    if patch:
        conn.execute(f"UPDATE planned_trips SET {', '.join(f'{k}=?' for k in patch)} WHERE id=?",
                     [*patch.values(), planned_id])
    conn.commit()
    return {"added": added, "updated": updated, "days_named": named, **patch}


# ── the board + what happened, day by day ────────────────────────────────────

def _ride(conn: sqlite3.Connection, d: str) -> dict | None:
    """The bike session planned that day (with its GPX course) and what was actually ridden."""
    planned = None
    if _has_table(conn, "plan_sessions"):
        s = conn.execute(
            "SELECT id, session_type, effective_duration_min, intensity_zone, status FROM plan_sessions "
            "WHERE session_date=? AND status IN ('pending','completed') AND discipline='cycling' "
            "ORDER BY effective_duration_min DESC LIMIT 1", (d,)).fetchone()
        if s:
            from domains.training.blocks import course_for, stage_of
            from domains.training.gpx_course import daylight
            c = course_for(conn, s["id"]) if _has_table(conn, "session_courses") else None
            planned = {"session_id": s["id"], "type": s["session_type"].split(" - ", 1)[-1],
                       "minutes": s["effective_duration_min"], "zone": s["intensity_zone"], "status": s["status"],
                       "course": {k: c.get(k) for k in ("name", "km", "climb_m", "descent_m", "high_m", "minutes",
                                                        "tss", "avg_kmh", "profile", "start")}
                       | {"stage": stage_of(conn, s["id"]), "daylight": daylight(c, d)} if c else None}
    ridden = None
    if _has_table(conn, "activities"):
        a = conn.execute(
            "SELECT MIN(id) AS id, COUNT(*) AS n, SUM(distance_meters) AS m, SUM(elevation_gain_meters) AS up, "
            "SUM(duration_seconds) AS secs FROM activities WHERE date=? AND (activity_type LIKE '%cycl%' "
            "OR activity_type LIKE '%bik%' OR activity_type LIKE '%ride%')", (d,)).fetchone()
        if a and a["n"]:
            ridden = {"activity_id": a["id"], "km": round((a["m"] or 0) / 1000, 1), "climb_m": round(a["up"] or 0),
                      "minutes": round((a["secs"] or 0) / 60)}
    return {"planned": planned, "ridden": ridden} if planned or ridden else None


def _sleep(conn: sqlite3.Connection, d: str) -> dict | None:
    if not _has_table(conn, "sleep"):
        return None
    try:
        r = conn.execute("SELECT duration_seconds, score FROM sleep WHERE date=?", (d,)).fetchone()
    except sqlite3.OperationalError:                           # no score column (older schema)
        r = conn.execute("SELECT duration_seconds, NULL AS score FROM sleep WHERE date=?", (d,)).fetchone()
    if not r or not r["duration_seconds"]:
        return None
    return {"hours": round(r["duration_seconds"] / 3600, 1), "score": r["score"]}


def _spend(money: sqlite3.Connection | None, start: str, end: str) -> dict[str, list[dict]]:
    """Expenses per day from the money ledger (no transfers / portfolio moves)."""
    if money is None:
        return {}
    out: dict[str, list[dict]] = {}
    try:
        for r in money.execute(
                "SELECT date, name, amount, category FROM transactions WHERE deleted_at IS NULL AND date BETWEEN ? AND ? "
                "AND transaction_type = 'Expense' ORDER BY date, amount", (start, end)):
            out.setdefault(r["date"], []).append({"name": r["name"], "eur": round(abs(r["amount"]), 2),
                                                  "category": r["category"]})
    except sqlite3.OperationalError:
        return {}
    return out


def board(conn: sqlite3.Connection, trip: dict, money: sqlite3.Connection | None, today: date) -> dict:
    start, end = trip["start_date"], trip["end_date"]
    fx = trip.get("fx_rate")
    its = [it | {"cost_eur": cost_eur(it, fx)} for it in items(conn, trip["id"])]
    spend = _spend(money, start, end)
    days, d = [], date.fromisoformat(start)
    notes = {x["date"]: x["note"] for x in trip.get("days", [])}
    while d <= date.fromisoformat(end):
        ds = d.isoformat()
        past = d <= today
        days.append({"date": ds, "note": notes.get(ds), "items": [i for i in its if i["date"] == ds],
                     "ride": _ride(conn, ds), "sleep": _sleep(conn, ds) if past else None,
                     "spend": spend.get(ds, [])})
        d += timedelta(days=1)
    before = [i for i in its if not i["date"] or i["date"] < start]
    after = [i for i in its if i["date"] and i["date"] > end]
    rides = [x["ride"] for x in days if x["ride"]]
    courses = [r["planned"]["course"] for r in rides if r["planned"] and r["planned"]["course"]]
    sleeps = [x["sleep"]["hours"] for x in days if x["sleep"]]
    return {
        "before": before, "days": days, "after": after,
        "totals": {
            "items": len(its), "booked": sum(1 for i in its if i["booked"]),
            "to_book": [i["name"] for i in its if not i["booked"]],
            "planned_eur": round(sum(i["cost_eur"] or 0 for i in its), 2),
            "paid_eur": round(sum(i["paid_eur"] or 0 for i in its), 2),
            "spent_eur": round(sum(t["eur"] for v in spend.values() for t in v), 2),
            "planned_km": round(sum(c["km"] or 0 for c in courses)), "climb_m": sum(c["climb_m"] or 0 for c in courses),
            "ridden_km": round(sum((r["ridden"] or {}).get("km", 0) for r in rides)),
            "sleep_avg_h": round(sum(sleeps) / len(sleeps), 1) if sleeps else None,
        },
    }
