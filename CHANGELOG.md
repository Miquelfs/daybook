# Changelog

All notable changes to Daybook are tracked here, day by day.

---

## 2026-05-15–18 — Daily usability sprint: photo diary, questionnaire overhaul, money fixes, location tuning

### Added
- **Photo of the day** — full upload pipeline: `POST /days/{date}/photo`, HEIC→JPEG conversion via Pillow + pillow-heif, EXIF orientation correction, photos stored in `data/photos/` on Pi
- **Photo proxy route** — `GET /api/photos/[...path]` Next.js route forwards image requests same-origin (fixes mixed-content broken images in browser)
- **PhotoOfDay.tsx** — upload zone (gallery picker, no forced camera), thumbnail with tap-to-expand lightbox, replace-photo button; visible on both Today and all past day pages
- **Moments page** (`/moments`) — Instagram-style 3-column photo grid across all days; infinite scroll (90-day pages); lightbox with "View that day →" link; camera icon in nav
- **Photo dot on DayCard** — amber `●` indicator on timeline rows when a photo is logged for that day
- **`/day/[date]` photo section** — PhotoOfDay now shown on past day pages, enabling backfill uploads
- **Questionnaire — Today section redesign:**
  - Drinks: hidden by default; tap "Drinks" to reveal 1–8 count row + `✕` to clear; count shown inline in pill label
  - S.I.: tap to reveal 1–5 rating row (no "Rating" label)
  - Work, Outdoors, Social: toggle pills
  - All five in one compact row
- **Questionnaire — With section:** smart autocomplete — type a name and past names from 90-day history appear as suggestions; selected names shown as removable chips; new names saved as `with:Name` tags and available in future autocomplete
- **Questionnaire — Past 7 days collapsible:** shows last 7 answered rotating Q&A pairs
- **Account color badges** — 12 accounts mapped to distinct colors matching Notion palette (BBVA blue, Revolut purple, Sabadell sky, Trade Republic amber, etc.) in `TransactionList` and edit mode
- **`tags` field in DaySummary** — now returned from `GET /days` range endpoint; used by Questionnaire autocomplete for `with:` history
- **`CLAUDE.md`** — project-level instructions: deploy workflow, stack, CORS conventions, tags column convention, key directories

### Fixed
- **Money sign bug** — `isExpense()` now checks `amount < 0` (not `transaction_type`); daily total shows net correctly; reimbursements/income shown in green with `+` prefix; "Total spent" shows net not gross
- **Photo upload 500** — Next.js proxy was re-parsing and re-encoding multipart form data, stripping the boundary; fixed by forwarding raw `arrayBuffer()` with original `content-type` header
- **Photo upload threading** — FastAPI `async def upload_photo` ran in a different thread from the SQLite connection; converted to sync `def` so connection and DB writes share the same thread
- **Photo display after refresh** — `initialPhotoUrl` was a relative path (`/photos/...`) used as `<img src>` directly, loading from wrong port; fixed by routing all photo URLs through `/api/photos/` proxy
- **HEIC support** — iPhone HEIC photos now accepted and converted to JPEG server-side; any format Pillow can read is accepted
- **Leaflet CSS z-index** — moved `<link>` to `layout.tsx` head; added `isolate` + `position:relative` to map container; map no longer bleeds over expense list on desktop
- **Overland dwell thresholds** — `DWELL_MIN_MINUTES` 8→3, `MOVE_SPEED_MS` 0.8→2.0 (was triggering on normal walking GPS drift), `SPARSE_GAP_MINUTES` 60→30; sparse-tracking days now produce segments
- **Location pills cap** — Today view shows max 10 named stops, deduped, with "+N more" label

### Infrastructure
- **Pillow + pillow-heif** added to `requirements.txt`; installed on Pi via deploy pipeline
- **`make deploy`** now always does `rm -rf .next` before build to prevent stale cache serving old pages
- **CORS threading error** in `db_money.py` (`SQLite objects created in thread`) — known intermittent; connections created per-request via FastAPI `Depends(get_db)`, not shared across threads

### Tags column convention (documented in CLAUDE.md)
`days.tags` stores comma-separated structured tags:
- `work` — work day
- `si:N` — S.I. with optional satisfaction rating 1–5
- `with:Name` — person present; used for autocomplete history and future correlation analysis

---

## 2026-05-07 — Project initiated

