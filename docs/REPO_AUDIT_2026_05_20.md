# Daybook Repository Audit — 2026-05-20

Auditor: Claude Sonnet 4.6  
Date: 2026-05-18 (file named for scheduled review date)  
Scope: Full read-only survey of `/Users/miquelfarre/Desktop/daybook/` plus comparison against `docs/GARMIN_STRAVA_INTEGRATION.md`.

---

## 1. Actual Directory Structure

```
daybook/
├── .claude/settings.json
├── .env                          # live credentials (git-ignored)
├── .env.example
├── .gitignore
├── .venv/                        # Python 3.13.1 virtualenv
├── CHANGELOG.md
├── CLAUDE.md
├── Makefile                      # full orchestration (setup → deploy)
├── README.md
├── __init__.py
├── daybook.egg-info/
├── pyproject.toml
├── requirements.txt
│
├── data/
│   ├── backups/                  # 4 gzip snapshots (daybook + locations, 2026-05-07)
│   ├── photos/                   # EMPTY
│   └── raw/
│       ├── garmin/               # 100+ JSON files (sleep/, daily_stats/, hrv/, activities/)
│       ├── garmin_session/       # session.json + garmin_tokens.json
│       └── locations/            # EMPTY
│
├── docs/
│   ├── DECISIONS.md
│   ├── GARMIN_STRAVA_INTEGRATION.md
│   ├── MIGRATION.md
│   ├── PHONE_SETUP.md
│   └── VISION.md
│
├── domains/
│   ├── aviation/                 # EMPTY
│   ├── health/
│   │   ├── garmin/               # garmin_client.py, garmin_sync.py, garmin_verify.py, import_raw.py
│   │   └── strava/               # EMPTY
│   ├── locations/                # geocode_tracks.py, import_tracks.py, locations_query.py, overland_process.py
│   ├── memory/                   # EMPTY
│   ├── money/                    # money_config.py, money_db.py, notion_sync.py
│   └── personal/                 # EMPTY
│
├── insights/
│   ├── anomalies/                # EMPTY
│   ├── correlations/             # EMPTY
│   └── reviews/                  # EMPTY
│
├── infrastructure/
│   ├── api/
│   │   ├── main.py
│   │   ├── db.py, db_money.py
│   │   ├── run.sh
│   │   ├── models/               # day.py, money.py
│   │   ├── routers/              # contacts.py, days.py, insights.py, locations.py, money.py, questionnaire.py
│   │   └── questionnaire/        # questions.py
│   ├── db/
│   │   ├── schema.sql            # canonical schema definition
│   │   ├── money_schema.sql
│   │   ├── connection.py, money_connection.py
│   │   ├── init_db.py, backfill_days.py, migrate_questionnaire.py
│   │   ├── daybook.db            # 50.6 MB — 5,976 days, 5,973 sleep rows, 350 activities
│   │   ├── locations.db          # 28.6 MB
│   │   └── money.db              # 512 KB
│   ├── docker/                   # EMPTY
│   ├── scripts/
│   │   ├── backup.sh
│   │   ├── daily_sync.sh         # Garmin + Overland + Notion; run via cron
│   │   ├── sync_log_tail.py
│   │   └── logs/                 # EMPTY (cron not installed on this machine)
│   ├── systemd/
│   │   ├── daybook-api.service
│   │   └── daybook-web.service
│   └── web/                      # Next.js App Router + TanStack Query
│       ├── app/                  # layout, page, globals.css, providers
│       │   ├── api/              # Next.js proxy routes (days, health, money, photos)
│       │   ├── day/[date]/
│       │   ├── explore/
│       │   ├── moments/
│       │   ├── money/            # overview/, portfolio/, trends/
│       │   └── timeline/
│       ├── components/           # 12 general + 13 money-specific components
│       └── lib/                  # api.ts, money-api.ts
```

---

## 2. Schema File vs. Live Database

### Canonical schema file: `infrastructure/db/schema.sql`

Tables defined:

| Table | Primary key | Notes |
|---|---|---|
| `days` | `date TEXT` | Spine — includes `photo_path`, `alcohol`, `social`, `outdoors`, `duty_day`, `away_from_base`, `timezone_offset` |
| `sleep` | `date TEXT` | Garmin sleep detail |
| `daily_stats` | `date TEXT` | Steps, HR, stress, body battery |
| `hrv` | `date TEXT` | HRV last-night avg + weekly avg |
| `activities` | `activity_id TEXT` | Garmin activities (lightweight — no polyline, no `source` prefix, no `raw_payload`) |
| `contacts` | `id INTEGER` | People |
| `day_companions` | `(date, contact_id)` | Who was present |
| `sync_log` | `id INTEGER` | Append-only sync audit |

