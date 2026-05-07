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
