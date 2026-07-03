"""
Horizon 1 — Personal Load Index (embryo).

Computes a daily fatigue composite from available data and writes it to load_index.
Formula will evolve as data density increases and we can validate against reported energy/mood.

Components (all normalized to 0-25 each, sum = 0-100):
  1. hrv_load      — HRV deviation below 7-day rolling average (lower HRV = higher load)
  2. sleep_debt    — cumulative sleep deficit over last 3 nights vs 8h target
  3. tss_load      — training stress score from activities (same day)
  4. timezone_penalty — hours of absolute timezone displacement from UTC (duty context)

Recovery status thresholds:
  < 33  → "recovering"   (low load, body absorbing well)
  33-66 → "balanced"     (moderate load, sustainable)
  > 66  → "accumulating" (high load, watch closely)

Run:
    python -m domains.health.compute_load_index [--date YYYY-MM-DD]
    (default: yesterday)
"""

from __future__ import annotations

import argparse
import sqlite3
import uuid
from datetime import date, timedelta
from pathlib import Path

DB_PATH = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"

_SLEEP_TARGET_HOURS = 8.0
_HRV_WINDOW = 7   # days for rolling HRV baseline
_SLEEP_WINDOW = 3  # days for cumulative sleep debt


def _con(db_path: Path = DB_PATH) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


# ─── Component fetchers ───────────────────────────────────────────────────────

def _hrv_load(con: sqlite3.Connection, target_date: str) -> float | None:
    """
    How far below the 7-day HRV average is today?
    Returns 0-25: 0 = HRV above baseline, 25 = HRV badly suppressed.
    """
    d = date.fromisoformat(target_date)
    window_start = (d - timedelta(days=_HRV_WINDOW)).isoformat()
    window_end   = (d - timedelta(days=1)).isoformat()

    baseline_row = con.execute(
        "SELECT AVG(last_night_avg) FROM hrv WHERE date BETWEEN ? AND ? AND last_night_avg IS NOT NULL",
        (window_start, window_end),
    ).fetchone()
    baseline = baseline_row[0] if baseline_row else None

    today_row = con.execute(
        "SELECT last_night_avg FROM hrv WHERE date = ?", (target_date,)
    ).fetchone()
    today_hrv = today_row["last_night_avg"] if today_row else None

    if baseline is None or today_hrv is None or baseline == 0:
        return None

    # Negative deviation (below baseline) → load; above baseline → 0 load
    deviation_pct = max(0.0, (baseline - today_hrv) / baseline)  # 0.0–1.0+
    return min(25.0, deviation_pct * 50.0)  # caps at 25


def _sleep_debt(con: sqlite3.Connection, target_date: str) -> float | None:
    """
    Cumulative sleep deficit over last N nights vs target.
    Returns 0-25.
    """
    d = date.fromisoformat(target_date)
    dates = [(d - timedelta(days=i)).isoformat() for i in range(1, _SLEEP_WINDOW + 1)]
    rows = con.execute(
        f"SELECT duration_seconds FROM sleep WHERE date IN ({','.join('?' * len(dates))}) AND duration_seconds IS NOT NULL",
        dates,
    ).fetchall()

    if not rows:
        return None

    target_secs = _SLEEP_TARGET_HOURS * 3600 * len(rows)
    actual_secs = sum(r["duration_seconds"] for r in rows)
    deficit_hours = max(0.0, (target_secs - actual_secs) / 3600)
    # 0h deficit → 0 load; 6h+ deficit (2h/night × 3 nights) → 25 load
    return min(25.0, deficit_hours * (25.0 / 6.0))


def _tss_load(con: sqlite3.Connection, target_date: str) -> float | None:
    """
    Training stress score for the day. Returns 0-25.
    TSS ~100 is a hard session; >150 is very hard.
    """
    row = con.execute(
        "SELECT SUM(training_stress_score) AS tss FROM activities WHERE date = ? AND training_stress_score IS NOT NULL",
        (target_date,),
    ).fetchone()
    tss = row["tss"] if row and row["tss"] is not None else 0.0
    # 0 TSS → 0 load; 150+ TSS → 25 load
    return min(25.0, float(tss) * (25.0 / 150.0))


def _timezone_penalty(con: sqlite3.Connection, target_date: str) -> float | None:
    """
    Absolute timezone displacement from UTC in hours. Returns 0-25.
    """
    row = con.execute(
        "SELECT timezone_offset FROM days WHERE date = ?", (target_date,)
    ).fetchone()
    if row is None or row["timezone_offset"] is None:
        return None
    offset_hours = abs(row["timezone_offset"]) / 60.0
    # 0h offset → 0 load; 12h offset (max) → 25 load
    return min(25.0, offset_hours * (25.0 / 12.0))


