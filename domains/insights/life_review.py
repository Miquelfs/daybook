"""
Weekly life review — the AI-coach pattern applied to all of Daybook.

Why not just "interpret the top correlations"? Pearson r on raw pairs is
dominated by things that are the same measurement twice (sleep score vs sleep
duration, active calories vs moving time), carries no units and no "this week".
So the review is grounded in numbers computed here, deterministically:

  1. week_vs_normal() — the last 7 days vs your previous 8 weeks, per metric,
     in real units, with how unusual it is (z-score).
  2. levers() — "what moves you": for each binary driver (every tag you use,
     late duty finishes, duty days, short sleep, training) the difference in
     the NEXT day's energy / mood / HRV and that night's sleep, with sample
     sizes and a Welch t-score. E.g. "late finish → next-day energy −0.9 (n=21)".
  3. last week's commitments and whether you marked them done.

The LLM only interprets those numbers into a headline, 2–4 patterns and at most
3 actions. Each action is either a commitment for the coming week (tick it off
on the review) or a ready-to-start experiment (one tap → Experiments tab).

Usage:
  python -m domains.insights.life_review --auto   # Sundays: review if not done yet
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import statistics
import sys
from datetime import date, timedelta

from domains.insights.compute_correlations import _fetch

# Metrics for "this week vs your normal": key → (label, unit, decimals, higher_is_better)
WEEK_METRICS = {
    "sleep_duration": ("Sleep", "h", 1, True),
    "energy": ("Energy", "/10", 1, True),
    "mood": ("Mood", "/10", 1, True),
    "stress": ("Stress", "/10", 1, False),
    "hrv_avg": ("HRV", "ms", 0, True),
    "resting_hr": ("Resting HR", "bpm", 0, False),
    "steps": ("Steps", "", 0, True),
    "moving_time_hours": ("Training", "h/day", 2, True),
    "food_kcal": ("Calories eaten", "kcal", 0, None),
    "daily_spend": ("Spending", "€/day", 0, False),
    "screen_total": ("Screen time", "min", 0, False),
}

# Outcomes for levers: key → (label, unit, decimals, higher_is_better)
OUTCOMES = {
    "energy": ("energy", "/10", 1, True),
    "mood": ("mood", "/10", 1, True),
    "hrv_avg": ("HRV", "ms", 0, True),
    "sleep_duration": ("sleep", "h", 1, True),
}

# Smallest effect worth showing, per outcome — significance alone surfaces trivia like "−0.1 mood".
MIN_EFFECT = {"energy": 0.3, "mood": 0.3, "hrv_avg": 3.0, "sleep_duration": 0.25}

# Experiment metrics the review may propose (must exist in the correlation catalog)
EXPERIMENT_METRICS = {"energy", "mood", "stress", "sleep_duration", "hrv_avg", "resting_hr",
                      "steps", "screen_total", "daily_spend", "food_sugar", "food_kcal"}


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _shift(d: str, n: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def _safe_fetch(conn, key, start, end) -> dict[str, float]:
    try:
        return {k: float(v) for k, v in _fetch(conn, key, start, end).items() if v is not None}
    except Exception:
        return {}


# ── 1. this week vs normal ──────────────────────────────────────────────────

def week_vs_normal(conn: sqlite3.Connection, end: date | None = None) -> list[dict]:
    end = end or date.today()
    w_start = end - timedelta(days=6)
    b_start = w_start - timedelta(weeks=8)
    out = []
    for key, (label, unit, dec, better) in WEEK_METRICS.items():
        series = _safe_fetch(conn, key, b_start.isoformat(), end.isoformat())
        week = [v for d, v in series.items() if d >= w_start.isoformat()]
        base_weeks = []
        for k in range(8):
            ws = (b_start + timedelta(weeks=k)).isoformat()
            we = (b_start + timedelta(weeks=k, days=6)).isoformat()
            vals = [v for d, v in series.items() if ws <= d <= we]
            if len(vals) >= 3:
                base_weeks.append(sum(vals) / len(vals))
        if len(week) < 3 or len(base_weeks) < 3:
            continue
        cur = sum(week) / len(week)
        base = statistics.mean(base_weeks)
        sd = statistics.pstdev(base_weeks) or None
        z = (cur - base) / sd if sd else 0.0
        verdict = None
        if better is not None and abs(z) >= 1:
            verdict = "better" if (cur > base) == better else "worse"
        out.append({"key": key, "label": label, "unit": unit, "this_week": round(cur, dec),
                    "normal": round(base, dec), "delta": round(cur - base, dec), "z": round(z, 1),
                    "verdict": verdict})
    out.sort(key=lambda m: -abs(m["z"]))
    return out


# ── 2. levers ───────────────────────────────────────────────────────────────

def _late_finish_days(conn, start, end) -> dict[str, float]:
    if "roster" not in _tables(conn):
        return {}
    out = {}
    for r in conn.execute("SELECT date, end_time FROM roster WHERE date BETWEEN ? AND ?", (start, end)):
        t = r["end_time"]
        late = 0.0
        if t and ":" in t:
            h = int(t.split(":")[0])
            late = 1.0 if (h >= 23 or h <= 5) else 0.0
        out[r["date"]] = late
    return out


def _drivers(conn, start, end) -> dict[str, tuple[str, dict[str, float]]]:
    """name → (label, {date: 0/1}) for every binary driver with enough days."""
    drivers: dict[str, tuple[str, dict[str, float]]] = {}
    t = _tables(conn)
    if "tags" in t and "day_tags" in t:
        for tg in conn.execute(
            """SELECT t.slug, t.name, COUNT(*) AS n FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.date BETWEEN ? AND ? GROUP BY t.id HAVING n >= 6""", (start, end)):
            drivers[f"tag:{tg['slug']}"] = (tg["name"] or tg["slug"], _safe_fetch(conn, f"tag:{tg['slug']}", start, end))
    late = _late_finish_days(conn, start, end)
    if sum(late.values()) >= 5:
        drivers["late_finish"] = ("Duty ending after 23:00", late)
    duty = _safe_fetch(conn, "duty_day", start, end)
    if sum(1 for v in duty.values() if v >= 0.5) >= 6:
        drivers["duty_day"] = ("Duty day", {d: 1.0 if v >= 0.5 else 0.0 for d, v in duty.items()})
    acts = _safe_fetch(conn, "activity_count", start, end)
    days_all = _safe_fetch(conn, "energy", start, end)
    if acts and days_all:
        drivers["trained"] = ("Trained that day", {d: 1.0 if acts.get(d, 0) > 0 else 0.0 for d in days_all})
    return drivers


def _welch(a: list[float], b: list[float]) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    va, vb = statistics.variance(a), statistics.variance(b)
    se = math.sqrt(va / len(a) + vb / len(b))
    return (statistics.mean(a) - statistics.mean(b)) / se if se else 0.0


def levers(conn: sqlite3.Connection, days: int = 180, end: date | None = None, limit: int = 12) -> list[dict]:
    """
    Driver → outcome effects in real units. Greedy de-confounding: per outcome,
    drivers are tested strongest-first, and each later driver is re-measured on
    days WITHOUT the stronger drivers already accepted for that outcome — so a tag
    that merely co-occurs with, say, alcohol doesn't inherit alcohol's effect.
    """
    end = end or date.today()
    start = (end - timedelta(days=days)).isoformat()
    end_s = end.isoformat()
    outcomes = {k: _safe_fetch(conn, k, start, _shift(end_s, 1)) for k in OUTCOMES}
    sleep = outcomes.get("sleep_duration", {})

    # candidate tests: (driver_key, label, series, outcome_key, lag, phrase)
    tests = []
    for key, (label, series) in _drivers(conn, start, end_s).items():
        # tags / duty / training on day D → next-day energy, mood, HRV; that night's sleep (sleep[D+1])
        for oc in ("energy", "mood", "hrv_avg"):
            tests.append((key, label, series, oc, 1, "next day"))
        tests.append((key, label, series, "sleep_duration", 1, "that night"))
    if sleep:
        short = {d: 1.0 if v < 6 else 0.0 for d, v in sleep.items()}
        for oc in ("energy", "mood"):
            tests.append(("short_sleep", "Slept under 6h", short, oc, 0, "same day"))

    def measure(series, outcome_key, lag, exclude: set[str]):
        oc = outcomes[outcome_key]
        on, off = [], []
        for d, v in series.items():
            if d in exclude:
                continue
            y = oc.get(_shift(d, lag))
            if y is not None:
                (on if v >= 0.5 else off).append(y)
        if len(on) < 6 or len(off) < 6:
            return None
        return on, off, _welch(on, off)

    raw = []
    for tst in tests:
        m = measure(tst[2], tst[3], tst[4], set())
        if m and abs(m[2]) >= 1.4:
            raw.append((abs(m[2]), tst))
    raw.sort(key=lambda x: -x[0])

    found = []
    accepted: dict[str, list[tuple[str, set[str]]]] = {}   # outcome → [(label, active days)]
    for _, (key, label, series, oc_key, lag, phrase) in raw:
        stronger = accepted.get(oc_key, [])
        exclude = set().union(*(days_ for _, days_ in stronger)) if stronger else set()
        m = measure(series, oc_key, lag, exclude)
        if not m or abs(m[2]) < 1.4:
            continue
        on, off, t = m
        olabel, unit, dec, better = OUTCOMES[oc_key]
        delta = statistics.mean(on) - statistics.mean(off)
        if abs(delta) < MIN_EFFECT.get(oc_key, 0):
            continue
        found.append({
            "driver": key, "driver_label": label, "outcome": oc_key, "outcome_label": olabel,
            "when": phrase, "delta": round(delta, dec if dec else 0), "unit": unit,
            "with": round(statistics.mean(on), dec), "without": round(statistics.mean(off), dec),
            "n_with": len(on), "n_without": len(off), "t": round(t, 1),
            "strength": "strong" if abs(t) >= 2.5 else "likely",
            "good": (delta > 0) == better,
            "adjusted_for": [lbl for lbl, _ in stronger] or None,
        })
        accepted.setdefault(oc_key, []).append((label, {d for d, v in series.items() if v >= 0.5}))

    found.sort(key=lambda e: -abs(e["t"]))
    return found[:limit]


# ── 3. events of the week ───────────────────────────────────────────────────

def week_events(conn: sqlite3.Connection, end: date | None = None) -> dict:
    end = end or date.today()
    start = (end - timedelta(days=6)).isoformat()
    t = _tables(conn)
    ev: dict = {}
    if "roster" in t:
        rows = conn.execute("SELECT duty_type, end_time FROM roster WHERE date BETWEEN ? AND ?",
                            (start, end.isoformat())).fetchall()
        ev["duty_days"] = sum(1 for r in rows if r["duty_type"] not in ("day_off", None))
        ev["late_finishes"] = sum(1 for r in rows if r["end_time"] and ":" in r["end_time"]
                                  and (int(r["end_time"][:2]) >= 23 or int(r["end_time"][:2]) <= 5))
    if "trips" in t:
        ev["nights_away"] = conn.execute(
            "SELECT COUNT(*) FROM trips WHERE end_date >= ? AND start_date <= ?", (start, end.isoformat())
        ).fetchone()[0]
    if "plan_sessions" in t:
        r = conn.execute(
            """SELECT SUM(status='completed') AS done, SUM(status IN ('pending','completed','skipped')) AS due
               FROM plan_sessions WHERE session_date BETWEEN ? AND ? AND is_optional=0""",
            (start, (end - timedelta(days=1)).isoformat())).fetchone()
        ev["training_sessions"] = {"done": r["done"] or 0, "planned": r["due"] or 0}
    if "day_tags" in t and "tags" in t:
        ev["tags"] = {r["slug"]: r["n"] for r in conn.execute(
            """SELECT t.slug, COUNT(*) AS n FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE dt.date BETWEEN ? AND ? GROUP BY t.slug ORDER BY n DESC LIMIT 12""",
            (start, end.isoformat()))}
    return ev


# ── storage ─────────────────────────────────────────────────────────────────

def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS life_reviews (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start   TEXT NOT NULL,          -- Monday of the week the actions are for
        review_json  TEXT NOT NULL,
        actions_json TEXT NOT NULL DEFAULT '{}',   -- {index: committed|done|skipped|experiment:<id>}
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    conn.commit()


def default_week(today: date | None = None) -> str:
    """Fri–Sun → the coming week; otherwise the current week."""
    today = today or date.today()
    mon = today - timedelta(days=today.weekday())
    return (mon + timedelta(days=7) if today.weekday() >= 4 else mon).isoformat()


def _row_out(r) -> dict:
    return {"id": r["id"], "week_start": r["week_start"], "created_at": r["created_at"],
            **json.loads(r["review_json"]), "action_status": json.loads(r["actions_json"] or "{}")}


def latest(conn, week_start: str) -> dict | None:
    ensure_table(conn)
    r = conn.execute("SELECT * FROM life_reviews WHERE week_start=? ORDER BY id DESC LIMIT 1",
                     (week_start,)).fetchone()
    return _row_out(r) if r else None


def previous(conn, week_start: str) -> dict | None:
    ensure_table(conn)
    r = conn.execute("SELECT * FROM life_reviews WHERE week_start < ? ORDER BY week_start DESC, id DESC LIMIT 1",
                     (week_start,)).fetchone()
    return _row_out(r) if r else None


# ── the review ──────────────────────────────────────────────────────────────

PROMPT = """You are a sharp, warm personal coach reviewing ONE person's last 7 days from their
self-tracking app. They are an airline pilot (irregular roster, late landings) training for a
312 km cycling event, who also tracks mood, energy, food, money and habits.

