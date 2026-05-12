# Changelog

All notable changes to Daybook are tracked here, day by day.

---

## 2026-05-07 — Project initiated

### Added
- Full directory scaffold: `domains/`, `infrastructure/`, `insights/`, `docs/`, `data/`
- Python virtual environment at `.venv` (Python 3)
- `requirements.txt` with core dependencies: garminconnect, python-dotenv, pandas, requests, fastapi, uvicorn, pydantic, scipy, numpy, tqdm
- `.gitignore` excluding secrets, databases, raw data, node artefacts, and OS files
- `README.md` one-pager pointing to vision doc
- `docs/VISION.md` — full project vision, principles, architecture, and roadmap (transcribed from founding PDF)
- `CHANGELOG.md` (this file)
- Initial git repository and first commit

### Status
Phase 1 — Spine: **in progress**
Next: SQLite schema for `days`, `health`, `activities` + Garmin sync script

---

## 2026-05-07 — Database schema + Garmin sync system

### Added
- `infrastructure/db/schema.sql` — full SQLite schema: `days` spine, `sleep`, `daily_stats`, `hrv`, `activities`, `sync_log`; all date columns indexed
- `infrastructure/db/connection.py` — `get_connection()` helper (WAL mode, FK ON, Row factory)
- `infrastructure/db/init_db.py` — idempotent DB initializer; creates `daybook.db`
- `infrastructure/db/backfill_days.py` — fills the `days` spine for any date range (default 2010-01-01 → today)
- `domains/health/garmin/garmin_client.py` — Garmin Connect login with session token caching at `data/raw/garmin_session/`
- `domains/health/garmin/garmin_sync.py` — live API sync with `--start-date`, `--end-date`, `--full-history`, `--types`, `--force` flags; rate-limited; upsert pattern; logs to `sync_log`
- `domains/health/garmin/import_raw.py` — bootstrap DB from pre-existing raw JSON files (no API calls)
- `domains/health/garmin/garmin_verify.py` — coverage report: row counts, date ranges, gap detection, orphan check
- `domains/health/garmin/README.md` — setup, daily usage, and API breakage runbook
- `pyproject.toml` — editable package install so all scripts run as `python -m domains.health.garmin.*` from the daybook root
- Copied 18,212 raw JSON files from miquelOS Garmin history into `data/raw/garmin/`

### Bootstrapped
- `daybook.db` initialized with full schema
- `days` spine backfilled: 5,971 rows from 2010-01-01 → 2026-05-07
- Raw import: **5,971 sleep**, **5,971 daily_stats**, **206 HRV**, **350 activities** loaded with zero orphans and zero gaps in sleep/daily_stats

### Known state
- HRV data only starts 2025-07-15 (device support limitation); 7 real gaps in the HRV record (missed nights)
- Activities only from 2024-02-09 (previous sync script started then); `--full-history` API run needed for earlier workouts
- Live Garmin API sync not yet tested (requires `.env` credentials)

### Status
Phase 1 — Spine: **in progress**
Next: FastAPI backend `/day/{date}` + `/range` endpoints; then Next.js Today view

---

## 2026-05-07 — Locations import + FastAPI backend + Questionnaire

### Added (Locations)
- Copied `locations.db` (14 MB) from miquelOS into `infrastructure/db/` — already geocoded, 19,676 visits, 20,465 movements, 4,058 place names, 2014 → 2026
- Copied `data/raw/locations/location-history.json` (38 MB) as source-of-truth raw backup
- `domains/locations/locations_query.py` — read-only query helpers: `visits_for_date`, `movements_for_date`, `location_summary_for_date`, `on_this_day_locations`
- `domains/locations/__init__.py`

