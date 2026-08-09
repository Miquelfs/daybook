"""
All-day wellness sync from Garmin Connect (built for the CIRQA, worn 24/7).

Pulls the continuous signals the base daily_stats sync doesn't keep:
  - intraday stress          (get_stress_data)
  - intraday Body Battery     (get_body_battery / stress payload)
  - respiration               (get_respiration_data)
  - all-day SpO2              (get_spo2_data)
into intraday_stress / intraday_body_battery + a wellness_daily aggregate row.

Defensive by design: the exact payload shapes vary by garminconnect version, so
every fetch is wrapped, raw JSON is always saved, and parsing tolerates missing
keys. Refine parsing from the saved raw/*.json if a field comes back empty.

Usage:
    python -m domains.health.garmin.wellness_sync [--date YYYY-MM-DD] [--backfill-days N] [--force]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).parents[3]

from infrastructure.db.connection import get_connection
from domains.health.garmin.garmin_client import get_client

RAW_DIR = _ROOT / "data" / "raw" / "garmin_wellness"


def _store_raw(date_str: str, payload: object) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"{date_str}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def _tz_offset_s(payload: dict) -> int:
    """Derive local UTC offset from a Garmin payload's *Local / *GMT timestamp pair."""
    for lk, gk in (("startTimestampLocal", "startTimestampGMT"),
                   ("calendarDate", None)):
        loc, gmt = payload.get(lk), payload.get(gk) if gk else None
        if loc and gmt:
            try:
                fmt = "%Y-%m-%dT%H:%M:%S"
                return int((datetime.strptime(loc[:19], fmt) - datetime.strptime(gmt[:19], fmt)).total_seconds())
            except Exception:
                pass
    return 0


def _hhmm(epoch_ms, tz_offset_s: int) -> str | None:
    try:
        dt = datetime.fromtimestamp(epoch_ms / 1000 + tz_offset_s, tz=timezone.utc).replace(tzinfo=None)
        return dt.strftime("%H:%M")
    except Exception:
        return None


def _parse_pair_series(arr, tz_offset_s: int, level_idx: int) -> list[tuple[str, int]]:
    """Return [(HH:MM, level)] from a Garmin [[ts, ...], ...] array; skip nulls/negatives."""
    out: list[tuple[str, int]] = []
    for entry in arr or []:
        if not entry or len(entry) <= level_idx:
            continue
        ts, lvl = entry[0], entry[level_idx]
        if ts is None or lvl is None or not isinstance(lvl, (int, float)):
            continue
        lvl = int(lvl)
        if lvl < 0:
            continue
        t = _hhmm(ts, tz_offset_s)
        if t:
            out.append((t, lvl))
    return out


def _stress_minutes(levels: list[int]) -> dict:
    """Stress is sampled ~every 3 min; bucket into rest/low/medium/high minutes."""
    rest = low = med = high = 0
    for v in levels:
        if v < 0:
            continue
        if v <= 25:   rest += 3
        elif v <= 50: low += 3
        elif v <= 75: med += 3
        else:         high += 3
    return {"rest": rest, "low": low, "med": med, "high": high}


