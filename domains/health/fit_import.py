"""
Attach a .fit file from a trainer app (MyWhoosh, Zwift, …) to an activity the
watch already recorded, and merge the two into one activity — no duplicate.

  watch  → body battery, the activity's timeline and identity
  .fit   → power, cadence, speed, distance (and ascent for the summary)
  hr     → the file's when it has one (a strap paired to the app beats a wrist
           sensor that loses lock on the bars), the watch's for any gaps

The two clocks can't be trusted to agree (an iPad clock 28 min off is real),
so the file is aligned by cross-correlating its heart rate against the watch's.
Fallbacks: device clocks if they overlap, else "both started together".

The merged streams are written at 1 Hz in the Garmin vocabulary (sumduration,
directheartrate, directpower, directbikecadence, directspeed, sumdistance …), so
every reader (analysis cards, metrics, best efforts, ride quality) just sees an
activity with power. The watch's original streams and summary are kept in
activity_fit_imports, so the merge can be re-applied after a Garmin re-sync or
removed again. Virtual GPS / altitude from the trainer app are never written:
they are a game world, not a place.

CLI:  python -m domains.health.fit_import <activity_id> <file.fit>
      python -m domains.health.fit_import <activity_id> --detach
      python -m domains.health.fit_import --reapply-all    # after changing the merge rules
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from bisect import bisect_right

from domains.health.fit_file import parse_fit

MAX_FILL_S = 5          # bridge FIT gaps up to this, else no data
MIN_OVERLAP_S = 300     # HR alignment needs ≥5 min of shared heart rate
MIN_CORR = 0.8          # below this the HR match isn't trusted
COARSE_BUCKET_S = 10
FIT_CHANNELS = ("power", "cadence", "speed", "distance", "altitude", "hr")
SUMMARY_COLS = ("distance_meters", "avg_speed_mps", "avg_power_watts", "elevation_gain_meters",
                "moving_time_seconds", "training_stress_score", "avg_heart_rate", "max_heart_rate")


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS activity_fit_imports (
        activity_id       TEXT PRIMARY KEY,
        filename          TEXT,
        device            TEXT,
        imported_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        fit_offset_s      INTEGER NOT NULL,   -- FIT second (from its first record) at watch second 0
        align_method      TEXT NOT NULL,      -- hr | clock | start
        align_corr        REAL,
        fit_json          TEXT NOT NULL,      -- {"t0": epoch, "power": [...1 Hz], ...}
        original_streams  TEXT NOT NULL,      -- the watch's streams before the merge
        original_summary  TEXT NOT NULL,      -- the activity's summary columns before the merge
        summary_json      TEXT                -- what the merge produced (for the UI)
    )""")


# ── 1 Hz series ──────────────────────────────────────────────────────────────

def fit_series(records: list[dict]) -> dict:
    """FIT records → {"t0": epoch_s, channel: [value per second]} with short gaps bridged."""
    t0 = records[0]["ts"]
    n = int(records[-1]["ts"] - t0) + 1
    out: dict = {"t0": t0}
    for ch in FIT_CHANNELS:
        if not any(r.get(ch) is not None for r in records):
            continue
        arr: list = [None] * n
        last_v, last_s = None, None
        k = 0
        for s in range(n):
            while k < len(records) and records[k]["ts"] - t0 <= s:
                v = records[k].get(ch)
                if v is not None:
                    last_v, last_s = v, records[k]["ts"] - t0
                k += 1
            if last_s is not None and s - last_s <= MAX_FILL_S:
                arr[s] = last_v
        out[ch] = arr
    return out


def watch_timeline(streams: dict) -> list[float] | None:
    """Seconds since the activity start for each watch sample."""
    t = streams.get("sumduration") or streams.get("sumelapsedduration")
    if t and any(v is not None for v in t):
        return [float(v) if v is not None else None for v in t]
    ts = streams.get("directtimestamp")
    if ts and ts[0] is not None:
        return [(v - ts[0]) / 1000 if v is not None else None for v in ts]
    return None


