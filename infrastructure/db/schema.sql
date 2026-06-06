-- Daybook schema
-- All tables join on date (TEXT, ISO format YYYY-MM-DD).
-- SQLite doesn't enforce FK constraints by default; enabled via PRAGMA foreign_keys=ON in connection.py.
-- All raw API payloads stored in raw_payload for future re-parsing without re-fetching.

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
    tags              TEXT,                        -- comma-separated (e.g. "work,si:4")
    alcohol           INTEGER,                     -- drinks count (0 = none)
    social            BOOLEAN,                     -- meaningful social time
    outdoors          BOOLEAN,                     -- meaningful outdoor time
    photo_path        TEXT,                        -- relative path to photo of the day
    -- aviation context
    duty_day          BOOLEAN NOT NULL DEFAULT 0,
    away_from_base    BOOLEAN NOT NULL DEFAULT 0,
    timezone_offset   INTEGER,                     -- minutes from UTC
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─── Health: Garmin daily wellness ───────────────────────────────────────────

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
    raw_payload       TEXT
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
    raw_payload           TEXT
);

CREATE TABLE IF NOT EXISTS hrv (
    date              TEXT PRIMARY KEY,
    last_night_avg    REAL,
    weekly_avg        REAL,
    status            TEXT,
    raw_payload       TEXT
);

