"""
Phase 0 audit: probe Garmin activity streams across years and sports.

Run from daybook/ root:
    python -m domains.health.garmin.audit_streams

Outputs:
    data/audit/stream_audit.txt   — channel availability matrix
    data/audit/sample_stream.json — raw payload of one activity detail
"""

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

_ROOT = Path(__file__).parents[3]

from infrastructure.db.connection import get_connection
from domains.health.garmin.garmin_client import get_client


AUDIT_DIR = _ROOT / "data" / "audit"

# Sample one activity per sport per year across this range
SAMPLE_YEARS = list(range(2019, date.today().year + 1))
TARGET_SPORTS = ["running", "cycling", "swimming", "lap_swimming", "trail_running", "open_water_swimming"]


def pick_sample_activities(conn) -> list[dict]:
    """Pick one activity per year per sport from the DB."""
    rows = conn.execute("""
        SELECT id, date, activity_type,
               CAST(SUBSTR(date, 1, 4) AS INTEGER) AS year,
               avg_power_watts, avg_heart_rate, training_stress_score
        FROM activities
        WHERE source = 'garmin'
          AND date IS NOT NULL
          AND activity_type IS NOT NULL
        ORDER BY date ASC
    """).fetchall()

    seen = set()
    samples = []
    for row in rows:
        act_id, act_date, act_type, year, power, hr, tss = row
        key = (year, act_type.split("_")[0] if act_type else "other")
        if key not in seen and year in SAMPLE_YEARS:
            seen.add(key)
            samples.append({
                "id": act_id,
                "date": act_date,
                "activity_type": act_type,
                "year": year,
                "has_power": power is not None and power > 0,
                "has_hr": hr is not None,
                "tss": tss,
            })

    # Cap at 20 samples to avoid hammering the API
    return samples[:20]


def probe_activity(client, activity_id: str) -> dict:
    """Call get_activity_details and return which channels are present + sample counts."""
    native_id = activity_id.replace("garmin_", "")
    try:
        details = client.get_activity_details(native_id, max_chart_size=2000)
    except Exception as e:
        return {"error": str(e)}

    if not details or not isinstance(details, dict):
        return {"error": "empty response"}

    metrics = details.get("activityDetailMetrics") or []
    descriptors = details.get("metricDescriptors") or []

    channels: dict[str, int] = {}
    for point in metrics:
        for m in point.get("metrics", []):
            mt = m.get("metricsType", "").lower()
            if m.get("value") is not None:
                channels[mt] = channels.get(mt, 0) + 1

    # Also read descriptor names for richer labeling
    descriptor_keys = [d.get("metricsType", "").lower() for d in descriptors]

    return {
        "channels": channels,
        "descriptor_keys": descriptor_keys,
        "sample_count": len(metrics),
        "has_power": "power" in channels or "avg_power" in channels,
        "has_hr": any(k in channels for k in ("heart_rate", "heartrate", "direct_heart_rate")),
        "has_pace": any(k in channels for k in ("speed", "pace", "direct_speed")),
        "has_altitude": any(k in channels for k in ("altitude", "elevation")),
        "has_cadence": "cadence" in channels or "steps_per_min" in channels,
        "has_gps": any(k in channels for k in ("latitude", "position_lat", "gps_accuracy")),
    }


def probe_splits(client, activity_id: str) -> dict:
    """Check if splits/laps are available for an activity."""
    native_id = activity_id.replace("garmin_", "")
    try:
        splits = client.get_activity_splits(native_id)
        if splits and isinstance(splits, dict):
            laps = splits.get("lapDTOs") or splits.get("laps") or []
            return {"lap_count": len(laps), "available": len(laps) > 0}
        return {"lap_count": 0, "available": False}
    except Exception as e:
        return {"error": str(e), "available": False}