def _ffill_1hz(times: list, values: list, n: int) -> list:
    pts = [(t, v) for t, v in zip(times, values) if t is not None]
    ts = [t for t, _ in pts]
    out = []
    for s in range(n):
        j = bisect_right(ts, s) - 1
        out.append(pts[j][1] if j >= 0 else None)
    return out


def _interp_1hz(times: list, values: list, n: int) -> list:
    """Linear interpolation onto whole seconds — forward-fill would lag sparse samples."""
    pts = [(t, v) for t, v in zip(times, values) if t is not None and v]
    ts = [t for t, _ in pts]
    out = []
    for s in range(n):
        j = bisect_right(ts, s) - 1
        if j < 0 or j + 1 >= len(pts):
            out.append(pts[j][1] if 0 <= j and s - ts[j] <= MAX_FILL_S else None)
            continue
        (ta, va), (tb, vb) = pts[j], pts[j + 1]
        out.append(None if tb - ta > 30 else va + (vb - va) * (s - ta) / (tb - ta))
    return out


# ── alignment ────────────────────────────────────────────────────────────────

def _corr(a: list, b: list, lag: int, step: int = 1) -> tuple[float, int]:
    """Pearson r of a[i] vs b[i+lag] over the seconds both have data."""
    xs, ys = [], []
    for i in range(0, len(a), step):
        j = i + lag
        if 0 <= j < len(b) and a[i] and b[j]:
            xs.append(a[i])
            ys.append(b[j])
    if len(xs) < 3:
        return -1.0, 0
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return -1.0, len(xs) * step
    return sxy / math.sqrt(sxx * syy), len(xs) * step


def _buckets(a: list, size: int) -> list:
    out = []
    for i in range(0, len(a), size):
        vals = [v for v in a[i:i + size] if v]
        out.append(sum(vals) / len(vals) if vals else None)
    return out


def align(watch_hr: list, fit_hr: list | None, fit_len: int, clock_offset: int) -> tuple[int, str, float | None]:
    """
    FIT second that lines up with watch second 0, plus how it was found.
    watch_hr / fit_hr are 1 Hz; clock_offset = watch start − FIT start by the device clocks.
    """
    if fit_hr and sum(1 for v in watch_hr if v) >= MIN_OVERLAP_S and sum(1 for v in fit_hr if v) >= MIN_OVERLAP_S:
        need = min(len(watch_hr), len(fit_hr)) // 2
        need = max(MIN_OVERLAP_S, need)
        wb, fb = _buckets(watch_hr, COARSE_BUCKET_S), _buckets(fit_hr, COARSE_BUCKET_S)
        best = (-2.0, 0)
        for lag in range(-len(wb), len(fb)):
            r, overlap = _corr(wb, fb, lag)
            if overlap * COARSE_BUCKET_S >= need and r > best[0]:
                best = (r, lag * COARSE_BUCKET_S)
        fine = (-2.0, best[1])
        for lag in range(best[1] - COARSE_BUCKET_S, best[1] + COARSE_BUCKET_S + 1):
            r, overlap = _corr(watch_hr, fit_hr, lag)
            if overlap >= need and r > fine[0]:
                fine = (r, lag)
        if fine[0] >= MIN_CORR:
            return fine[1], "hr", round(fine[0], 3)
    n = len(watch_hr)
    overlap = min(n, fit_len - clock_offset) - max(0, -clock_offset)
    if overlap >= n // 2:
        return clock_offset, "clock", None
    return 0, "start", None


# ── merge ────────────────────────────────────────────────────────────────────

def _load_streams(conn, activity_id: str) -> dict:
    out = {}
    for name, data in conn.execute("SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?",
                                   (activity_id,)):
        try:
            out[name] = json.loads(data)
        except (TypeError, ValueError):
            pass
    return out