### Added (FastAPI backend)
- `infrastructure/api/main.py` — FastAPI app, CORS for localhost:3000, binds 127.0.0.1:8000
- `infrastructure/api/db.py` — per-request SQLite connection dependency injection
- `infrastructure/api/routers/days.py` — `GET /days/today`, `GET /days/{date}`, `GET /days?start=&end=`, `PATCH /days/{date}`
- `infrastructure/api/routers/insights.py` — `GET /insights/on-this-day/{date}` (functional), `/streaks` + `/correlations` (stubs)
- `infrastructure/api/routers/questionnaire.py` — `GET /questionnaire/today`, `GET /questionnaire/{date}`
- `infrastructure/api/models/day.py` — Pydantic models: `DayDetail`, `DaySummary`, `DayPatch`, `SleepData`, `DailyStatsData`, `HRVData`, `ActivityData`, `LocationSummary`, `LocationVisit`, `DaySubjective`
- `infrastructure/api/questionnaire/questions.py` — 6 core questions (always shown) + 30 rotating reflective questions (deterministic by date hash). Design informed by Whoop journal (yes/no behaviors) but more reflective and long-form.
- `infrastructure/api/run.sh` — dev launcher: activates venv, runs uvicorn with --reload

### Verified (all curl-tested)
- `GET /` → health + version
- `GET /days/today` → full envelope with sleep (7h45m, score 91), HRV 94ms, daily stats, empty visits (today not yet in locations.db)
- `GET /days?start=2026-05-01&end=2026-05-07` → range with cities (Palma), steps, activity counts
- `PATCH /days/2026-05-07` with energy/mood/stress → persisted and returned
- `GET /questionnaire/today` → 6 core + 1 rotating question
- `GET /insights/on-this-day/2026-05-07` → historical same-day data back to 2010

### Status
Phase 1 — Spine: **in progress**
Next: Next.js Today view + Day Detail view

---

## 2026-05-07 — Next.js frontend (Phase 1 complete)

### Added
- `infrastructure/web/` — Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Stack**: TanStack Query for client-side mutations, date-fns, lucide-react
- **Design**: dark zinc palette (`#09090B` bg), amber accent (`#F59E0B`), generous whitespace, field-notes aesthetic

### Pages
- `/` — Today: server component fetches `/days/today`; sections: Morning Brief, Movement, Reflection, On This Day (Phase 2 placeholder)
- `/day/[date]` — Day Detail: identical shape + location visit strip when data exists
- `/timeline` — vertical infinite-scroll list, grouped by month, click → `/day/[date]`

### Components
- `DayHeader` — date hero with ← prev / Timeline / next → navigation, tomorrow disabled when future
- `MorningBrief` — sleep duration (accent), HRV, body battery range, RHR in 2×4 grid; secondary pills for score, deep%, SpO₂, stress
- `MovementBlock` — steps + active calories header, activity rows with icon/name/duration/distance/HR
- `Questionnaire` — client component; 4 sliders (energy/mood/stress/sleep quality), free-text notes, rotating question input; auto-saves on blur with 800ms debounce; shows ✓ Saved / spinner
- `Slider` — custom range input with amber fill, labelled endpoints, live numeric readout
- `DayCard` — timeline row: date + weekday, mood emoji, one-line preview, HRV column, duty day badge

### Infrastructure
- `app/providers.tsx` — TanStack Query `QueryClientProvider`
- `lib/api.ts` — typed API client (`api.today()`, `api.day()`, `api.range()`, `api.patch()`, `api.questionnaire()`) + formatting helpers (fmtDuration, fmtDistance, moodEmoji, activityIcon)
- `tailwind.config.ts` — custom palette, no default Next.js colours
- `.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:8000`

### Verified
- `npm run build` — clean, zero TypeScript errors
- `GET /` renders Morning Brief, Movement, Reflection
- `GET /day/2026-05-01` renders with Locations strip (Palma visits)
- `GET /timeline` renders with "All days" + "Load more"

### Status
Phase 1 — Spine: **in progress**
Next: orchestration layer

---

## 2026-05-07 — Orchestration, ADRs, migration doc, and Garmin live sync