def probe_physio(client) -> dict:
    """Check availability of training status, VO2max, and readiness."""
    results = {}
    today = date.today().isoformat()

    try:
        ts = client.get_training_status(today)
        results["training_status"] = "ok" if ts else "empty"
        if ts and isinstance(ts, dict):
            results["training_status_keys"] = list(ts.keys())[:10]
    except Exception as e:
        results["training_status"] = f"error: {e}"

    try:
        mm = client.get_max_metrics(today)
        results["max_metrics"] = "ok" if mm else "empty"
        if mm and isinstance(mm, (dict, list)):
            keys = list(mm.keys())[:10] if isinstance(mm, dict) else [type(mm[0]).__name__]
            results["max_metrics_keys"] = keys
    except Exception as e:
        results["max_metrics"] = f"error: {e}"

    try:
        tr = client.get_training_readiness(today)
        results["training_readiness"] = "ok" if tr else "empty"
        if tr and isinstance(tr, dict):
            results["training_readiness_keys"] = list(tr.keys())[:10]
    except Exception as e:
        results["training_readiness"] = f"error: {e}"

    return results


def check_existing_tss(conn) -> dict:
    """Report TSS coverage in existing activities table."""
    total = conn.execute("SELECT COUNT(*) FROM activities WHERE source='garmin'").fetchone()[0]
    with_tss = conn.execute(
        "SELECT COUNT(*) FROM activities WHERE source='garmin' AND training_stress_score IS NOT NULL AND training_stress_score > 0"
    ).fetchone()[0]
    with_power = conn.execute(
        "SELECT COUNT(*) FROM activities WHERE source='garmin' AND avg_power_watts IS NOT NULL AND avg_power_watts > 0"
    ).fetchone()[0]
    with_hr = conn.execute(
        "SELECT COUNT(*) FROM activities WHERE source='garmin' AND avg_heart_rate IS NOT NULL"
    ).fetchone()[0]
    sports = conn.execute("""
        SELECT activity_type, COUNT(*) as n,
               SUM(CASE WHEN training_stress_score > 0 THEN 1 ELSE 0 END) as tss_count,
               SUM(CASE WHEN avg_power_watts > 0 THEN 1 ELSE 0 END) as power_count
        FROM activities
        WHERE source='garmin'
        GROUP BY activity_type
        ORDER BY n DESC
        LIMIT 15
    """).fetchall()

    return {
        "total_garmin_activities": total,
        "with_tss": with_tss,
        "tss_coverage_pct": round(with_tss / total * 100, 1) if total else 0,
        "with_power": with_power,
        "power_coverage_pct": round(with_power / total * 100, 1) if total else 0,
        "with_hr": with_hr,
        "hr_coverage_pct": round(with_hr / total * 100, 1) if total else 0,
        "by_sport": [
            {"sport": r[0], "count": r[1], "tss_count": r[2], "power_count": r[3]}
            for r in sports
        ],
    }