def merge_streams(original: dict, fit: dict, offset: int) -> tuple[dict, dict]:
    """1 Hz merged streams on the watch timeline + a summary of what came from the file."""
    t = watch_timeline(original)
    if not t:
        raise ValueError("The activity has no timeline to merge into")
    n = int(max(v for v in t if v is not None)) + 1
    out: dict[str, list] = {}
    for name, vals in original.items():
        if isinstance(vals, list) and len(vals) == len(t):
            out[name] = _ffill_1hz(t, vals, n)
    out["sumduration"] = list(range(n))
    if "sumelapsedduration" in out:
        out["sumelapsedduration"] = list(range(n))
    if "directtimestamp" in out and original["directtimestamp"][0] is not None:
        ts0 = original["directtimestamp"][0]
        out["directtimestamp"] = [ts0 + s * 1000 for s in range(n)]

    def at(ch: str, s: int):
        arr = fit.get(ch)
        j = s + offset
        return arr[j] if arr and 0 <= j < len(arr) else None

    power = [at("power", s) for s in range(n)]
    covered = [p is not None or at("speed", s) is not None for s, p in enumerate(power)]
    if fit.get("power"):
        out["directpower"] = power
    if fit.get("cadence"):
        out["directbikecadence"] = [at("cadence", s) for s in range(n)]
    if fit.get("speed"):
        out["directspeed"] = [at("speed", s) for s in range(n)]
    if fit.get("distance"):
        d0 = next((at("distance", s) for s in range(n) if at("distance", s) is not None), 0.0)
        dist, last = [], 0.0
        for s in range(n):
            v = at("distance", s)
            if v is not None:
                last = max(last, v - d0)
            dist.append(round(last, 1))
        out["sumdistance"] = dist
    hr = out.get("directheartrate")
    fit_hr_used = 0
    if fit.get("hr"):
        watch_hr = hr or [None] * n
        hr = []
        for s in range(n):
            v = at("hr", s)
            if v:
                fit_hr_used += 1
            hr.append(v or watch_hr[s])
        out["directheartrate"] = hr
    moving, acc = [], 0
    for s in range(n):
        if (power[s] or 0) > 0 or (at("speed", s) or 0) > 0.5:
            acc += 1
        moving.append(acc)
    out["summovingduration"] = moving

    # summary over the merged window
    pw = [p for p in power if p is not None]
    alt = [at("altitude", s) for s in range(n)]
    ascent = sum(max(0.0, b - a) for a, b in zip(alt, alt[1:]) if a is not None and b is not None)
    best20 = None
    if len(power) >= 1200 and pw:
        cs, ch = [0.0], [0.0]
        for s in range(n):
            cs.append(cs[-1] + (power[s] or 0))
            ch.append(ch[-1] + ((hr[s] if hr else None) or 0))
        i = max(range(n - 1200 + 1), key=lambda k: cs[k + 1200] - cs[k])
        best20 = {"start_s": i, "avg_power_w": round((cs[i + 1200] - cs[i]) / 1200),
                  "avg_hr": round((ch[i + 1200] - ch[i]) / 1200) if hr else None}
    cad = [c for c in (out.get("directbikecadence") or []) if c]
    summary = {
        "seconds": n,
        "covered_s": sum(covered),
        "distance_m": out["sumdistance"][-1] if "sumdistance" in out else None,
        "avg_power_w": round(sum(pw) / len(pw)) if pw else None,
        "max_power_w": max(pw) if pw else None,
        "avg_cadence": round(sum(cad) / len(cad)) if cad else None,
        "ascent_m": round(ascent) if any(a is not None for a in alt) else None,
        "moving_s": acc,
        "best_20min": best20,
        "fit_hr_s": fit_hr_used,
        "hr_source": "file" if fit_hr_used >= n // 2 else "watch",
    }
    return out, summary


def _write_streams(conn, activity_id: str, streams: dict) -> None:
    conn.execute("DELETE FROM activity_streams WHERE activity_id=?", (activity_id,))
    conn.executemany("INSERT INTO activity_streams (activity_id, stream_type, data_json) VALUES (?,?,?)",
                     [(activity_id, k, json.dumps(v)) for k, v in streams.items()])