### Added
- `Makefile` — all orchestration targets: `setup`, `db-init`, `sync-garmin`, `sync-garmin-full`, `api`, `web`, `dev`, `verify`, `backup`, `clean-pyc`, `help`
- `.env.example` — template with Garmin credentials, timezone, API host/port
- `infrastructure/scripts/daily_sync.sh` — cron-ready Garmin pull for yesterday; logs to `logs/daily_sync_YYYY-MM-DD.log`, errors to `logs/errors.log`
- `infrastructure/scripts/backup.sh` — gzip snapshot of all `.db` files, keeps last 30, prunes older
- `infrastructure/scripts/sync_log_tail.py` — helper for `make verify` (last 10 sync_log entries)
- `docs/DECISIONS.md` — ADR-001 (SQLite), ADR-002 (FastAPI+Next.js vs Grafana), ADR-003 (Mac-first/Pi-later)
- `docs/MIGRATION.md` — Raspberry Pi 3 migration checklist (placeholder, 7 sections)
- `README.md` — full rewrite: 5-minute quickstart, daily routine, key commands table, project layout, architecture paragraph, docs index

### Fixed
- `domains/health/garmin/garmin_client.py` — rewrote to use garminconnect's `login(tokenstore=dir)` pattern instead of garth `.loads()`. Copied miquelOS token directory to `data/raw/garmin_session/` — live Garmin sync now works without credentials in `.env`.

### Verified (full `make` chain)
- `make setup` ✓ — .env created, deps installed
- `make db-init` ✓ — schema intact, spine unchanged
- `make sync-garmin` ✓ — authenticated via tokenstore, 0 new records (all pre-loaded)
- `make verify` ✓ — 5,971 sleep/stats rows, 206 HRV, 350 activities, 0 gaps/orphans
- `make backup` ✓ — daybook.db (2.2M gz) + locations.db (3.2M gz) snapshotted
- `make dev` + `curl localhost:3000` ✓ — Morning Brief · Movement · Reflection all rendering

### Status
**Phase 1 — Spine: COMPLETE**
Done when: open the web app every evening, see today's Garmin data, fill out the questionnaire, scrub backwards. ✓

Next (Phase 2 — Brain): Google Takeout location import, Notion expenses, aviation logbook, correlation engine, "On This Day" widget

---

## 2026-05-10 — GPS tracks, heatmap, Overland ingestion, Explore page

### Added (Locations domain)
- `domains/locations/import_tracks.py` — imports Google Maps Timeline `timelinePath` JSON entries into `tracks` table; parses `geo:lat,lng` strings; optional Nominatim geocoding
- `domains/locations/geocode_tracks.py` — background geocoder for `tracks` table; 1.1 sec/request Nominatim rate limit; `--limit`, `--force` flags; `caffeinate`-friendly for overnight runs
- `domains/locations/overland_process.py` — dwell detection (80m radius, 3-min minimum = stop); haversine distance; zoom-18 Nominatim for venue names; marks source points `processed=1`
- `domains/locations/locations_query.py` (extended) — `tracks_for_date()` enriched: joins `visits` + `place_names` by time overlap to return `place_name`, `semantic_type`, `city`, `country`

### Added (API)
- `infrastructure/api/routers/locations.py` — `GET /locations/heatmap?year=`, `GET /locations/tracks/{date}`, `POST /locations/ingest/overland` (Overland iOS endpoint; Bearer token auth; null-island filter; background processing)
- Added `POST /sync/garmin` endpoint to `main.py` — triggers incremental Garmin sync in background

### Added (Frontend)
- `infrastructure/web/components/LocationMap.tsx` — Leaflet polyline map with white halo + blue line; orange named-stop dots; grey transition dots; deduplicated stop legend; StrictMode double-init fix
- `infrastructure/web/components/HeatMap.tsx` — leaflet.heat world heatmap; script-tag loading pattern (required for `window.L` global); blue→purple→amber→red gradient
- `infrastructure/web/app/explore/page.tsx` — `/explore` page: year-filter pills, world heatmap, country list with flag + proportion bar, top-20 cities ranked by days
- `infrastructure/web/components/SyncOnLoad.tsx` — fires `POST /sync/garmin` silently on Today page mount

### Added (navigation)
- `DayHeader.tsx` — Globe icon → `/explore` link; Wallet icon → `/money` link
- `/explore` page — `← Timeline` back link

