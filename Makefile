# Daybook — orchestration
# All targets run from the daybook/ root directory.
# Usage: make <target>

SHELL := /bin/bash
ROOT  := $(shell pwd)
VENV  := $(ROOT)/.venv
PY    := $(VENV)/bin/python
WEB   := $(ROOT)/infrastructure/web

.PHONY: setup db-init money-db-init sync-garmin sync-garmin-full sync-notion sync-notion-full sync-strava sync-strava-full strava-auth import-tracks geocode-tracks aviation-init import-full-csv import-aerolink api web dev prod kill cron-install cron-remove verify backup clean-pyc deploy help

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

sync-strava:
	@echo "==> Syncing Strava enrichment (last 30 days)..."
	$(PY) -m domains.health.strava.strava_sync --days 30
	@echo "==> Strava sync done"

sync-strava-full:
	@echo "==> Syncing Strava enrichment (full history, slow)..."
	$(PY) -m domains.health.strava.strava_sync --full-history
	@echo "==> Full Strava sync done"

aviation-init:
	@echo "==> Creating aviation tables and seeding airports..."
	$(PY) -m infrastructure.db.migrate_aviation
	@echo "==> Aviation DB ready. Run: make import-full-csv import-aerolink"

import-full-csv:
	@echo "==> Importing Full.csv (previous airline flights)..."
	$(PY) -m domains.aviation.importers.full_csv_importer
	@echo "==> Full.csv import done"

import-aerolink:
	@echo "==> Importing Aerolink.xls (training + early career)..."
	$(PY) -m domains.aviation.importers.aerolink_importer
	@echo "==> Aerolink import done"

strava-auth:
	@echo "==> Strava OAuth setup"
	@echo "    1. Open this URL in your browser:"
	@$(PY) -c "import os; from dotenv import load_dotenv; load_dotenv(); cid=os.getenv('STRAVA_CLIENT_ID',''); redirect=os.getenv('STRAVA_REDIRECT_URI','http://localhost:8000/strava/callback'); print(f'   https://www.strava.com/oauth/authorize?client_id={cid}&redirect_uri={redirect}&response_type=code&approval_prompt=auto&scope=activity:read_all')"
	@echo "    2. Authorize the app."
	@echo "    3. You will be redirected to http://localhost:8000/strava/callback?code=XXXX"
	@echo "       The API server handles token exchange automatically."
	@echo "    4. Run: make sync-strava"

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
	@fuser -k 8000/tcp 2>/dev/null; true
	@fuser -k 3000/tcp 2>/dev/null; true
	@echo "    Done"

cron-install:
	@echo "==> Installing daily sync cron job..."
	@chmod +x $(ROOT)/infrastructure/scripts/daily_sync.sh
	@CRON_LINE="0 * * * * cd $(ROOT) && $(ROOT)/infrastructure/scripts/daily_sync.sh >> $(ROOT)/infrastructure/scripts/logs/cron.log 2>&1"; \
	( crontab -l 2>/dev/null | grep -v "daily_sync.sh"; echo "$$CRON_LINE" ) | crontab -
	@echo "    Cron job installed: runs daily_sync.sh every hour"
	@echo "    View with: crontab -l"
	@echo "    Logs at:   infrastructure/scripts/logs/"

cron-remove:
	@echo "==> Removing daily sync cron job..."
	@( crontab -l 2>/dev/null | grep -v "daily_sync.sh" ) | crontab -
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
		--exclude='infrastructure/db/*.db-wal' \
		--exclude='infrastructure/db/*.db-shm' \
		--exclude='infrastructure/scripts/logs/' \
		--exclude='nohup.out' \
		--exclude='.env' \
		$(ROOT)/ $(PI_HOST):$(PI_DIR)/
	@echo "==> Copying .env.local to Pi ..."
	scp $(WEB)/.env.local $(PI_HOST):$(PI_DIR)/infrastructure/web/.env.local
	@echo "==> Installing deps on Pi ..."
	ssh $(PI_HOST) "cd $(PI_DIR)/infrastructure/web && npm install --include=dev --silent"
	@echo "==> Building frontend on Pi ..."
	ssh $(PI_HOST) "cd $(PI_DIR)/infrastructure/web && npm run build"
	@echo "==> Restarting services on Pi ..."
	ssh $(PI_HOST) "sudo systemctl restart daybook-api daybook-web"
	@echo "==> Deploy complete. http://100.67.252.76:3000"


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
	@echo "  make strava-auth       Print Strava OAuth URL for first-time setup"
	@echo "  make sync-strava       Pull last 30 days of Strava enrichment"
	@echo "  make sync-strava-full  Pull full Strava history (first run only)"
	@echo "  make aviation-init     Create aviation tables and seed airports (first run only)"
	@echo "  make import-full-csv   Import Full.csv from previous airline"
	@echo "  make import-aerolink   Import Aerolink.xls (training + early career)"
	@echo "  make cron-install      Install hourly cron job (Garmin + Notion sync)"
	@echo "  make cron-remove       Remove the hourly sync cron job"
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