def sync_date(client, conn: sqlite3.Connection, date_str: str, force: bool = False) -> int:
    if not force:
        existing = conn.execute("SELECT date FROM wellness_daily WHERE date=?", (date_str,)).fetchone()
        if existing:
            return 0

    raw_bundle: dict = {}
    daily: dict = {"date": date_str}

    # ── Stress (intraday + aggregates) ────────────────────────────────────────
    try:
        s = client.get_stress_data(date_str) or {}
        raw_bundle["stress"] = s
        off = _tz_offset_s(s)
        stress_series = _parse_pair_series(s.get("stressValuesArray"), off, 1)
        if stress_series:
            conn.executemany(
                "INSERT OR REPLACE INTO intraday_stress (date, time, level) VALUES (?,?,?)",
                [(date_str, t, lvl) for t, lvl in stress_series],
            )
            levels = [lvl for _, lvl in stress_series]
            mins = _stress_minutes(levels)
            daily.update({
                "stress_avg": s.get("avgStressLevel") or (round(sum(levels) / len(levels)) if levels else None),
                "stress_max": s.get("maxStressLevel") or (max(levels) if levels else None),
                "stress_rest_min": mins["rest"], "stress_low_min": mins["low"],
                "stress_med_min": mins["med"], "stress_high_min": mins["high"],
            })
        # Body Battery sometimes rides along in the stress payload
        bb_series = _parse_pair_series(s.get("bodyBatteryValuesArray"), off, 2) \
            or _parse_pair_series(s.get("bodyBatteryValuesArray"), off, 1)
        if bb_series:
            conn.executemany(
                "INSERT OR REPLACE INTO intraday_body_battery (date, time, level) VALUES (?,?,?)",
                [(date_str, t, lvl) for t, lvl in bb_series],
            )
    except Exception as e:
        print(f"  {date_str}: stress fetch failed — {e}")

    # ── Body Battery (dedicated endpoint — has charged/drained) ──────────────
    try:
        bb = client.get_body_battery(date_str, date_str)
        raw_bundle["body_battery"] = bb
        day = bb[0] if isinstance(bb, list) and bb else (bb if isinstance(bb, dict) else {})
        off = _tz_offset_s(day) if isinstance(day, dict) else 0
        series = _parse_pair_series(day.get("bodyBatteryValuesArray"), off, 2) if isinstance(day, dict) else []
        if series:
            conn.executemany(
                "INSERT OR REPLACE INTO intraday_body_battery (date, time, level) VALUES (?,?,?)",
                [(date_str, t, lvl) for t, lvl in series],
            )
        if isinstance(day, dict):
            daily["bb_charged"] = day.get("charged")
            daily["bb_drained"] = day.get("drained")
    except Exception as e:
        print(f"  {date_str}: body battery fetch failed — {e}")

    # Fill bb_min/max/charged/drained from whatever intraday we stored
    bb_rows = conn.execute(
        "SELECT level FROM intraday_body_battery WHERE date=? ORDER BY time", (date_str,)
    ).fetchall()
    if bb_rows:
        vals = [r["level"] for r in bb_rows]
        daily.setdefault("bb_min", min(vals))
        daily.setdefault("bb_max", max(vals))
        if daily.get("bb_charged") is None or daily.get("bb_drained") is None:
            charged = drained = 0
            for a, b in zip(vals, vals[1:]):
                d = b - a
                if d > 0: charged += d
                else: drained += -d
            daily.setdefault("bb_charged", charged)
            daily.setdefault("bb_drained", drained)

    # ── Respiration ──────────────────────────────────────────────────────────
    try:
        r = client.get_respiration_data(date_str) or {}
        raw_bundle["respiration"] = r
        daily["respiration_avg"] = r.get("avgWakingRespirationValue") or r.get("avgSleepRespirationValue")
        daily["respiration_low"] = r.get("lowestRespirationValue")
        daily["respiration_high"] = r.get("highestRespirationValue")
    except Exception as e:
        print(f"  {date_str}: respiration fetch failed — {e}")

    # ── SpO2 ─────────────────────────────────────────────────────────────────
    try:
        sp = client.get_spo2_data(date_str) or {}
        raw_bundle["spo2"] = sp
        daily["spo2_avg"] = sp.get("averageSpO2") or sp.get("avgSpO2")
        daily["spo2_low"] = sp.get("lowestSpO2") or sp.get("lowSpO2")
    except Exception as e:
        print(f"  {date_str}: spo2 fetch failed — {e}")

    _store_raw(date_str, raw_bundle)

    cols = ["date", "stress_avg", "stress_max", "stress_rest_min", "stress_low_min",
            "stress_med_min", "stress_high_min", "bb_min", "bb_max", "bb_charged",
            "bb_drained", "respiration_avg", "respiration_low", "respiration_high",
            "spo2_avg", "spo2_low", "skin_temp_dev"]
    conn.execute(
        f"INSERT OR REPLACE INTO wellness_daily ({','.join(cols)}) "
        f"VALUES ({','.join('?' for _ in cols)})",
        tuple(daily.get(c) for c in cols),
    )
    conn.commit()
    got = "stress" if daily.get("stress_avg") is not None else "-"
    print(f"  {date_str}: wellness stored ({got}); stress rows="
          f"{len(conn.execute('SELECT 1 FROM intraday_stress WHERE date=?', (date_str,)).fetchall())}")
    return 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date")
    parser.add_argument("--backfill-days", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    conn = get_connection()
    from infrastructure.db.migrate_wellness import migrate as _mig
    _mig(conn)
    client = get_client()

    if args.backfill_days > 0:
        today = date.today()
        dates = [(today - timedelta(days=i)).isoformat() for i in range(args.backfill_days, 0, -1)]
    else:
        dates = [args.date or (date.today() - timedelta(days=1)).isoformat()]

    total = 0
    for d in dates:
        total += sync_date(client, conn, d, force=args.force)
    conn.close()
    print(f"\nDone: wellness synced for {total}/{len(dates)} day(s)")


if __name__ == "__main__":
    main()