-- ─── Activities ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activities (
    id                      TEXT PRIMARY KEY,   -- "{source}_{native_id}", e.g. "garmin_19284756"
    date                    TEXT NOT NULL,       -- ISO date, joins to days.date
    source                  TEXT NOT NULL,       -- 'garmin' | 'strava' | 'manual'
    strava_id               TEXT,               -- cross-reference if activity exists in both
    activity_type           TEXT,               -- run, ride, hike, swim, walk, etc.
    name                    TEXT,
    start_time              TEXT,               -- ISO 8601 with timezone
    duration_seconds        INTEGER,
    moving_time_seconds     INTEGER,
    distance_meters         REAL,
    elevation_gain_meters   REAL,
    avg_heart_rate          INTEGER,
    max_heart_rate          INTEGER,
    avg_speed_mps           REAL,
    avg_power_watts         INTEGER,
    calories                INTEGER,
    training_stress_score   REAL,
    polyline                TEXT,               -- encoded GPS path (Google polyline format)
    start_lat               REAL,
    start_lng               REAL,
    raw_payload             TEXT NOT NULL DEFAULT '{}',
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (date) REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_activities_date   ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_type   ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_source ON activities(source);

-- Per-second data streams for activities (heart_rate, altitude, velocity, cadence, etc.)
CREATE TABLE IF NOT EXISTS activity_streams (
    activity_id  TEXT NOT NULL,
    stream_type  TEXT NOT NULL,
    data_json    TEXT NOT NULL,   -- JSON array of per-second values
    PRIMARY KEY (activity_id, stream_type),
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- ─── Segments (Strava-replacement) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS segments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL,
    activity_type         TEXT,                   -- run, ride
    polyline              TEXT NOT NULL,
    distance_meters       REAL,
    elevation_gain_meters REAL,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    source                TEXT NOT NULL,           -- 'manual' | 'strava'
    strava_segment_id     TEXT                    -- nullable
);

CREATE TABLE IF NOT EXISTS segment_efforts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id          INTEGER NOT NULL,
    activity_id         TEXT NOT NULL,
    date                TEXT NOT NULL,
    duration_seconds    INTEGER NOT NULL,
    avg_heart_rate      INTEGER,
    avg_power_watts     INTEGER,
    is_personal_record  INTEGER DEFAULT 0,
    FOREIGN KEY (segment_id)  REFERENCES segments(id),
    FOREIGN KEY (activity_id) REFERENCES activities(id),
    FOREIGN KEY (date)        REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_segment_efforts_segment ON segment_efforts(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_efforts_date    ON segment_efforts(date);

-- ─── People / Companions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    emoji   TEXT,
    group_  TEXT                        -- "family", "friends", "partner", etc.
);

CREATE TABLE IF NOT EXISTS day_companions (
    date       TEXT NOT NULL,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (date, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_day_companions_date ON day_companions(date);

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

-- Live heartbeat per source — updated on every sync attempt.
CREATE TABLE IF NOT EXISTS sync_status (
    source           TEXT PRIMARY KEY,           -- 'garmin' | 'strava'
    last_attempt_at  TEXT NOT NULL,
    last_success_at  TEXT,
    last_error       TEXT,
    records_synced   INTEGER DEFAULT 0
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sleep_date         ON sleep(date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date   ON daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_hrv_date           ON hrv(date);
CREATE INDEX IF NOT EXISTS idx_sync_log_run_at    ON sync_log(run_at);

-- ─── Tags ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY,
    slug       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    icon       TEXT,
    category   TEXT NOT NULL,   -- activity|social|work|health|location|emotion|environment
    color      TEXT,
    is_system  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS day_tags (
    date       TEXT NOT NULL,
    tag_id     INTEGER NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, tag_id),
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_day_tags_date   ON day_tags(date);
CREATE INDEX IF NOT EXISTS idx_day_tags_tag_id ON day_tags(tag_id);

-- mood_note TEXT and morning_note TEXT added to days via migrate_tags.py

-- ─── Weather ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weather (
    date            TEXT PRIMARY KEY,
    temp_min        REAL,           -- °C
    temp_max        REAL,           -- °C
    temp_mean       REAL,           -- °C
    precipitation   REAL,           -- mm
    wind_speed_max  REAL,           -- km/h
    weather_code    INTEGER,        -- WMO code
    condition       TEXT,           -- sunny|cloudy|rainy|stormy|snowy|foggy
    raw_payload     TEXT,
    fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_weather_date ON weather(date);

-- ─── Screen Time ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS screen_time (
    date            TEXT PRIMARY KEY,
    total_minutes   REAL,           -- total screen-on minutes for the day
    unlocks         INTEGER,        -- number of device unlocks
    top_app         TEXT,           -- bundle_id of most-used app
    top_app_name    TEXT,           -- human name of most-used app
    top_app_minutes REAL,           -- minutes on top app
    raw_payload     TEXT,           -- full JSON for re-parsing
    synced_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS screen_app_usage (
    date        TEXT NOT NULL,
    bundle_id   TEXT NOT NULL,
    app_name    TEXT,
    minutes     REAL,
    PRIMARY KEY (date, bundle_id)
);

CREATE INDEX IF NOT EXISTS idx_screen_app_date ON screen_app_usage(date);

-- ─── Books ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS books (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    author          TEXT NOT NULL,
    date_finished   TEXT,           -- YYYY-MM-DD, NULL = currently reading / wishlist
    genre           TEXT,
    language        TEXT,
    location        TEXT,           -- where they were reading it
    ownership       TEXT,           -- 'own' | 'kindle' | 'library'
    pages           INTEGER,
    rating          INTEGER,        -- 1–5, NULL = unrated
    notes           TEXT,
    gift_from       TEXT,           -- person name, NULL if not a gift
    cover_url       TEXT,           -- cached URL from Open Library / Google Books
    isbn            TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_books_date_finished ON books(date_finished);
CREATE INDEX IF NOT EXISTS idx_books_author        ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_genre         ON books(genre);

-- ─── Life in Weeks ────────────────────────────────────────────────────────────

-- Single-row user profile. id is locked to 1 via CHECK.
-- Upsert: INSERT OR REPLACE INTO user_profile (id, birthdate, ...) VALUES (1, ...).
CREATE TABLE IF NOT EXISTS user_profile (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    birthdate     TEXT NOT NULL,    -- YYYY-MM-DD; anchors the 90×52 grid
    display_name  TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Colored fills spanning many weeks. Each cell supports three simultaneous layers:
-- main (dominant fill), top_stripe (1.5px top overlay), bottom_stripe (1.5px bottom overlay).
-- Overlap enforcement is application-level (auto-cap): when a new period is inserted,
-- any existing period on the same layer whose range overlaps is capped at new_start_date − 1 day.
CREATE TABLE IF NOT EXISTS life_periods (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL,
    category    TEXT NOT NULL,               -- education|work|aviation|relationship|location|health|other
    layer       TEXT NOT NULL DEFAULT 'main',-- main|top_stripe|bottom_stripe
    color       TEXT NOT NULL,               -- Tailwind ramp+stop, e.g. "blue-400"
    start_date  TEXT NOT NULL,               -- YYYY-MM-DD
    end_date    TEXT,                        -- YYYY-MM-DD, NULL = ongoing
    notes       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,  -- tiebreak at exact boundaries
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK (category IN ('education','work','aviation','relationship','location','health','other')),
    CHECK (layer    IN ('main','top_stripe','bottom_stripe'))
);

CREATE INDEX IF NOT EXISTS idx_life_periods_start ON life_periods(start_date);
CREATE INDEX IF NOT EXISTS idx_life_periods_end   ON life_periods(end_date);
CREATE INDEX IF NOT EXISTS idx_life_periods_layer ON life_periods(layer);

-- Single-week pins rendered as dots/icons on top of period fills.
-- event_date is the raw date of the event; week-cell assignment is computed at query time.
-- Multiple events in the same week are valid; tooltip lists them all.
-- Photos stored under data/photos/life_events/{id}.jpg.
CREATE TABLE IF NOT EXISTS life_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_date  TEXT NOT NULL,   -- YYYY-MM-DD raw
    label       TEXT NOT NULL,
    type        TEXT NOT NULL,   -- career|relationship|travel|loss|achievement|other
    notes       TEXT,
    photo_path  TEXT,            -- relative path under data/photos/, e.g. "life_events/42.jpg"
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK (type IN ('career','relationship','travel','loss','achievement','other'))
);

CREATE INDEX IF NOT EXISTS idx_life_events_date ON life_events(event_date);

-- ─── Aviation Logbook ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS airports (
    icao         TEXT PRIMARY KEY,
    iata         TEXT,
    name         TEXT,
    city         TEXT,
    country      TEXT,
    latitude     REAL,
    longitude    REAL,
    elevation_ft INTEGER,
    timezone     TEXT
);

CREATE INDEX IF NOT EXISTS idx_airports_iata    ON airports(iata);
CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country);

CREATE TABLE IF NOT EXISTS flights (
    id                  TEXT PRIMARY KEY,       -- "{source}_{native_id}"
    date                TEXT NOT NULL,          -- YYYY-MM-DD, joins to days.date
    source              TEXT NOT NULL,          -- 'full_csv' | 'aerolink' | 'manual'
    raw_payload         TEXT NOT NULL DEFAULT '{}',

    -- Route
    dep_icao            TEXT,
    arr_icao            TEXT,
    dep_iata            TEXT,
    arr_iata            TEXT,

    -- Times (ISO 8601 UTC)
    off_block_utc       TEXT,
    takeoff_utc         TEXT,
    landing_utc         TEXT,
    on_block_utc        TEXT,
    block_seconds       INTEGER,               -- off_block → on_block (primary logbook metric)
    airborne_seconds    INTEGER,               -- takeoff → landing

    -- Identity
    flight_number       TEXT,
    aircraft_reg        TEXT,
    aircraft_type       TEXT,
    operator            TEXT,

    -- Crew
    crew_role           TEXT,                  -- 'pic' | 'first_officer' | 'other'
    pic_name            TEXT,                  -- PIC name (manually entered or imported)
    takeoff_crew        TEXT,                  -- raw crew code who flew the T/O
    landing_crew        TEXT,                  -- raw crew code who flew the landing
    is_sim              INTEGER NOT NULL DEFAULT 0,
    sim_type            TEXT,                  -- 'FNPTII' | 'FFS' | etc.

    -- Derived logbook columns (seconds)
    pic_seconds         INTEGER NOT NULL DEFAULT 0,
    sic_seconds         INTEGER NOT NULL DEFAULT 0,
    night_seconds       INTEGER NOT NULL DEFAULT 0,
    ifr_seconds         INTEGER NOT NULL DEFAULT 0,
    distance_nm         REAL,

    -- Pax & cargo
    pax_total           INTEGER,
    pax_adult           INTEGER,
    pax_child           INTEGER,
    pax_infant          INTEGER,
    freight_kg          REAL,
    baggage_kg          REAL,

    -- Fuel (kg)
    fuel_block_kg       REAL,
    fuel_trip_kg        REAL,
    fuel_reserves_kg    REAL,
    fuel_uplift_kg      REAL,
    fuel_burn_kg        REAL,
    fuel_burn_diff_kg   REAL,

    -- Ops
    delay_minutes       INTEGER,
    delay_code          TEXT,
    delay_reason        TEXT,

    -- Personal takeoffs/landings (only when pilot performed the manoeuvre)
    takeoffs_day        INTEGER NOT NULL DEFAULT 0,
    takeoffs_night      INTEGER NOT NULL DEFAULT 0,
    landings_day        INTEGER NOT NULL DEFAULT 0,
    landings_night      INTEGER NOT NULL DEFAULT 0,

    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (date)     REFERENCES days(date),
    FOREIGN KEY (dep_icao) REFERENCES airports(icao),
    FOREIGN KEY (arr_icao) REFERENCES airports(icao)
);

CREATE INDEX IF NOT EXISTS idx_flights_date   ON flights(date);
CREATE INDEX IF NOT EXISTS idx_flights_dep    ON flights(dep_icao);
CREATE INDEX IF NOT EXISTS idx_flights_arr    ON flights(arr_icao);
CREATE INDEX IF NOT EXISTS idx_flights_type   ON flights(aircraft_type);
CREATE INDEX IF NOT EXISTS idx_flights_role   ON flights(crew_role);
CREATE INDEX IF NOT EXISTS idx_flights_source ON flights(source);

-- ─── Insights: precomputed correlation snapshots ──────────────────────────────

CREATE TABLE IF NOT EXISTS correlation_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    computed_at  TEXT NOT NULL,          -- ISO datetime of run
    window_days  INTEGER NOT NULL,       -- 90 or 180
    metric_a     TEXT NOT NULL,
    metric_b     TEXT NOT NULL,
    r            REAL,
    p_value      REAL,
    n            INTEGER,
    lag          INTEGER DEFAULT 0,      -- 0 = same-day, 1 = metric_a[t] vs metric_b[t+1]
    is_new       INTEGER DEFAULT 0,      -- 1 if not present in prior snapshot
    r_prev       REAL,                   -- r from prior snapshot (NULL if new)
    UNIQUE(computed_at, metric_a, metric_b, lag, window_days)
);
CREATE INDEX IF NOT EXISTS idx_corr_snap_date ON correlation_snapshots(computed_at);