### Live database: `sqlite3 daybook.db ".schema"`

**Matches the schema file with two differences:**

1. **Column order drift in `days`:** `photo_path`, `alcohol`, `social`, `outdoors` were added via `ALTER TABLE` after initial creation (they appear as a trailing `, col TYPE` fragment at the end of the `CREATE TABLE` statement rather than inline). Functionally identical; cosmetically messy.

2. **No schema drift beyond the above.** All 8 tables from `schema.sql` are present in the live DB. No extra tables, no missing tables.

### Row counts (as of audit date)

| Table | Rows | Date range |
|---|---|---|
| `days` | 5,976 | 2010-01-01 → 2026-05-12 |
| `sleep` | 5,973 | 2010-01-01 → 2026-05-09 |
| `daily_stats` | (not queried separately) | — |
| `hrv` | (not queried separately) | — |
| `activities` | 350 | — |

### Missing from the live DB (present only in the integration vision)

The `GARMIN_STRAVA_INTEGRATION.md` document defines five additional tables that **do not exist** in the live database:

| Table | Purpose |
|---|---|
| `activity_streams` | Per-second GPS/HR/power stream data |
| `segments` | User-defined or Strava-imported route segments |
| `segment_efforts` | Per-activity effort times on each segment |
| `sync_status` | Live heartbeat per sync source |

The existing `activities` table also diverges significantly from the vision schema (see Section 8).

---

## 3. Docker, Containers, Cron

### Docker

- `infrastructure/docker/` exists but is **completely empty**. No `docker-compose.yml`, no `Dockerfile`.
- `docker ps -a` returns no output — Docker is not running or not available on this machine.
- The project does not use Docker. Services are run directly via `uvicorn` (API) and `next start` (web), managed by systemd on the Pi.

### Cron

- `crontab -l` returns **no crontab** on this development machine.
- The Makefile has a `cron-install` target that would install: `0 * * * * cd ~/daybook && infrastructure/scripts/daily_sync.sh` (every hour).
- `infrastructure/scripts/daily_sync.sh` exists and handles Garmin + Overland + Notion syncs with proper logging and error trapping.
- Cron is presumably configured on the Pi separately; it is not active here.

---

## 4. Python Environment

### Python version

```
Python 3.13.1
Location: /Library/Frameworks/Python.framework/Versions/3.13/bin/python3
```

### Virtual environment

- **Present** at `daybook/.venv/` (standard `python -m venv`).
- All Makefile targets use `$(VENV)/bin/python` — correctly isolated.

### `requirements.txt` (13 packages)

```
garminconnect
python-dotenv
pandas
requests
fastapi
uvicorn[standard]
python-multipart
pydantic
scipy
numpy
tqdm
Pillow
pillow-heif
```

### Notable absences from requirements.txt

| Missing | Needed for |
|---|---|
| `stravalib` or `stravalib2` | Strava API (Phase D of integration vision) |
| `polyline` | Encoding/decoding GPS polylines for activity maps |
| `geojson` | GeoJSON output for map rendering |
| `shapely` | Segment matching / spatial queries |
| `fitparse` | Manual FIT file import (fallback source) |

### Installed in venv (key packages verified)

| Package | Version |
|---|---|
| `fastapi` | 0.136.1 |
| `garminconnect` | 0.3.3 |
| `pandas` | 3.0.2 |
| `uvicorn` | 0.46.0 |

---

## 5. Directory Inventory

### Has content

| Directory | What's there |
|---|---|
| `domains/health/garmin/` | `garmin_client.py`, `garmin_sync.py`, `garmin_verify.py`, `import_raw.py` |
| `domains/locations/` | `geocode_tracks.py`, `import_tracks.py`, `locations_query.py`, `overland_process.py` |
| `domains/money/` | `money_config.py`, `money_db.py`, `notion_sync.py` |
| `infrastructure/api/` | Full FastAPI app: 6 routers, 2 models, questionnaire module |
| `infrastructure/db/` | 2 schema files, 5 Python scripts, 3 live databases |
| `infrastructure/scripts/` | `backup.sh`, `daily_sync.sh`, `sync_log_tail.py` |
| `infrastructure/systemd/` | `daybook-api.service`, `daybook-web.service` |
| `infrastructure/web/` | Full Next.js app (built `.next/` present) |
| `data/raw/garmin/` | 100+ raw JSON files from Garmin API |
| `data/backups/` | 4 compressed DB snapshots |
| `docs/` | 5 documentation files |

