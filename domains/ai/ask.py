"""
Ask — answer a free-form question about your own data.

Claude gets the schema of all three databases, a short data dictionary, and two
tools: `describe_table` (columns + a few sample rows) and `query` (one read-only
SELECT). It explores as much as it needs, then answers with the numbers it found.
The databases are opened read-only (`mode=ro` + `query_only`), so nothing the model
writes can change your data; queries are capped in time and rows.

Used by infrastructure/api/routers/ask.py. Needs ANTHROPIC_API_KEY (see ollama_client).
"""

import json
import logging
import sqlite3
import time
from datetime import date
from pathlib import Path

from domains.ai import ollama_client

log = logging.getLogger(__name__)

DB_DIR = Path(__file__).parents[2] / "infrastructure" / "db"
ATTACHED = ("money", "locations")      # schema names inside the read-only connection
MAX_ROUNDS = 14                        # tool round-trips before forcing an answer
MAX_ROWS = 200
QUERY_SECONDS = 8
CELL_CHARS = 200
HIDDEN = ("sqlite_", "ask_")           # internal tables the model doesn't need

NOTES = """\
Data dictionary (the non-obvious parts):
- Dates are local ISO 'YYYY-MM-DD' strings; most daily tables key on `date` and join to `days.date`.
- days: the daily questionnaire — mood, energy, stress, sleep_quality (1–10 scales), notes.
  Tags live in day_tags (date, tag_id) → tags (slug, name, is_negative). `days.tags` is legacy, ignore it.
  Negative tags (candy, alcohol…) are things to avoid; others are positive.
- activities: every workout. activity_type e.g. running, cycling, lap_swimming, open_water_swimming,
  indoor_cycling, walking, strength_training, tennis_v2. Rows come from 'garmin' and 'strava';
  the same session can appear twice — drop strava rows whose strava_id is on a garmin row:
  `NOT (source='strava' AND strava_id IN (SELECT strava_id FROM activities WHERE source='garmin' AND strava_id IS NOT NULL))`.
  moving_time_seconds is often NULL — use COALESCE(moving_time_seconds, duration_seconds).
  Distances in metres, speeds in m/s. Strava-only rows often lack heart rate.
- training_load_daily: per (date, sport) with sport in run|ride|swim|other|combined — use 'combined'
  for overall fitness. ctl = fitness (42-day), atl = fatigue (7-day), tsb = form.
- athlete_zones: thresholds over time (ftp_w, threshold_hr, threshold_pace_s_per_km, css_pace_s_per_100m).
- race_goals: target races (race_date, target_time, target_ftp_w…); plan_sessions: the planned
  sessions for a goal (status, completed_activity_id); b_races: secondary races inside a plan.
- injuries: zone, side, pain_scale 0–10, status active|resolved, onset/resolved dates.
- sleep (duration/deep/rem seconds, score), hrv (last_night_avg), daily_stats (steps, resting_hr),
  wellness_daily (stress, body battery), weight_log, intraday_* (per-sample, large — aggregate).
- roster: the airline duty per date (duty_type flying_duty|standby|ground_duty|day_off|vacation);
  flights: flights flown as a pilot (block_seconds, night_seconds, is_sim); passenger_flights: flown as a passenger.
- food_entries: meals with kcal and macros. tasks, goals, tracked_habits: planning.
- money.transactions (attached as `money`): amount, category, transaction_type Expense|Income|Transfer|Finance;
  deleted_at NOT NULL means deleted. Data since Sep 2025. money.holdings: investments.
- locations.* (attached as `locations`): visits, location_days (where you were each day), movements.
"""

GUIDE = """\
You are the analyst inside Daybook, a personal life-logging app. The person asking owns all of this
data — it is their own training, health, work and money history. Today is {today}.

How to work:
- Look before you answer: run queries to get the actual numbers. Aggregate in SQL; never guess a figure.
- Prefer a few well-aimed queries over many small ones. Large tables (intraday_*, activity_streams,
  overland_locations) must be aggregated or filtered by date.
- Write SQLite. Attached schemas are addressed as money.<table> and locations.<table>.

How to answer:
- Lead with the direct answer (yes / no / the number), then the evidence as short bullets or a small
  table, then what it means for them. Be concrete and honest, including when the data says no.
- When the question needs knowledge beyond the data (e.g. what an Ironman demands), combine both and
  say which part is which.
- Name caveats briefly (missing data, duplicates, small samples). Markdown, no headings above ###.
- Answer in the language of the question.
"""