def _duty_load(con: sqlite3.Connection, target_date: str) -> float | None:
    """
    Duty load from roster: duty hours + consecutive duty streak.
    Returns 0-25. NULL if no roster data for this date.

    Formula: min(25, duty_hours × 1.5 + consecutive_duty_days × 2)
    - A 10-hour duty day alone = 15 pts
    - 5 consecutive duty days adds 10 pts
    - Combined cap at 25
    """
    # Check if roster table exists
    tbl = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='roster'"
    ).fetchone()
    if not tbl:
        return None

    row = con.execute(
        """SELECT duty_type, report_time, end_time
           FROM roster WHERE date = ?""",
        (target_date,)
    ).fetchone()

    if not row:
        return None

    duty_type = row["duty_type"] or ""
    if duty_type not in ("flying_duty", "ground_duty"):
        return 0.0  # standby or day_off = 0 duty load

    # Compute duty hours
    duty_hours = 0.0
    try:
        from datetime import datetime
        fmt = "%H:%M"
        report = datetime.strptime(str(row["report_time"] or ""), fmt)
        end = datetime.strptime(str(row["end_time"] or ""), fmt)
        delta_hours = (end - report).seconds / 3600
        if delta_hours < 0:
            delta_hours += 24  # overnight duty
        duty_hours = delta_hours
    except Exception:
        duty_hours = 9.0  # fallback assumption

    # Consecutive duty days (count backward from target_date)
    d = date.fromisoformat(target_date)
    consecutive = 1
    for i in range(1, 15):
        prev = (d - timedelta(days=i)).isoformat()
        prev_row = con.execute(
            "SELECT duty_type FROM roster WHERE date=?", (prev,)
        ).fetchone()
        if prev_row and prev_row["duty_type"] in ("flying_duty", "ground_duty"):
            consecutive += 1
        else:
            break

    raw = duty_hours * 1.5 + consecutive * 2
    return min(25.0, raw)


def _recovery_status(score: float) -> str:
    if score < 33:
        return "recovering"
    if score <= 66:
        return "balanced"
    return "accumulating"


# ─── Main compute ─────────────────────────────────────────────────────────────

def compute_load_index(target_date: str, db_path: Path = DB_PATH) -> dict | None:
    con = _con(db_path)
    try:
        hrv   = _hrv_load(con, target_date)
        sleep = _sleep_debt(con, target_date)
        tss   = _tss_load(con, target_date)
        tz    = _timezone_penalty(con, target_date)
        duty  = _duty_load(con, target_date)

        # Need at least two components to produce a meaningful score
        components = [c for c in [hrv, sleep, tss, tz, duty] if c is not None]
        if len(components) < 2:
            print(f"  {target_date}: not enough data ({len(components)} components), skipping")
            return None

        # Scale: sum available components, normalize to 0-100 based on how many contributed
        raw_sum = sum(components)
        n_max = 5 if duty is not None else 4  # denominator grows when duty data exists
        fatigue_score = raw_sum * (n_max / len(components))
        fatigue_score = min(100.0, fatigue_score)

        result = {
            "date": target_date,
            "fatigue_score": round(fatigue_score, 1),
            "hrv_load": round(hrv, 2) if hrv is not None else None,
            "sleep_debt": round(sleep, 2) if sleep is not None else None,
            "tss_load": round(tss, 2) if tss is not None else None,
            "timezone_penalty": round(tz, 2) if tz is not None else None,
            "duty_load": round(duty, 2) if duty is not None else None,
            "recovery_status": _recovery_status(fatigue_score),
        }

        con.execute(
            """
            INSERT INTO load_index
                (date, fatigue_score, hrv_load, sleep_debt, tss_load, timezone_penalty, duty_load, recovery_status)
            VALUES (:date, :fatigue_score, :hrv_load, :sleep_debt, :tss_load, :timezone_penalty, :duty_load, :recovery_status)
            ON CONFLICT(date) DO UPDATE SET
                fatigue_score    = excluded.fatigue_score,
                hrv_load         = excluded.hrv_load,
                sleep_debt       = excluded.sleep_debt,
                tss_load         = excluded.tss_load,
                timezone_penalty = excluded.timezone_penalty,
                duty_load        = excluded.duty_load,
                recovery_status  = excluded.recovery_status,
                computed_at      = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
            """,
            result,
        )
        con.commit()
        print(f"  {target_date}: fatigue={fatigue_score:.1f} ({result['recovery_status']})")
        return result
    finally:
        con.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD (default: yesterday)")
    parser.add_argument("--backfill-days", type=int, default=0, help="Recompute last N days")
    args = parser.parse_args()

    if args.backfill_days > 0:
        today = date.today()
        for i in range(args.backfill_days, 0, -1):
            d = (today - timedelta(days=i)).isoformat()
            compute_load_index(d)
    else:
        target = args.date or (date.today() - timedelta(days=1)).isoformat()
        compute_load_index(target)