### Completely empty (stub directories only)

| Directory | Significance |
|---|---|
| `domains/health/strava/` | Strava integration domain — Phase D of vision, zero code |
| `domains/aviation/` | Aviation domain — referenced in vision, zero code |
| `domains/memory/` | Memory domain — mentioned in vision, zero code |
| `domains/personal/` | Personal domain — mentioned in vision, zero code |
| `infrastructure/docker/` | Docker stub — no containerisation implemented |
| `insights/anomalies/` | Anomaly detection output — Phase E, zero code |
| `insights/correlations/` | Cross-domain analysis — Phase F, zero code |
| `insights/reviews/` | Review outputs — zero code |
| `data/photos/` | Photos are on the Pi, not synced to this machine |
| `data/locations/` | Locations raw import staging — empty |
| `infrastructure/scripts/logs/` | Cron log directory — empty (cron not running here) |

---

## 6. Scheduled Jobs

```
No crontab for miquelfarre (this machine).
```

The `daily_sync.sh` script (which runs Garmin + Overland + Notion) is designed to be run every hour via cron using `make cron-install`. It is not currently scheduled on this development machine.

On the Pi the cron is presumably active; this audit cannot verify Pi state.

---

## 7. `docs/GARMIN_STRAVA_INTEGRATION.md` — Full Summary

The document defines a phased integration of Garmin (primary) and Strava (enrichment) as fitness data sources. Key points:

**Principles:** Garmin is the source of truth; raw payloads stored before parsing; idempotent syncs; activity IDs prefixed `{source}_{native_id}`; sync failures are loud and written to a `sync_status` table; no Strava write-back.

**Data sources:** Garmin Connect via `python-garminconnect` (sleep, HRV, daily wellness, activities with full GPS); Strava via `stravalib` (segment efforts, cross-references only); FIT/GPX manual import as fallback.

**User-facing capabilities:** Day view with activities + wellness; calendar heatmap; personal GPS heatmap (all routes overlaid); segment history (replace Strava Premium); training load curve (CTL/ATL/TSB); cross-domain correlations (sleep vs. pace, HRV vs. training load, duty days vs. fitness).

**Schema additions required (not yet applied):** `activities` (redesigned), `activity_streams`, `segments`, `segment_efforts`, `sync_status`.

**Build order (Phases A–F):**
- A: Schema + Garmin auth + backfill + cron + sync_status
- B: FastAPI endpoints + Next.js activity list + detail page
- C: Personal heatmap + calendar heatmap
- D: Strava OAuth + cross-reference + segment pull + history view
- E: TSS computation + CTL/ATL/TSB curve + anomaly detection
- F: Cross-domain correlations + insights view + duty-day overlay

**Definition of done:** Daily auto-sync, any day accessible on phone via Tailscale, Strava Premium cancelled, at least one cross-domain insight answered.

---

## 8. Gaps versus the Integration Vision

### What exists and is aligned

| Component | Status |
|---|---|
| Garmin auth + API client | `domains/health/garmin/garmin_client.py` — implemented |
| Garmin daily sync (sleep, daily_stats, hrv, activities) | `garmin_sync.py` — implemented, idempotent, auto-detects gap |
| Raw JSON archiving | Written to `data/raw/garmin/{type}/{date}.json` ✓ |
| `sync_log` table | Present in schema and populated ✓ |
| Activities table (basic) | Exists with 350 rows ✓ |
| Makefile targets for sync | `sync-garmin`, `sync-garmin-full`, `cron-install` ✓ |
| daily_sync.sh with error trapping | Implemented ✓ |
| Days spine joined by date | Core of the schema ✓ |
| Data stored on Pi, API over Tailscale | Infrastructure matches CLAUDE.md ✓ |

### What is missing (Phase A gaps — must come first)

