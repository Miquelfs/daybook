"""
Add structured-workout support to plan_sessions and a benchmark_results table.

- plan_sessions.structure_json: optional JSON array of workout steps
  (warm-up / main set / cool-down) with zone-relative targets. Numeric paces/
  watts/CSS are resolved at render time from athlete_zones, so a re-test
  propagates to every future session automatically.
- benchmark_results: history of monthly field tests (run 1k TT, bike 20-min,
  swim CSS) whose derived thresholds feed athlete_zones.

Idempotent. Run: python -m infrastructure.db.migrate_plan_session_structure
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(plan_sessions)")}
    if "structure_json" not in cols:
        conn.execute("ALTER TABLE plan_sessions ADD COLUMN structure_json TEXT")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS benchmark_results (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            date         TEXT NOT NULL,
            sport        TEXT NOT NULL,          -- run | ride | swim
            test_type    TEXT NOT NULL,          -- run_1k_tt | bike_20min | swim_css
            result_json  TEXT NOT NULL,          -- raw measured inputs
            derived_json TEXT,                    -- computed thresholds + zone deltas
            session_id   INTEGER REFERENCES plan_sessions(id) ON DELETE SET NULL,
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_benchmark_results_sport ON benchmark_results(sport, date);
    """)
    conn.commit()
    print("plan_sessions.structure_json + benchmark_results ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
