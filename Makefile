# Daybook — orchestration
# All targets run from the daybook/ root directory.
# Usage: make <target>

SHELL := /bin/bash
ROOT  := $(shell pwd)
VENV  := $(ROOT)/.venv
PY    := $(VENV)/bin/python
WEB   := $(ROOT)/infrastructure/web

.PHONY: setup db-init sync-garmin sync-garmin-full api web dev verify backup clean-pyc help

# ── Bootstrap ─────────────────────────────────────────────────────────────────

setup:
	@echo "==> Setting up Daybook..."
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "    Created .env from .env.example — fill in credentials if needed"; \
	else \
		echo "    .env already exists, skipping"; \
	fi
	@if [ ! -d $(VENV) ]; then \
		python3 -m venv $(VENV); \
		echo "    Created .venv"; \
	fi
	$(VENV)/bin/pip install -q -r requirements.txt
	@echo "    Python deps installed"
	cd $(WEB) && npm install --silent
	@echo "    npm deps installed"
	@echo "==> Setup complete. Run: make db-init"

# ── Database ──────────────────────────────────────────────────────────────────

db-init:
	@echo "==> Initialising database..."
	cd $(ROOT)/infrastructure/db && $(PY) init_db.py
	$(PY) -m infrastructure.db.backfill_days --start-date 2010-01-01
	@echo "==> Database ready"

# ── Sync ──────────────────────────────────────────────────────────────────────

sync-garmin:
	@echo "==> Syncing Garmin (yesterday → today)..."
	$(PY) -m domains.health.garmin.garmin_sync
	@echo "==> Garmin sync done"

sync-garmin-full:
	@echo "==> Syncing Garmin full history (this takes a while)..."
	$(PY) -m domains.health.garmin.garmin_sync --full-history
	@echo "==> Full Garmin sync done"

# ── Servers ───────────────────────────────────────────────────────────────────

api:
	@echo "==> Starting FastAPI on http://127.0.0.1:8000 ..."
	$(VENV)/bin/uvicorn infrastructure.api.main:app \
		--host 127.0.0.1 --port 8000 --reload \
		--reload-dir infrastructure/api \
		--reload-dir domains \
		--reload-dir infrastructure/db

web:
	@echo "==> Starting Next.js on http://localhost:3000 ..."
	cd $(WEB) && npm run dev

dev:
	@echo "==> Starting API + Web concurrently..."
	@$(MAKE) api & API_PID=$$!; \
	sleep 2; \
	$(MAKE) web & WEB_PID=$$!; \
	echo "API pid=$$API_PID  Web pid=$$WEB_PID"; \
	echo "Press Ctrl-C to stop both."; \
	trap "kill $$API_PID $$WEB_PID 2>/dev/null" INT TERM; \
	wait

# ── Quality ───────────────────────────────────────────────────────────────────

verify:
	@echo "==> Running coverage reports..."
	@echo ""
	@echo "── Garmin ──────────────────────────────"
	$(PY) -m domains.health.garmin.garmin_verify
	@echo ""
	@echo "── Sync log (last 10) ──────────────────"
	$(PY) infrastructure/scripts/sync_log_tail.py

# ── Backup ────────────────────────────────────────────────────────────────────

backup:
	@bash $(ROOT)/infrastructure/scripts/backup.sh

# ── Housekeeping ──────────────────────────────────────────────────────────────

clean-pyc:
	@echo "==> Removing __pycache__ folders..."
	find $(ROOT) -type d -name __pycache__ \
		-not -path "$(VENV)/*" \
		-not -path "$(WEB)/node_modules/*" \
		-exec rm -rf {} + 2>/dev/null; true
	@echo "==> Done"

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "Daybook — available targets:"
	@echo ""
	@echo "  make setup             Create .env, install Python + npm deps"
	@echo "  make db-init           Create daybook.db and backfill days spine"
	@echo "  make sync-garmin       Pull yesterday + today from Garmin Connect"
	@echo "  make sync-garmin-full  Pull full Garmin history (first run only)"
	@echo "  make api               Start FastAPI dev server (port 8000)"
	@echo "  make web               Start Next.js dev server (port 3000)"
	@echo "  make dev               Start both servers"
	@echo "  make verify            Print coverage + gap report for all domains"
	@echo "  make backup            Snapshot databases to data/backups/"
	@echo "  make clean-pyc         Remove __pycache__ directories"
	@echo ""