| Gap | Detail |
|---|---|
| **Schema not migrated** | The four new tables from the vision (`activity_streams`, `segments`, `segment_efforts`, `sync_status`) do not exist in `daybook.db`. Phase A step 1 is not done. |
| **`sync_status` table absent** | The vision requires a per-source heartbeat table surfaced on the Today view. `sync_log` exists but is append-only audit, not a live status sentinel. |
| **`activities` schema is wrong shape** | Current `activities` table uses `activity_id TEXT` (bare Garmin ID), not the `{source}_{native_id}` prefix the vision requires. Missing: `source`, `strava_id`, `moving_time_seconds`, `avg_speed_mps`, `avg_power_watts`, `training_stress_score`, `polyline`, `start_lat`, `start_lng`, `raw_payload` (vision calls it this; current schema uses `raw_json`). Present in current but not in vision DDL: `name`. |
| **No `polyline` data** | Current sync does not fetch or store GPS polylines. All map-dependent features (heatmap, activity map, segment matching) depend on this. |
| **`garmin_sync.py` does not store activity streams** | No call to `get_activity_splits` or stream endpoints. `activity_streams` table is not in schema. |

### What is missing (Phases B–C — no API or UI for activities)

| Gap | Detail |
|---|---|
| **No `/activities` or `/activities/{id}` FastAPI endpoint** | `infrastructure/api/routers/` has no activities router. Days router exists but does not join activity data. |
| **Day view does not show activities** | `infrastructure/web/app/day/[date]/page.tsx` exists but pulls from the current days API which has no activity join. |
| **No activity detail page** | No route like `/activity/[id]` exists in the Next.js app. |
| **No personal GPS heatmap** | `LocationMap.tsx` exists (uses Leaflet + leaflet.heat) for Overland GPS tracks. There is no view that renders Garmin activity polylines as a heatmap. |
| **No calendar heatmap by activity volume** | `HeatMap.tsx` exists but renders sleep/energy, not activity counts. |

### What is missing (Phases D–F — entire Strava + intelligence layer)

| Gap | Detail |
|---|---|
| **Strava domain is empty** | `domains/health/strava/` contains zero files. No OAuth, no token storage, no sync logic. |
| **`stravalib` not in requirements.txt** | Cannot be installed without adding it. |
| **No segment infrastructure** | `segments` and `segment_efforts` tables do not exist. No matching logic. No segment UI. |
| **No TSS/CTL/ATL/TSB computation** | No batch job, no chart. Requires activity power or HR data first. |
| **No anomaly detection** | `insights/anomalies/` is empty. |
| **No cross-domain correlation queries** | `insights/correlations/` is empty. Aviation domain is empty so duty-day overlay is doubly blocked. |

### What exists but is misaligned with the vision

| Item | Misalignment |
|---|---|
| **`activities` primary key** | Vision: `id TEXT` keyed as `garmin_19284756`. Reality: `activity_id TEXT` with bare Garmin numeric ID (e.g. `19284756`). Schema migration must rename the column and reformat existing 350 rows. |
| **`raw_json` vs `raw_payload`** | Vision uses `raw_payload` consistently. Current schema uses `raw_json` everywhere. Minor but creates inconsistency at migration time. |
| **No `source` column on activities** | Vision requires `source TEXT NOT NULL` (`'garmin' | 'strava' | 'manual'`). Current table has no source column, making multi-source dedup impossible. |
| **`avg_spo2` stored in `sleep`** | Vision does not include SpO2 in the sleep table DDL; it is in the current schema. Not a problem, but worth noting for future sleep schema work. |
| **`daily_sync.sh` runs hourly (Makefile comment says "every hour")** | Vision says "daily incremental sync". Hourly is more aggressive; fine in practice, but the vision's rate-limit analysis assumed daily. Worth reviewing against Garmin API limits. |
| **`insights/` directory structure** | The `insights/` top-level directory with `anomalies/`, `correlations/`, `reviews/` subdirs implies file-based output (CSV, JSON). Vision describes these as live DB queries surfaced in the UI. Architectural decision needed: files or live queries? |

### Summary verdict

**Phase A is ~60% complete.** The Garmin client, daily wellness sync (sleep/hrv/stats), raw file archiving, sync logging, and cron infrastructure all exist and work. What blocks Phase A completion: the schema migration (four missing tables), the `sync_status` heartbeat table, the `activities` table reshape, and the polyline/stream fetch in `garmin_sync.py`.

**Phases B through F are 0% complete.** No activity API endpoints, no activity UI, no Strava code, no segment code, no training intelligence, no cross-domain analysis.

The project is in excellent shape for the wellness-tracking use case it currently serves. The integration vision is a substantial next chapter that begins with a non-trivial schema migration before any new feature can ship.