TOOLS = [
    {
        "name": "describe_table",
        "description": "Show a table's CREATE statement and 3 sample rows. Use schema-qualified names "
                       "for attached databases (money.transactions).",
        "input_schema": {
            "type": "object",
            "properties": {"table": {"type": "string"}},
            "required": ["table"],
        },
    },
    {
        "name": "query",
        "description": f"Run ONE read-only SQLite SELECT (or WITH … SELECT). Returns at most {MAX_ROWS} "
                       f"rows; long text is cut. Times out after {QUERY_SECONDS}s.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string"},
                "purpose": {"type": "string", "description": "A few words on what this query checks."},
            },
            "required": ["sql"],
        },
    },
]


# ─── Read-only access ──────────────────────────────────────────────────────────

def connect_ro(db_dir: Path = DB_DIR) -> sqlite3.Connection:
    """daybook.db with money.db and locations.db attached, all read-only."""
    conn = sqlite3.connect(f"file:{db_dir / 'daybook.db'}?mode=ro", uri=True, check_same_thread=False)
    conn.execute("PRAGMA query_only = ON")
    for name in ATTACHED:
        path = db_dir / f"{name}.db"
        if path.exists() and path.stat().st_size > 0:
            conn.execute(f"ATTACH DATABASE ? AS {name}", (f"file:{path}?mode=ro",))
    return conn


def _schemas(conn) -> list[str]:
    return [r[1] for r in conn.execute("PRAGMA database_list") if r[1] != "temp"]


def schema_outline(conn) -> str:
    """Every table as `name(col, col, …)`, grouped by database."""
    out = []
    for schema in _schemas(conn):
        tables = [r[0] for r in conn.execute(
            f"SELECT name FROM {schema}.sqlite_master WHERE type='table' ORDER BY name")]
        lines = []
        for t in tables:
            if t.startswith(HIDDEN) or "_fts" in t:
                continue
            cols = [r[1] for r in conn.execute(f'PRAGMA {schema}.table_info("{t}")')]
            prefix = "" if schema == "main" else f"{schema}."
            lines.append(f"{prefix}{t}({', '.join(cols)})")
        out.append(f"[{schema}]\n" + "\n".join(lines))
    return "\n\n".join(out)


def _cell(v):
    if isinstance(v, bytes):
        return "<blob>"
    if isinstance(v, float):
        return round(v, 4)
    if isinstance(v, str) and len(v) > CELL_CHARS:
        return v[:CELL_CHARS] + "…"
    return v


def clean_sql(sql: str) -> str:
    """One SELECT statement, or raise ValueError with a reason the model can act on."""
    s = (sql or "").strip().rstrip(";").strip()
    if not s:
        raise ValueError("empty query")
    if ";" in s:
        raise ValueError("one statement per query")
    head = s.split(None, 1)[0].lower()
    if head not in ("select", "with"):
        raise ValueError("only SELECT / WITH queries are allowed")
    return s


def run_query(conn, sql: str) -> dict:
    s = clean_sql(sql)
    deadline = time.monotonic() + QUERY_SECONDS
    conn.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 10_000)
    try:
        cur = conn.execute(s)
        cols = [d[0] for d in cur.description or []]
        rows = cur.fetchmany(MAX_ROWS + 1)
    except sqlite3.OperationalError as e:
        if "interrupted" in str(e):
            raise ValueError(f"query took longer than {QUERY_SECONDS}s — filter or aggregate more")
        raise
    finally:
        conn.set_progress_handler(None, 0)
    return {
        "columns": cols,
        "rows": [[_cell(v) for v in r] for r in rows[:MAX_ROWS]],
        "truncated": len(rows) > MAX_ROWS,
    }