### Fixed
- Leaflet "Map container already initialized" error in React StrictMode — local `destroyed` boolean + `_leaflet_id` deletion before re-init
- Null-island (lat=0, lng=0) GPS points filtered at ingest and deleted from DB
- Track segment coordinates now continuous (single polyline, not disconnected dots)

### Data state
- 22,408 GPS track segments in `tracks` table (Google Maps Timeline 2013–2026)
- ~1,700/19,271 geocoded as of Phase 2 start (background geocoder running)
- Overland iOS app configured and receiving live location data

### Status
**Phase 2 — Brain: in progress**

---

## 2026-05-11 — Finance domain: money.db, Notion sync, expense entry UI

### Added (Finance domain — Phase 2a complete)
- `infrastructure/db/money_schema.sql` — `transactions`, `budgets`, `money_sync_log` tables; soft-delete pattern; source='local'|'notion' to protect hand-edited rows from Notion re-sync
- `infrastructure/db/money_connection.py` — WAL-mode SQLite connection to `money.db`
- `domains/money/__init__.py`
- `domains/money/money_config.py` — classification constants ported from Notion dashboard: `BUDGET_VERSIONS` (€2,660/month budget seeded), `INCOME_CATEGORIES`, `SPECIAL_CATEGORIES`, `CATEGORY_EMOJI`, `classify()`, `get_budget_for_month()`
- `domains/money/money_db.py` — `init_money_db()` + `seed_budgets()` (11 category budgets seeded for 2025-09 onward)
- `domains/money/notion_sync.py` — full Notion import CLI: `--full-history`, `--since YYYY-MM-DD`, `--dry-run`, `--force`; source='local' protection; logs to `money_sync_log`
- `infrastructure/api/db_money.py` — FastAPI dependency for money.db
- `infrastructure/api/models/money.py` — Pydantic models: `TransactionCreate`, `TransactionOut`, `TransactionPatch`, `MonthSummary`, `CategoryBudget`, `MerchantSuggestion`, `MoneyMeta`
- `infrastructure/api/routers/money.py` — 7 endpoints: `POST /money/transactions`, `GET /money/transactions`, `PATCH /money/transactions/{id}`, `DELETE /money/transactions/{id}`, `GET /money/autocomplete/merchants`, `GET /money/meta`, `GET /money/summary/month`
- Added `POST /sync/notion` to `main.py` — incremental background Notion sync

### Added (Frontend)
- `infrastructure/web/lib/money-api.ts` — typed fetch helpers + `Transaction`, `MonthSummary`, `MoneyMeta` types; `fmtAmount()`, `isExpense()` helpers
- `infrastructure/web/components/money/CategoryPills.tsx` — tap-to-select pill grid with emoji; `CATEGORY_EMOJI` constant
- `infrastructure/web/components/money/AddExpenseSheet.tsx` — 3-step bottom sheet (amount → category → merchant + autocomplete + account selector); CSS-only slide animation; `useMutation` → `POST /money/transactions`
- `infrastructure/web/components/money/DaySpendSummary.tsx` — daily spend widget wired into Today + Day Detail pages; shows total + transaction list + "+ Add" button; silently hides if money.db not initialized
- `infrastructure/web/components/money/MonthBudgetBar.tsx` — per-category progress bar; blue=OK, amber=over pace, red=over budget
- `infrastructure/web/app/money/page.tsx` — `/money` page: 3 overview cards (spent/budget/remaining), velocity progress bars, category budget bars, recent transactions list

### Bootstrapped
- `money.db` initialized: 3 tables created, 11 budget rows seeded
- `.env` populated with live Notion credentials

### Verified (smoke-tested)
- `GET /money/meta` → 10 expense categories with correct emojis ✓
- `GET /money/summary/month?month=2026-05` → €2,660 total budget, day 11/31 ✓
- `POST /money/transactions` → creates local expense with correct sign (−€3.50), UUID, classification ✓
- `npx tsc --noEmit` → zero TypeScript errors ✓

### Status
**Phase 2 — Brain: in progress**
Next: `make sync-notion-full` to import full Notion history; phone PWA setup via Tailscale; country name English fix propagating from geocoder

---
