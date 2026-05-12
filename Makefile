# Daybook — orchestration
# All targets run from the daybook/ root directory.
# Usage: make <target>

SHELL := /bin/bash
ROOT  := $(shell pwd)
VENV  := $(ROOT)/.venv
PY    := $(VENV)/bin/python
WEB   := $(ROOT)/infrastructure/web

.PHONY: setup db-init money-db-init sync-garmin sync-garmin-full sync-notion sync-notion-full import-tracks geocode-tracks api web dev prod kill verify backup clean-pyc deploy help

PI_HOST ?= pi@daybook-pi
PI_DIR  ?= ~/daybook

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

money-db-init:
	@echo "==> Initialising money.db..."
	$(PY) -m domains.money.money_db
	@echo "==> money.db ready. Run: make sync-notion-full"

# ── Sync ──────────────────────────────────────────────────────────────────────

sync-garmin:
	@echo "==> Syncing Garmin (yesterday → today)..."
	$(PY) -m domains.health.garmin.garmin_sync
	@echo "==> Garmin sync done"

sync-garmin-full:
	@echo "==> Syncing Garmin full history (this takes a while)..."
	$(PY) -m domains.health.garmin.garmin_sync --full-history
	@echo "==> Full Garmin sync done"

sync-notion:
	@echo "==> Syncing Notion finance (last 90 days)..."
	$(PY) -m domains.money.notion_sync
	@echo "==> Notion sync done"

sync-notion-full:
	@echo "==> Syncing Notion finance full history..."
	$(PY) -m domains.money.notion_sync --full-history
	@echo "==> Full Notion sync done"

# ── Location import ───────────────────────────────────────────────────────────

import-tracks:
	@echo "==> Importing GPS tracks (no geocode, fast)..."
	$(PY) -m domains.locations.import_tracks --no-geocode "$(JSON)"
	@echo "==> Done. Run: make geocode-tracks"

geocode-tracks:
	@echo "==> Geocoding tracks via Nominatim (1 req/sec — run overnight for full history)..."
	$(PY) -m domains.locations.geocode_tracks $(LIMIT)
	@echo "==> Geocoding done"

# ── Servers ───────────────────────────────────────────────────────────────────

api:
	@echo "==> Starting FastAPI on http://0.0.0.0:8000 ..."
	@exec $(VENV)/bin/uvicorn infrastructure.api.main:app \
		--host 0.0.0.0 --port 8000 --reload \
		--reload-dir infrastructure/api \
		--reload-dir domains \
		--reload-dir infrastructure/db

web:
	@echo "==> Starting Next.js on http://localhost:3000 ..."
	cd $(WEB) && npm run dev

dev:
	@echo "==> Starting API + Web..."
	@$(MAKE) kill 2>/dev/null; true
	@$(PY) -m infrastructure.db.backfill_days --start-date 2010-01-01 2>/dev/null
	@$(VENV)/bin/uvicorn infrastructure.api.main:app \
		--host 0.0.0.0 --port 8000 --reload \
		--reload-dir infrastructure/api \
		--reload-dir domains \
		--reload-dir infrastructure/db & \
	API_PID=$$!; \
	echo "    API pid=$$API_PID — waiting for it to accept connections..."; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		sleep 1; \
		curl -sf http://127.0.0.1:8000/ >/dev/null 2>&1 && break; \
		echo "    waiting... ($$i/10)"; \
	done; \
	echo "    API ready."; \
	cd $(WEB) && npm run dev & WEB_PID=$$!; \
	cd $(ROOT); \
	echo "    Web pid=$$WEB_PID"; \
	echo ""; \
	echo "  API → http://127.0.0.1:8000"; \
	echo "  Web → http://localhost:3000"; \
	echo ""; \
	echo "  Ctrl-C to stop both."; \
	trap "echo ''; echo 'Stopping...'; kill $$API_PID $$WEB_PID 2>/dev/null; wait $$API_PID $$WEB_PID 2>/dev/null; true" INT TERM; \
	wait