### Added
- Full directory scaffold: `domains/`, `infrastructure/`, `insights/`, `docs/`, `data/`
- Python virtual environment at `.venv` (Python 3)
- `requirements.txt` with core dependencies: garminconnect, python-dotenv, pandas, requests, fastapi, uvicorn, pydantic, scipy, numpy, tqdm
- `.gitignore` excluding secrets, databases, raw data, node artefacts, and OS files
- `README.md` one-pager pointing to vision doc
- `docs/VISION.md` — full project vision, principles, architecture, and roadmap
- `CHANGELOG.md` (this file)
- Initial git repository and first commit

---

## 2026-05-07 — Database schema + Garmin sync system

### Added
- `infrastructure/db/schema.sql` — full SQLite schema: `days` spine, `sleep`, `daily_stats`, `hrv`, `activities`, `sync_log`
- `infrastructure/db/connection.py` — `get_connection()` helper (WAL mode, FK ON, Row factory)
- `infrastructure/db/init_db.py` — idempotent DB initializer
- `infrastructure/db/backfill_days.py` — fills the `days` spine for any date range
- `domains/health/garmin/garmin_sync.py` — live API sync with `--start-date`, `--end-date`, `--full-history`, `--types`, `--force` flags
- `domains/health/garmin/garmin_verify.py` — coverage report: row counts, date ranges, gap detection

### Bootstrapped
- `daybook.db` initialized; `days` spine: 5,971 rows from 2010-01-01 → 2026-05-07
- Raw import: 5,971 sleep, 5,971 daily_stats, 206 HRV, 350 activities

---

## 2026-05-07 — Locations, FastAPI backend, Questionnaire, Next.js frontend

### Added
- `domains/locations/locations_query.py` — read-only query helpers
- `infrastructure/api/main.py` — FastAPI app, CORS, binds 0.0.0.0:8000
- `infrastructure/api/routers/days.py` — `GET /days/today`, `GET /days/{date}`, range, PATCH
- `infrastructure/api/routers/questionnaire.py` — questionnaire endpoints
- `infrastructure/api/routers/insights.py` — on-this-day, streaks (stub)
- Next.js frontend: Today, Day Detail, Timeline pages
- Evening questionnaire with energy/mood/stress sliders, rotating daily question
- `Makefile` with all orchestration targets
- `infrastructure/scripts/daily_sync.sh` — cron-ready sync script
- `infrastructure/scripts/backup.sh` — SQLite snapshot with 30-day retention
- `docs/DECISIONS.md` — ADR-001 (SQLite), ADR-002 (FastAPI+Next.js), ADR-003 (Mac-first/Pi-later)
- `docs/MIGRATION.md` — Raspberry Pi migration checklist

**Phase 1 — Spine: COMPLETE**

---

## 2026-05-10 — GPS tracks, heatmap, Overland, Explore page

### Added
- `domains/locations/import_tracks.py` — imports Google Maps Timeline JSON into `tracks` table
- `domains/locations/geocode_tracks.py` — background Nominatim geocoder (1.1 sec/request)
- `domains/locations/overland_process.py` — dwell detection (80m radius, 3-min minimum)
- `infrastructure/api/routers/locations.py` — heatmap, tracks, Overland ingest endpoint (Bearer token auth)
- `LocationMap.tsx` — Leaflet polyline map with named stops
- `HeatMap.tsx` — world heatmap with leaflet.heat
- `/explore` page — year filter, world heatmap, country/city stats
- `SyncOnLoad.tsx` — fires `POST /sync/garmin` silently on Today page mount

### Data state
- 22,408 GPS track segments imported (2013–2026)
- Overland iOS live location ingestion configured and running

---

## 2026-05-11 — Finance domain: money.db, Notion sync, expense entry UI

### Added
- `infrastructure/db/money_schema.sql` — transactions, budgets, money_sync_log tables; soft-delete; source='local'|'notion'
- `domains/money/money_config.py` — budget versions (€2,660/month), category classification, emoji map
- `domains/money/notion_sync.py` — full Notion import CLI with incremental sync
- `infrastructure/api/routers/money.py` — 7 endpoints: CRUD transactions, merchant autocomplete, month summary
- `AddExpenseSheet.tsx` — bottom sheet for quick expense entry with merchant autocomplete
- `DaySpendSummary.tsx` — daily spend widget on Today + Day Detail
- `/money` page — budget overview, category progress bars, recent transactions

### Bootstrapped
- `money.db` initialized, 11 budget categories seeded
- Notion credentials configured; 363 transactions synced

---

## 2026-05-12–13 — Finance analytics, portfolio, category drill-down, charts