def _apply(conn, row) -> dict:
    """(Re)build the merged activity from a stored import row."""
    original = json.loads(row["original_streams"])
    fit = json.loads(row["fit_json"])
    merged, summary = merge_streams(original, fit, row["fit_offset_s"])
    _write_streams(conn, row["activity_id"], merged)
    orig = json.loads(row["original_summary"])
    dur = orig.get("duration_seconds") or summary["seconds"]
    dist = summary["distance_m"]
    hr = [v for v in merged.get("directheartrate") or [] if v] if summary["fit_hr_s"] else []
    conn.execute(
        """UPDATE activities SET distance_meters=?, avg_speed_mps=?, avg_power_watts=?,
                  elevation_gain_meters=?, moving_time_seconds=?,
                  avg_heart_rate=COALESCE(?, avg_heart_rate), max_heart_rate=COALESCE(?, max_heart_rate),
                  updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?""",
        (dist if dist is not None else orig.get("distance_meters"),
         round(dist / dur, 3) if dist and dur else orig.get("avg_speed_mps"),
         summary["avg_power_w"] if summary["avg_power_w"] is not None else orig.get("avg_power_watts"),
         summary["ascent_m"] if summary["ascent_m"] is not None else orig.get("elevation_gain_meters"),
         summary["moving_s"] or orig.get("moving_time_seconds"),
         round(sum(hr) / len(hr)) if hr else None, round(max(hr)) if hr else None,
         row["activity_id"]),
    )
    conn.execute("UPDATE activity_fit_imports SET summary_json=? WHERE activity_id=?",
                 (json.dumps(summary), row["activity_id"]))
    return summary


def recompute(conn, activity_id: str) -> None:
    """Metrics, best efforts and the analysis cache for one activity."""
    from domains.health.compute_activity_metrics import compute_for_activity
    from domains.health import activity_analysis
    a = conn.execute("SELECT id, date, activity_type, moving_time_seconds, avg_power_watts, avg_heart_rate "
                     "FROM activities WHERE id=?", (activity_id,)).fetchone()
    if a is None:
        return
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='best_effort'").fetchone():
        conn.execute("DELETE FROM best_effort WHERE activity_id=?", (activity_id,))
    compute_for_activity(conn, *tuple(a), recompute=True)
    conn.commit()
    activity_analysis.analyze(conn, activity_id, use_cache=False)