def main() -> None:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)

    print("Connecting to DB...", file=sys.stderr)
    conn = get_connection()

    print("Checking existing TSS/power coverage...", file=sys.stderr)
    tss_summary = check_existing_tss(conn)

    print("Picking sample activities...", file=sys.stderr)
    samples = pick_sample_activities(conn)
    print(f"  Selected {len(samples)} activities to probe", file=sys.stderr)

    print("Connecting to Garmin...", file=sys.stderr)
    client = get_client()

    print("Probing activity streams...", file=sys.stderr)
    stream_results = []
    sample_payload_saved = False

    for i, sample in enumerate(samples):
        print(f"  [{i+1}/{len(samples)}] {sample['id']} ({sample['year']} {sample['activity_type']})",
              file=sys.stderr)
        probe = probe_activity(client, sample["id"])
        splits = probe_splits(client, sample["id"])

        result = {**sample, "stream_probe": probe, "splits_probe": splits}
        stream_results.append(result)

        # Save one raw payload as sample
        if not sample_payload_saved and "error" not in probe:
            native_id = sample["id"].replace("garmin_", "")
            try:
                raw = client.get_activity_details(native_id, max_chart_size=500)
                (AUDIT_DIR / "sample_stream.json").write_text(
                    json.dumps(raw, indent=2, ensure_ascii=False)
                )
                sample_payload_saved = True
                print(f"    Saved sample payload → data/audit/sample_stream.json", file=sys.stderr)
            except Exception as e:
                print(f"    Could not save sample: {e}", file=sys.stderr)

    print("Probing physiological endpoints...", file=sys.stderr)
    physio = probe_physio(client)

    conn.close()

    # ── Build report ─────────────────────────────────────────────────────────
    lines = []
    lines.append("=" * 70)
    lines.append("DAYBOOK — GARMIN STREAM AUDIT")
    lines.append(f"Run date: {date.today()}")
    lines.append("=" * 70)
    lines.append("")

    lines.append("── EXISTING TSS / POWER COVERAGE ──")
    lines.append(f"  Total Garmin activities : {tss_summary['total_garmin_activities']}")
    lines.append(f"  With TSS                : {tss_summary['with_tss']} ({tss_summary['tss_coverage_pct']}%)")
    lines.append(f"  With power (watts)      : {tss_summary['with_power']} ({tss_summary['power_coverage_pct']}%)")
    lines.append(f"  With avg HR             : {tss_summary['with_hr']} ({tss_summary['hr_coverage_pct']}%)")
    lines.append("")
    lines.append("  By sport:")
    for s in tss_summary["by_sport"]:
        lines.append(f"    {s['sport']:<30} n={s['count']:<5} tss={s['tss_count']:<5} power={s['power_count']}")
    lines.append("")

    lines.append("── STREAM PROBE RESULTS ──")
    lines.append(f"  {'ID':<40} {'Year':<6} {'Sport':<25} {'HR':>4} {'Power':>6} {'Pace':>5} {'Alt':>4} {'GPS':>4} {'Cad':>4} {'Laps':>5}")
    lines.append("  " + "-" * 105)
    for r in stream_results:
        sp = r.get("stream_probe", {})
        sl = r.get("splits_probe", {})
        if "error" in sp:
            lines.append(f"  {r['id']:<40} {r['year']:<6} {r['activity_type']:<25} ERROR: {sp['error']}")
        else:
            lines.append(
                f"  {r['id']:<40} {r['year']:<6} {r['activity_type']:<25} "
                f"{'Y' if sp.get('has_hr') else 'N':>4} "
                f"{'Y' if sp.get('has_power') else 'N':>6} "
                f"{'Y' if sp.get('has_pace') else 'N':>5} "
                f"{'Y' if sp.get('has_altitude') else 'N':>4} "
                f"{'Y' if sp.get('has_gps') else 'N':>4} "
                f"{'Y' if sp.get('has_cadence') else 'N':>4} "
                f"{sl.get('lap_count', '?'):>5}"
            )
    lines.append("")

    lines.append("── PHYSIOLOGICAL ENDPOINTS ──")
    for k, v in physio.items():
        lines.append(f"  {k}: {v}")
    lines.append("")

    lines.append("── DECISION GATES ──")
    power_sports = [r for r in stream_results if r.get("stream_probe", {}).get("has_power")]
    if power_sports or tss_summary["with_power"] > 0:
        lines.append("  [POWER] Power data available → use power-TSS for bike/run activities with power")
    else:
        lines.append("  [POWER] No power data found → hrTSS fallback for all activities")
    hr_ok = tss_summary["hr_coverage_pct"] > 50
    lines.append(f"  [HR]    HR coverage {tss_summary['hr_coverage_pct']}% → {'sufficient for hrTSS' if hr_ok else 'low coverage, manual RPE needed'}")
    tss_ok = tss_summary["tss_coverage_pct"] > 50
    lines.append(f"  [TSS]   Garmin-native TSS {tss_summary['tss_coverage_pct']}% coverage → {'use as primary' if tss_ok else 'compute from streams'}")
    lines.append("")
    lines.append("=" * 70)

    report = "\n".join(lines)
    out_path = AUDIT_DIR / "stream_audit.txt"
    out_path.write_text(report)

    print(report)
    print(f"\nReport saved → {out_path}", file=sys.stderr)
    if sample_payload_saved:
        print(f"Sample payload → {AUDIT_DIR / 'sample_stream.json'}", file=sys.stderr)


if __name__ == "__main__":
    main()
