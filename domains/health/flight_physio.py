"""
Persist + roll up per-flight physiological load (CIRQA).

`compute_flight_physio(conn, date)` snapshots the takeoff/landing HR & stress
spikes (vs the day's baseline) for each flight that day into `flight_physio`,
reusing the live windowing in stress_context. `rollup()` then aggregates the
persisted rows across all of your flying so the Correlations page can answer:

  - by="airport"  → which arrival airports spike your approach stress most
  - by="phase"    → takeoff vs landing, on average
  - by="captain"  → your stress response by the pilot flying the landing

Run (batch): python -m domains.health.flight_physio --days 400
"""

import argparse
import sqlite3

from infrastructure.db.connection import get_connection
from domains.health.stress_context import _phases_for_rows

_FLIGHT_SELECT = (
    "SELECT id, dep_iata, arr_iata, takeoff_utc, landing_utc, takeoff_crew, landing_crew "
    "FROM flights WHERE date=? AND is_sim=0"
)


def _b(v):
    return 1 if v else 0


def compute_flight_physio(conn, date: str) -> int:
    """Snapshot physio for every flight on `date`. Returns rows written."""
    rows = conn.execute(_FLIGHT_SELECT, (date,)).fetchall()
    if not rows:
        return 0
    phases = _phases_for_rows(conn, date, rows)
    if not phases:  # no intraday wellness for the day → nothing to snapshot
        return 0
    n = 0
    for f, ph in zip(rows, phases):
        tk, ld = ph.get("takeoff", {}), ph.get("landing", {})
        conn.execute(
            """
            INSERT INTO flight_physio (
                flight_id, date, dep_iata, arr_iata,
                takeoff_hr, takeoff_hr_delta, takeoff_stress, takeoff_stress_delta,
                takeoff_crew, takeoff_you_flew,
                landing_hr, landing_hr_delta, landing_stress, landing_stress_delta,
                landing_crew, landing_you_flew, updated_at
            ) VALUES (?,?,?,?, ?,?,?,?, ?,?, ?,?,?,?, ?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            ON CONFLICT(flight_id) DO UPDATE SET
                date=excluded.date, dep_iata=excluded.dep_iata, arr_iata=excluded.arr_iata,
                takeoff_hr=excluded.takeoff_hr, takeoff_hr_delta=excluded.takeoff_hr_delta,
                takeoff_stress=excluded.takeoff_stress, takeoff_stress_delta=excluded.takeoff_stress_delta,
                takeoff_crew=excluded.takeoff_crew, takeoff_you_flew=excluded.takeoff_you_flew,
                landing_hr=excluded.landing_hr, landing_hr_delta=excluded.landing_hr_delta,
                landing_stress=excluded.landing_stress, landing_stress_delta=excluded.landing_stress_delta,
                landing_crew=excluded.landing_crew, landing_you_flew=excluded.landing_you_flew,
                updated_at=excluded.updated_at
            """,
            (
                str(f["id"]), date, f["dep_iata"], f["arr_iata"],
                tk.get("hr"), tk.get("hr_delta"), tk.get("stress"), tk.get("stress_delta"),
                f["takeoff_crew"], _b(tk.get("you_flew")),
                ld.get("hr"), ld.get("hr_delta"), ld.get("stress"), ld.get("stress_delta"),
                f["landing_crew"], _b(ld.get("you_flew")),
            ),
        )
        n += 1
    conn.commit()
    return n


def compute_range(conn, days: int = 400) -> int:
    """Snapshot physio for every day with a flight in the last `days`."""
    dates = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT date FROM flights WHERE is_sim=0 "
            "AND date >= date('now', ?) ORDER BY date",
            (f"-{days} days",),
        )
    ]
    total = 0
    for d in dates:
        total += compute_flight_physio(conn, d)
    return total


def _avg(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def rollup(conn, by: str = "airport", days: int = 3650, min_n: int = 2) -> dict:
    """Aggregate persisted physio across the window. `by` in airport|phase|captain."""
    rows = conn.execute(
        "SELECT * FROM flight_physio WHERE date >= date('now', ?)",
        (f"-{days} days",),
    ).fetchall()

    if by == "phase":
        buckets = {
            "Takeoff": {
                "avg_stress_delta": _avg([r["takeoff_stress_delta"] for r in rows]),
                "avg_hr_delta": _avg([r["takeoff_hr_delta"] for r in rows]),
                "n": sum(1 for r in rows if r["takeoff_stress_delta"] is not None),
            },
            "Landing": {
                "avg_stress_delta": _avg([r["landing_stress_delta"] for r in rows]),
                "avg_hr_delta": _avg([r["landing_hr_delta"] for r in rows]),
                "n": sum(1 for r in rows if r["landing_stress_delta"] is not None),
            },
        }
        out = [{"key": k, **v} for k, v in buckets.items() if v["n"]]
    elif by == "captain":
        agg: dict[str, list] = {}
        for r in rows:
            if r["landing_crew"]:
                agg.setdefault(r["landing_crew"], []).append(r["landing_stress_delta"])
        out = [
            {"key": k, "avg_stress_delta": _avg(v), "n": len([x for x in v if x is not None])}
            for k, v in agg.items()
        ]
    else:  # airport — arrival airport = the approach that spikes you
        agg = {}
        for r in rows:
            if r["arr_iata"]:
                agg.setdefault(r["arr_iata"], {"stress": [], "hr": []})
                agg[r["arr_iata"]]["stress"].append(r["landing_stress_delta"])
                agg[r["arr_iata"]]["hr"].append(r["landing_hr_delta"])
        out = [
            {"key": k, "avg_stress_delta": _avg(v["stress"]), "avg_hr_delta": _avg(v["hr"]),
             "n": len([x for x in v["stress"] if x is not None])}
            for k, v in agg.items()
        ]

    out = [b for b in out if b.get("n", 0) >= min_n and b.get("avg_stress_delta") is not None]
    out.sort(key=lambda b: b["avg_stress_delta"], reverse=True)
    return {"by": by, "buckets": out}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="single date YYYY-MM-DD")
    ap.add_argument("--days", type=int, default=400, help="backfill window when no --date")
    args = ap.parse_args()
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    if args.date:
        print(f"flight_physio: wrote {compute_flight_physio(conn, args.date)} row(s) for {args.date}")
    else:
        print(f"flight_physio: wrote {compute_range(conn, args.days)} row(s) over {args.days}d")
    conn.close()