def describe(conn, table: str) -> dict:
    schema, _, name = table.rpartition(".")
    schema = schema or "main"
    if schema not in _schemas(conn) or not name.replace("_", "").isalnum():
        raise ValueError(f"unknown table {table}")
    row = conn.execute(f"SELECT sql FROM {schema}.sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
    if not row:
        raise ValueError(f"unknown table {table}")
    sample = run_query(conn, f'SELECT * FROM {schema}."{name}" LIMIT 3')
    return {"create": row[0], "sample": sample}


# ─── The conversation ──────────────────────────────────────────────────────────

def _client():
    if not ollama_client.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set on the Pi")
    import anthropic
    return anthropic.Anthropic(api_key=ollama_client.ANTHROPIC_API_KEY, timeout=120)


def _system(ro, today: date) -> list[dict]:
    # The schema is the bulky, stable part — cached across rounds and questions.
    return [
        {"type": "text", "text": GUIDE.format(today=today.isoformat())},
        {"type": "text", "text": NOTES + "\nSchema:\n" + schema_outline(ro),
         "cache_control": {"type": "ephemeral"}},
    ]


def _run_tool(ro, name: str, args: dict) -> tuple[str, dict | None]:
    """Execute one tool call → (result text for the model, log entry for the UI)."""
    try:
        if name == "describe_table":
            return json.dumps(describe(ro, args.get("table", "")), default=str), None
        if name == "query":
            res = run_query(ro, args.get("sql", ""))
            entry = {"sql": args.get("sql", "").strip(), "purpose": args.get("purpose"),
                     "rows": len(res["rows"])}
            return json.dumps(res, default=str), entry
        return f"unknown tool {name}", None
    except (ValueError, sqlite3.Error) as e:
        entry = {"sql": args.get("sql", "").strip(), "purpose": args.get("purpose"), "error": str(e)} \
            if name == "query" else None
        return f"error: {e}", entry


def answer(question: str, history: list[dict] | None = None, *, ro=None, client=None,
           model: str | None = None, today: date | None = None) -> dict:
    """
    Answer `question`, given earlier turns as [{role, content}] (plain text).
    Returns {answer, queries: [{sql, purpose, rows | error}]}.
    """
    own = ro is None
    ro = ro or connect_ro()
    client = client or _client()
    model = model or ollama_client.CLAUDE_MODEL_SMART
    try:
        messages = [{"role": m["role"], "content": m["content"]} for m in (history or [])]
        messages.append({"role": "user", "content": question})
        system = _system(ro, today or date.today())
        queries: list[dict] = []

        for round_no in range(MAX_ROUNDS + 1):
            last = round_no == MAX_ROUNDS
            kwargs = {"model": model, "max_tokens": 12000, "system": system,
                      "messages": messages, "tools": TOOLS}
            if last:
                kwargs["tool_choice"] = {"type": "none"}
            resp = client.messages.create(**kwargs)
            calls = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
            if not calls or last:
                text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
                return {"answer": text or "I couldn't put an answer together — try rephrasing.",
                        "queries": queries}
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for c in calls:
                out, entry = _run_tool(ro, c.name, c.input or {})
                if entry:
                    queries.append(entry)
                results.append({"type": "tool_result", "tool_use_id": c.id, "content": out})
            messages.append({"role": "user", "content": results})
        raise AssertionError("unreachable")
    finally:
        if own:
            ro.close()


# ─── Threads (stored in the writable daybook.db) ───────────────────────────────

def ask(conn, question: str, thread_id: int | None = None, **kw) -> dict:
    """Answer and store the turn. Returns the thread with all its messages."""
    question = question.strip()
    history = []
    if thread_id is not None:
        if not conn.execute("SELECT 1 FROM ask_threads WHERE id=?", (thread_id,)).fetchone():
            raise LookupError(thread_id)
        history = [{"role": r["role"], "content": r["content"]} for r in conn.execute(
            "SELECT role, content FROM ask_messages WHERE thread_id=? ORDER BY id", (thread_id,))]
    out = answer(question, history, **kw)

    if thread_id is None:
        title = question if len(question) <= 90 else question[:87] + "…"
        thread_id = conn.execute("INSERT INTO ask_threads (title) VALUES (?)", (title,)).lastrowid
    conn.execute("INSERT INTO ask_messages (thread_id, role, content) VALUES (?, 'user', ?)",
                 (thread_id, question))
    conn.execute("INSERT INTO ask_messages (thread_id, role, content, queries_json) VALUES (?, 'assistant', ?, ?)",
                 (thread_id, out["answer"], json.dumps(out["queries"])))
    conn.execute("UPDATE ask_threads SET updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (thread_id,))
    conn.commit()
    return thread(conn, thread_id)


def threads(conn, limit: int = 30) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT t.id, t.title, t.updated_at, COUNT(m.id) / 2 AS turns FROM ask_threads t "
        "LEFT JOIN ask_messages m ON m.thread_id = t.id GROUP BY t.id ORDER BY t.updated_at DESC, t.id DESC LIMIT ?",
        (limit,))]


def thread(conn, thread_id: int) -> dict | None:
    t = conn.execute("SELECT id, title, created_at, updated_at FROM ask_threads WHERE id=?", (thread_id,)).fetchone()
    if not t:
        return None
    msgs = []
    for r in conn.execute("SELECT id, role, content, queries_json, created_at FROM ask_messages "
                          "WHERE thread_id=? ORDER BY id", (thread_id,)):
        m = dict(r)
        m["queries"] = json.loads(m.pop("queries_json") or "[]")
        msgs.append(m)
    return {**dict(t), "messages": msgs}


def delete_thread(conn, thread_id: int) -> bool:
    conn.execute("DELETE FROM ask_messages WHERE thread_id=?", (thread_id,))
    n = conn.execute("DELETE FROM ask_threads WHERE id=?", (thread_id,)).rowcount
    conn.commit()
    return n > 0
