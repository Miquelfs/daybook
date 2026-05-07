-- Daybook schema
-- All tables join on date (TEXT, ISO format YYYY-MM-DD).
-- SQLite doesn't enforce FK constraints by default; enable via PRAGMA foreign_keys=ON in connection.py.
-- All raw API payloads stored in raw_json for future re-parsing without re-fetching.

-- ─── Spine ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS days (
    date              TEXT PRIMARY KEY,            -- YYYY-MM-DD
    -- subjective state (evening questionnaire)
    energy            INTEGER,                     -- 1-10
    mood              INTEGER,                     -- 1-10
    stress            INTEGER,                     -- 1-10
    sleep_quality     INTEGER,                     -- 1-10 (subjective, not Garmin)
    notes             TEXT,
    daily_question    TEXT,
    daily_answer      TEXT,
    tags              TEXT,                        -- comma-separated
    -- aviation context
    duty_day          BOOLEAN NOT NULL DEFAULT 0,
    away_from_base    BOOLEAN NOT NULL DEFAULT 0,
    timezone_offset   INTEGER,                     -- minutes from UTC
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─── Health: Garmin ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sleep (
    date              TEXT PRIMARY KEY,
    duration_seconds  INTEGER,
    deep_seconds      INTEGER,
    light_seconds     INTEGER,
    rem_seconds       INTEGER,
    awake_seconds     INTEGER,
    avg_hrv           REAL,
    avg_spo2          REAL,
    score             INTEGER,
    raw_json          TEXT
);

CREATE TABLE IF NOT EXISTS daily_stats (
    date                  TEXT PRIMARY KEY,
    steps                 INTEGER,
    active_calories       INTEGER,
    total_calories        INTEGER,
    resting_hr            INTEGER,
    stress_avg            INTEGER,
    body_battery_low      INTEGER,
    body_battery_high     INTEGER,
    raw_json              TEXT
);

CREATE TABLE IF NOT EXISTS hrv (
    date              TEXT PRIMARY KEY,
    last_night_avg    REAL,
    weekly_avg        REAL,
    status            TEXT,
    raw_json          TEXT
);

CREATE TABLE IF NOT EXISTS activities (
    activity_id       TEXT PRIMARY KEY,
    date              TEXT NOT NULL,
    type              TEXT,
    name              TEXT,
    start_time        TEXT,
    duration_seconds  INTEGER,
    distance_meters   REAL,
    avg_hr            INTEGER,
    max_hr            INTEGER,
    calories          INTEGER,
    elevation_gain    REAL,
    raw_json          TEXT
);

-- ─── Sync metadata ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL,               -- e.g. "garmin"
    data_type       TEXT NOT NULL,               -- e.g. "sleep"
    run_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status          TEXT NOT NULL,               -- "ok" | "error" | "skipped"
    records_synced  INTEGER NOT NULL DEFAULT 0,
    error           TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sleep_date         ON sleep(date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date   ON daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_hrv_date           ON hrv(date);
CREATE INDEX IF NOT EXISTS idx_activities_date    ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_start   ON activities(start_time);
CREATE INDEX IF NOT EXISTS idx_sync_log_run_at    ON sync_log(run_at);