### Added
- 6 new API endpoints:
  - `GET /money/overview` — daily burn rate, projections, budget alerts
  - `GET /money/trends/historical` — MoM/YoY comparisons
  - `GET /money/trends/forecast` — 3-month weighted average forecast
  - `GET /money/portfolio` — net worth, investment vs liquid breakdown
  - `GET /money/spending/patterns` — spend by day-of-week and week-of-month
  - `GET /money/categories/stats` — all-time per-category totals
- `/money/overview` page — burn rate, projections, alert cards
- `/money/portfolio` page — net worth, allocation bar, account list with type badges
- `/money/category/[cat]` page — per-category drill-down with transaction list
- `MonthlyChart.tsx` — income vs expenses bar chart with MoM delta table
- `ForecastCard.tsx` — predicted income/spend/savings vs €1,300 goal
- `SpendingPatternsChart.tsx` — day-of-week spend bars + week-of-month list
- `CategoryStatsTable.tsx` — all-time category totals with % of spend bars
- `CategoryTrendsChart.tsx` — category spending over time (line chart)
- `/money/trends` page — savings streak, forecast, all charts, anomalies, month history
- Navigation: Overview and Portfolio icons added to top nav bar

### Fixed
- Sign convention: `SUM(ABS(amount))` → `-SUM(amount)` throughout API so reimbursements correctly net against spending
- Sign toggle: removed auto-lock in AddExpenseSheet — user always controls the sign

---

## 2026-05-14 — Anomaly detection, CSV export, transaction editing, account classification

### Added
- `GET /money/anomalies` — flags large transactions (>3× category avg) and category spikes (>1.5× 12-month avg, ≥3 months history)
- `GET /money/transactions/export` — StreamingResponse CSV of full transaction history
- `app/api/money/export/route.ts` — Next.js proxy for CSV download (↓ CSV button on Trends page)
- `AnomalyReport.tsx` — anomaly display component; shown first on Trends page

### Improved
- `TransactionList.tsx` — inline edit now has category pills (amber highlight), account pills (pre-selected), sign toggle; all fields saveable
- `AddExpenseSheet.tsx` — free-text input below category pills allows custom/new categories
- `money_config.py` — Mapfre Inversió → Investment; Sabadell + Cash → Checking/Liquid

### Fixed
- `garmin_sync.py` — `if start > today: return` replaced with `start = today` so today's data always re-fetches on every cron run

---

## 2026-05-15 — Pi production deployment: systemd, CORS, hardened deploy pipeline

### Infrastructure
- **Systemd services** installed on Pi: `daybook-api.service` + `daybook-web.service`
  - Both `enabled` — survive reboots automatically
  - `Restart=on-failure` — recover from crashes without manual intervention
  - Logs: `journalctl -u daybook-api -f` / `journalctl -u daybook-web -f`
- **`make deploy`** fully automated: rsync → `npm install` → `npm run build` → `sudo systemctl restart daybook-api daybook-web`
- **Cron** (`0 * * * *`): hourly Garmin + Overland + Notion sync via `daily_sync.sh`
- **Passwordless sudo** for systemctl restart: `/etc/sudoers.d/daybook`

### Fixed
- **CORS**: `CORS_ORIGINS=http://localhost:3000,http://100.67.252.76:3000` added to Pi `.env` — unblocked all client-side React Query calls (TransactionList, Timeline, all charts)
- **rsync destroying Pi credentials**: added `--exclude='.env'` so Notion token and Garmin password on Pi are never overwritten by Mac's `.env`
- **rsync destroying Pi state**: added excludes for `*.db-wal`, `*.db-shm`, `infrastructure/scripts/logs/`, `nohup.out`
- **nohup fragility**: processes died when SSH session closed — replaced with systemd entirely

### Access
- Production URL: `http://100.67.252.76:3000` (Pi's Tailscale IP — consistent for SSR and browser API calls)
- `NEXT_PUBLIC_API_URL=http://100.67.252.76:8000` baked into the Next.js build

### Lessons learned
- `NEXT_PUBLIC_*` vars are baked into the bundle at build time — the browser-facing URL must match `.env.local` at build time, not at runtime
- `nohup cmd &` via non-interactive SSH dies when the connection closes — systemd is the correct production pattern
- rsync `--delete` silently destroys Pi-only state — always audit excludes before adding new files to the project
- SSR pages bypass CORS (server-to-server); React Query client components do not — a CORS bug shows as a clean split between working SSR and broken client fetches
- Accessing the app from a URL different from `NEXT_PUBLIC_API_URL`'s origin causes client fetches to fail even with correct CORS headers — use the Tailscale IP consistently
