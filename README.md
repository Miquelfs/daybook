# Daybook

One day at a time. Owned, indexed, and made meaningful.

A local-first personal life operating system — health, location, money, aviation, and memory, all indexed by date and owned by me.

**Full vision, principles, architecture, and roadmap → [docs/VISION.md](docs/VISION.md)**

---

## 5-minute quickstart

```bash
# 1. Clone / navigate to the project
cd daybook/

# 2. Bootstrap everything (venv, npm deps, .env)
make setup

# 3. Initialise the database and backfill the days spine
make db-init

# 4. Pull yesterday's health data from Garmin
make sync-garmin

# 5. Start both servers
make dev
# API  → http://127.0.0.1:8000
# Web  → http://localhost:3000
```

Open `http://localhost:3000` — you'll see today's sleep, HRV, and body battery. Fill out the evening questionnaire. Done.

### First-time Garmin setup

If `data/raw/garmin_session/` is empty, set credentials in `.env` before syncing:

```
GARMIN_EMAIL=you@example.com
GARMIN_PASSWORD=yourpassword
```

To pull your full history (one-time, slow):

```bash
make sync-garmin-full
```

---

## Daily routine

**Morning (automated via cron)**
```
0 7 * * * cd /Users/miquelfarre/Desktop/daybook && ./infrastructure/scripts/daily_sync.sh
```
Pulls yesterday's Garmin data silently. Logs to `infrastructure/scripts/logs/`.

**Evening (manual)**
1. Open `http://localhost:3000` (or start with `make dev` if not running)
2. Check the Morning Brief — sleep, HRV, body battery, RHR
3. Check Movement — steps and activities
4. Fill Reflection — energy/mood/stress sliders, notes, daily question
5. Navigate to any past day via the Timeline

---

## Key commands

| Command | What it does |
|---|---|
| `make setup` | Bootstrap: venv, npm deps, .env |
| `make db-init` | Create daybook.db, backfill days spine |
| `make sync-garmin` | Pull yesterday's Garmin data |
| `make sync-garmin-full` | Pull full Garmin history (first run) |
| `make api` | Start FastAPI only (port 8000) |
| `make web` | Start Next.js only (port 3000) |
| `make dev` | Start both servers |
| `make verify` | Coverage + gap report for all domains |
| `make backup` | Snapshot databases to `data/backups/` |
| `make clean-pyc` | Remove `__pycache__` directories |
| `make help` | Full target list |

---

## Project layout

```
daybook/
├── domains/
│   ├── health/garmin/      Garmin sync, import, verify
│   ├── locations/          Google Maps Timeline query helpers
│   └── ...                 money, aviation, personal, memory (Phase 2+)
├── infrastructure/
│   ├── db/                 SQLite schema, connection, init, backfill
│   ├── api/                FastAPI backend (port 8000)
│   ├── web/                Next.js frontend (port 3000)
│   └── scripts/            daily_sync.sh, backup.sh, cron
├── insights/               correlations, anomalies, reviews (Phase 2)
├── docs/
│   ├── VISION.md           Full project vision and roadmap
│   ├── DECISIONS.md        Architecture Decision Records (ADRs)
│   └── MIGRATION.md        Pi 3 migration checklist (TODO)
├── data/
│   ├── raw/                Gitignored — raw API payloads and session tokens
│   └── backups/            Gitignored — timestamped database snapshots
├── Makefile                All orchestration targets
├── .env.example            Environment variable template
└── CHANGELOG.md            Day-by-day build log
```

---

## Architecture in one paragraph

FastAPI backend reads from SQLite (`daybook.db` for health + subjective data, `locations.db` for Google Maps history). Python sync scripts pull from Garmin Connect daily via cron. The Next.js frontend fetches from the local API and auto-saves evening questionnaire answers. Everything runs on localhost; Tailscale provides remote access from a phone. See [docs/DECISIONS.md](docs/DECISIONS.md) for why SQLite, why FastAPI+Next.js, and why Mac-first.

---

## Docs

| Document | Purpose |
|---|---|
| [docs/VISION.md](docs/VISION.md) | Why this exists, principles, full roadmap |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Future Raspberry Pi 3 migration checklist |
| [CHANGELOG.md](CHANGELOG.md) | What was built, changed, or fixed each day |
| [infrastructure/web/README.md](infrastructure/web/README.md) | Frontend dev guide |
| [domains/health/garmin/README.md](domains/health/garmin/README.md) | Garmin sync setup and runbook |