def attach(conn, activity_id: str, data: bytes, filename: str | None = None) -> dict:
    ensure_table(conn)
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if act is None:
        raise LookupError(f"Activity {activity_id} not found")
    parsed = parse_fit(data)
    fit = fit_series(parsed["records"])

    prev = conn.execute("SELECT original_streams, original_summary FROM activity_fit_imports WHERE activity_id=?",
                        (activity_id,)).fetchone()
    if prev:   # replacing a file: merge into the watch's originals, not the previous merge
        original = json.loads(prev["original_streams"])
        orig_summary = json.loads(prev["original_summary"])
    else:
        original = _load_streams(conn, activity_id)
        orig_summary = {k: act[k] for k in SUMMARY_COLS + ("duration_seconds",)}
    t = watch_timeline(original)
    if not t:
        raise ValueError("This activity has no recorded timeline (no streams yet) — wait for the Garmin sync")
    n = int(max(v for v in t if v is not None)) + 1
    watch_hr = _interp_1hz(t, original.get("directheartrate") or [], n) if original.get("directheartrate") else [None] * n

    ts = original.get("directtimestamp")
    clock_offset = round(ts[0] / 1000 - fit["t0"]) if ts and ts[0] is not None else 0
    fit_len = max(len(v) for k, v in fit.items() if k != "t0")
    offset, method, corr = align(watch_hr, fit.get("hr"), fit_len, clock_offset)

    conn.execute(
        """INSERT OR REPLACE INTO activity_fit_imports
           (activity_id, filename, device, fit_offset_s, align_method, align_corr, fit_json,
            original_streams, original_summary)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (activity_id, filename, parsed.get("device"), offset, method, corr, json.dumps(fit),
         json.dumps(original), json.dumps(orig_summary)),
    )
    row = conn.execute("SELECT * FROM activity_fit_imports WHERE activity_id=?", (activity_id,)).fetchone()
    _apply(conn, row)
    conn.commit()
    recompute(conn, activity_id)
    return status(conn, activity_id)


def detach(conn, activity_id: str) -> bool:
    ensure_table(conn)
    row = conn.execute("SELECT * FROM activity_fit_imports WHERE activity_id=?", (activity_id,)).fetchone()
    if row is None:
        return False
    _write_streams(conn, activity_id, json.loads(row["original_streams"]))
    orig = json.loads(row["original_summary"])
    cols = [c for c in SUMMARY_COLS if c in orig]   # older imports predate the HR columns
    conn.execute(f"UPDATE activities SET {', '.join(f'{c}=?' for c in cols)} WHERE id=?",
                 tuple(orig[c] for c in cols) + (activity_id,))
    conn.execute("DELETE FROM activity_fit_imports WHERE activity_id=?", (activity_id,))
    conn.commit()
    recompute(conn, activity_id)
    return True


def reapply_if_attached(conn, activity_id: str) -> bool:
    """After a Garmin re-sync overwrote the activity, put the merge back."""
    try:
        row = conn.execute("SELECT * FROM activity_fit_imports WHERE activity_id=?", (activity_id,)).fetchone()
    except sqlite3.OperationalError:
        return False
    if row is None:
        return False
    _apply(conn, row)
    return True


def status(conn, activity_id: str) -> dict | None:
    try:
        row = conn.execute(
            """SELECT activity_id, filename, device, imported_at, fit_offset_s, align_method, align_corr,
                      summary_json, fit_json FROM activity_fit_imports WHERE activity_id=?""",
            (activity_id,)).fetchone()
    except sqlite3.OperationalError:
        return None
    if row is None:
        return None
    fit = json.loads(row["fit_json"])
    ts = conn.execute("SELECT data_json FROM activity_streams WHERE activity_id=? AND stream_type='directtimestamp'",
                      (activity_id,)).fetchone()
    skew = None
    if ts:
        t = json.loads(ts[0])
        if t and t[0] is not None:   # how far the file's clock is from the watch's
            skew = round(fit["t0"] + row["fit_offset_s"] - t[0] / 1000)
    ftp = threshold_hr = None
    try:
        z = conn.execute("SELECT ftp_w, threshold_hr FROM athlete_zones WHERE sport='ride' "
                         "ORDER BY valid_from DESC LIMIT 1").fetchone()
        ftp, threshold_hr = (z[0], z[1]) if z else (None, None)
    except sqlite3.OperationalError:
        pass
    return {
        "ftp_w": ftp, "threshold_hr": threshold_hr,
        "filename": row["filename"], "device": row["device"], "imported_at": row["imported_at"],
        "offset_s": row["fit_offset_s"], "align_method": row["align_method"], "align_corr": row["align_corr"],
        "clock_skew_s": skew, "channels": [c for c in FIT_CHANNELS if c in fit],
        **(json.loads(row["summary_json"]) if row["summary_json"] else {}),
    }


def main() -> None:
    from infrastructure.db.connection import get_connection
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("activity_id", nargs="?")
    ap.add_argument("fit", nargs="?")
    ap.add_argument("--detach", action="store_true")
    ap.add_argument("--reapply-all", action="store_true", help="re-merge every attached file from its stored copy")
    args = ap.parse_args()
    conn = get_connection()
    if args.reapply_all:
        ensure_table(conn)
        ids = [r[0] for r in conn.execute("SELECT activity_id FROM activity_fit_imports")]
        for aid in ids:
            reapply_if_attached(conn, aid)
            conn.commit()
            recompute(conn, aid)
            print(aid, json.dumps({k: v for k, v in (status(conn, aid) or {}).items()
                                   if k in ("hr_source", "best_20min", "threshold_hr")}))
        return
    if not args.activity_id:
        ap.error("pass an activity id (or --reapply-all)")
    if args.detach:
        print("detached" if detach(conn, args.activity_id) else "nothing attached")
        return
    if not args.fit:
        ap.error("pass a .fit file or --detach")
    with open(args.fit, "rb") as f:
        print(json.dumps(attach(conn, args.activity_id, f.read(), args.fit.rsplit("/", 1)[-1]), indent=2))


if __name__ == "__main__":
    sys.exit(main())