You get NUMBERS ALREADY COMPUTED from their data — do not invent any other numbers:
- week_vs_normal: last 7 days vs their previous 8 weeks (z = how unusual; |z|≥1 is notable).
- levers: personal cause→effect patterns over ~6 months: when DRIVER happens, OUTCOME
  (next day / that night / same day) is `with` vs `without`, n_with/n_without days, t-score.
  "strong" = |t|≥2.5. `adjusted_for` lists stronger drivers whose days were excluded, so the
  effect isn't just co-occurrence with them. Associations, but specific and in real units.
- events: duty days, late finishes, nights away, training done/planned, tags used this week.
- last_week: last review's actions and whether they marked them done.

Write for the person ("you"), concrete, no fluff, no generic wellness advice. Prefer the levers
that are strong AND actionable (tags they control, sleep, training timing) over ones they can't
change (the roster itself — but they CAN change what they do around it).

Reply with ONLY this JSON:
{{
  "headline": "max 10 words, the story of the week",
  "summary": "2-3 sentences: how the week went vs normal, citing 1-2 numbers",
  "patterns": [
    {{"title": "short", "evidence": "the numbers, e.g. 'energy 5.9 vs 7.1 the day after (21 vs 140 days)'",
      "strength": "strong|likely"}}
  ],
  "actions": [
    {{"title": "imperative, specific, for this coming week",
      "why": "one sentence tied to a pattern",
      "type": "commit|experiment",
      "experiment": {{"title": "...", "hypothesis": "If I …, then my … will …",
                      "tag": "existing tag slug the person will mark on treatment days, or null",
                      "metric": "one of {metrics}",
                      "days": 14}}
    }}
  ],
  "last_week": "one sentence on last week's commitments, or null if there were none"
}}
2–4 patterns, at most 3 actions (experiment object only when type is experiment).

