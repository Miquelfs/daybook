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