prod:
	@echo "==> Starting production API + Web (no reload, 1 worker)..."
	@$(MAKE) kill 2>/dev/null; true
	@$(VENV)/bin/uvicorn infrastructure.api.main:app \
		--host 0.0.0.0 --port 8000 --workers 1 & \
	API_PID=$$!; \
	echo "    API pid=$$API_PID — waiting for it to accept connections..."; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		sleep 1; \
		curl -sf http://127.0.0.1:8000/ >/dev/null 2>&1 && break; \
		echo "    waiting... ($$i/10)"; \
	done; \
	echo "    API ready."; \
	cd $(WEB) && npm start & WEB_PID=$$!; \
	cd $(ROOT); \
	echo "    Web pid=$$WEB_PID"; \
	echo ""; \
	echo "  API → http://0.0.0.0:8000"; \
	echo "  Web → http://0.0.0.0:3000"; \
	echo ""; \
	echo "  Ctrl-C to stop both."; \
	trap "echo ''; echo 'Stopping...'; kill $$API_PID $$WEB_PID 2>/dev/null; wait $$API_PID $$WEB_PID 2>/dev/null; true" INT TERM; \
	wait

kill:
	@echo "==> Killing any processes on ports 8000 and 3000..."
	@lsof -ti:8000 | xargs kill -9 2>/dev/null; true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null; true
	@echo "    Done"

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

# ── Deploy to Pi ──────────────────────────────────────────────────────────────

deploy:
	@echo "==> Syncing code to $(PI_HOST):$(PI_DIR) ..."
	rsync -av --delete \
		--exclude='.git' \
		--exclude='.next' \
		--exclude='node_modules' \
		--exclude='__pycache__' \
		--exclude='*.pyc' \
		--exclude='.venv' \
		--exclude='data/' \
		--exclude='infrastructure/db/*.db' \
		$(ROOT)/ $(PI_HOST):$(PI_DIR)/
	@echo "==> Copying .env.local to Pi ..."
	scp $(WEB)/.env.local $(PI_HOST):$(PI_DIR)/infrastructure/web/.env.local
	@echo "==> Installing deps on Pi ..."
	ssh $(PI_HOST) "cd $(PI_DIR)/infrastructure/web && npm install --include=dev --silent"
	@echo "==> Building frontend on Pi ..."
	ssh $(PI_HOST) "cd $(PI_DIR)/infrastructure/web && npm run build"
	@echo "==> Restarting API on Pi ..."
	ssh $(PI_HOST) "pkill -f uvicorn; sleep 1; cd $(PI_DIR) && nohup .venv/bin/uvicorn infrastructure.api.main:app --host 0.0.0.0 --port 8000 > /tmp/api.log 2>&1 &"
	@echo "==> Restarting web on Pi ..."
	ssh $(PI_HOST) "pkill -f 'next start'; sleep 2; cd $(PI_DIR)/infrastructure/web && nohup npm start > /tmp/web.log 2>&1 &"
	@echo "==> Deploy complete. Check http://daybook-pi:3000"

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
	@echo "  make money-db-init     Create money.db and seed budgets"
	@echo "  make sync-notion       Pull last 90 days of Notion finance data"
	@echo "  make sync-notion-full  Pull full Notion finance history (first run only)"
	@echo "  make import-tracks     Import a location-history JSON: make import-tracks JSON=path/to/file.json"
	@echo "  make geocode-tracks    Geocode un-geocoded tracks (Nominatim, 1 req/sec)"
	@echo "  make api               Start FastAPI dev server (port 8000)"
	@echo "  make web               Start Next.js dev server (port 3000)"
	@echo "  make dev               Start both servers (waits for API before web)"
	@echo "  make prod              Start production servers (no --reload, Pi-safe)"
	@echo "  make kill              Kill anything on ports 8000 and 3000"
	@echo "  make verify            Print coverage + gap report for all domains"
	@echo "  make backup            Snapshot databases to data/backups/"
	@echo "  make clean-pyc         Remove __pycache__ directories"
	@echo "  make deploy            Rsync code to Pi, build frontend, restart services"
	@echo ""