DATA:
{data}"""


def gather(conn: sqlite3.Connection, week_start: str) -> dict:
    prev = previous(conn, week_start)
    last_week = None
    if prev:
        last_week = [{"title": a.get("title"), "status": prev["action_status"].get(str(i), "not marked")}
                     for i, a in enumerate(prev.get("actions", []))]
    return {
        "today": date.today().isoformat(),
        "week_vs_normal": week_vs_normal(conn),
        "levers": levers(conn),
        "events": week_events(conn),
        "last_week": last_week,
    }


def _validate_actions(conn, actions) -> list[dict]:
    t = _tables(conn)
    tags = {r[0] for r in conn.execute("SELECT slug FROM tags")} if "tags" in t else set()
    out = []
    for a in (actions or [])[:3]:
        if not isinstance(a, dict) or not a.get("title"):
            continue
        clean = {"title": str(a["title"])[:140], "why": str(a.get("why") or "")[:240], "type": "commit"}
        ex = a.get("experiment")
        if a.get("type") == "experiment" and isinstance(ex, dict):
            metric = ex.get("metric") if ex.get("metric") in EXPERIMENT_METRICS else None
            tag = ex.get("tag") if ex.get("tag") in tags else None
            if metric:
                clean["type"] = "experiment"
                clean["experiment"] = {
                    "title": str(ex.get("title") or a["title"])[:120],
                    "hypothesis": str(ex.get("hypothesis") or a.get("why") or "")[:300],
                    "tag": tag, "metric": metric,
                    "days": max(7, min(42, int(ex.get("days") or 14))),
                }
        out.append(clean)
    return out


def generate(conn: sqlite3.Connection, week_start: str | None = None) -> dict | None:
    from domains.ai import ollama_client

    ensure_table(conn)
    week_start = week_start or default_week()
    data = gather(conn, week_start)
    if not data["week_vs_normal"] and not data["levers"]:
        return None
    prompt = PROMPT.format(data=json.dumps(data, separators=(",", ":"), default=str),
                           metrics=", ".join(sorted(EXPERIMENT_METRICS)))
    model = getattr(ollama_client, "CLAUDE_MODEL_SMART", None) if ollama_client.LLM_PROVIDER == "claude" else None
    out = ollama_client.generate_json(prompt, model=model, max_tokens=2500)
    if not isinstance(out, dict):
        return None
    review = {
        "headline": str(out.get("headline") or "")[:120],
        "summary": str(out.get("summary") or "")[:700],
        "patterns": [{"title": str(p.get("title") or "")[:120], "evidence": str(p.get("evidence") or "")[:240],
                      "strength": p.get("strength") if p.get("strength") in ("strong", "likely") else "likely"}
                     for p in (out.get("patterns") or [])[:4] if isinstance(p, dict)],
        "actions": _validate_actions(conn, out.get("actions")),
        "last_week": (str(out["last_week"])[:240] if out.get("last_week") else None),
        # the grounding, stored with the review so the page shows exactly what the AI saw
        "week_vs_normal": data["week_vs_normal"],
        "levers": data["levers"],
        "events": data["events"],
    }
    cur = conn.execute("INSERT INTO life_reviews (week_start, review_json) VALUES (?, ?)",
                       (week_start, json.dumps(review)))
    conn.commit()
    return latest(conn, week_start) if cur.lastrowid else None


def set_action(conn: sqlite3.Connection, review_id: int, index: int, status: str) -> dict:
    """status: committed | done | skipped | experiment (creates the experiment)."""
    ensure_table(conn)
    r = conn.execute("SELECT * FROM life_reviews WHERE id=?", (review_id,)).fetchone()
    if not r:
        raise ValueError("review not found")
    review = json.loads(r["review_json"])
    if not (0 <= index < len(review.get("actions", []))):
        raise ValueError("no such action")
    statuses = json.loads(r["actions_json"] or "{}")
    if status == "experiment":
        a = review["actions"][index]
        ex = a.get("experiment")
        if not ex:
            raise ValueError("this action has no experiment")
        from infrastructure.api.routers.experiments import ExperimentCreate, create_experiment
        start = date.today().isoformat()
        created = create_experiment(ExperimentCreate(
            title=ex["title"], hypothesis=ex["hypothesis"], tag=ex.get("tag"), metric=ex["metric"],
            start_date=start, end_date=_shift(start, ex["days"]),
            protocol=f"From the weekly review: {a['title']}",
        ), conn)
        status = f"experiment:{getattr(created, 'id', None) or (created.get('id') if isinstance(created, dict) else '')}"
    elif status not in ("committed", "done", "skipped"):
        raise ValueError("bad status")
    statuses[str(index)] = status
    conn.execute("UPDATE life_reviews SET actions_json=? WHERE id=?", (json.dumps(statuses), review_id))
    conn.commit()
    return statuses


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Weekly life review")
    p.add_argument("--auto", action="store_true", help="Sundays only, once per week")
    args = p.parse_args()
    today = date.today()
    if args.auto and today.weekday() != 6:
        return
    conn = get_connection()
    try:
        ws = default_week(today)
        if args.auto and latest(conn, ws):
            return
        rev = generate(conn, ws)
        print(f"life review {ws}: {rev['headline'] if rev else 'not generated (no data / LLM unavailable)'}",
              file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
