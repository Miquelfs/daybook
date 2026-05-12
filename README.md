# Daybook

One day at a time. Owned, indexed, and made meaningful.

A local-first personal life operating system — health, location, money, aviation, and memory, all indexed by date and owned by me.

**Full vision, principles, architecture, and roadmap → [docs/VISION.md](docs/VISION.md)**

---

## 5-minute quickstart

```bash
# 1. Navigate to the project
cd daybook/

# 2. Bootstrap everything (venv, npm deps, .env)
make setup

# 3. Initialise the databases
make db-init          # daybook.db (health + questionnaire)
make money-db-init    # money.db (finance)

# 4. Pull data from external sources
make sync-garmin      # yesterday's health from Garmin
make sync-notion-full # full Notion finance history (first run)

# 5. Start both servers
make dev
# API  → http://127.0.0.1:8000
# Web  → http://localhost:3000
```

Open `http://localhost:3000` — you'll see today's sleep, HRV, body battery, and expenses. Fill out the evening questionnaire. Done.

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

### First-time Notion finance setup

Credentials are pre-configured in `.env`. Just run:

```bash
make money-db-init    # create money.db if not already done
make sync-notion-full # import full Notion transaction history
```

---

## Daily routine

**Morning (automated via cron + auto-sync on page load)**
```
0 7 * * * cd /Users/miquelfarre/Desktop/daybook && ./infrastructure/scripts/daily_sync.sh
```
Pulls yesterday's Garmin data silently. Also fires automatically when you open the Today view.

**Evening (manual)**
1. Open `http://localhost:3000` or the Daybook PWA on your phone
2. Check the Morning Brief — sleep, HRV, body battery, RHR
3. Check Movement — steps and activities
4. Check Money — expenses for the day; tap **+ Add** to log anything missed
5. Fill Reflection — energy/mood/stress sliders, notes, daily question
6. Navigate to any past day via the Timeline

---

## Key commands

| Command | What it does |
|---|---|
| `make setup` | Bootstrap: venv, npm deps, .env |
| `make db-init` | Create daybook.db, backfill days spine |
| `make money-db-init` | Create money.db, seed budget categories |
| `make sync-garmin` | Pull yesterday's Garmin data |
| `make sync-garmin-full` | Pull full Garmin history (first run) |
| `make sync-notion` | Pull last 90 days of Notion finance data |
| `make sync-notion-full` | Pull full Notion finance history (first run) |
| `make import-tracks JSON=path` | Import a Google Maps Timeline JSON |
| `make geocode-tracks` | Geocode un-geocoded GPS tracks (run overnight) |
| `make api` | Start FastAPI only (port 8000) |
| `make web` | Start Next.js only (port 3000) |
| `make dev` | Start both servers |
| `make verify` | Coverage + gap report for all domains |
| `make backup` | Snapshot databases to `data/backups/` |
| `make help` | Full target list |

---

## Project layout

```
daybook/
├── domains/
│   ├── health/garmin/      Garmin sync, import, verify
│   ├── locations/          GPS tracks, geocoding, Overland processing
│   ├── money/              Notion sync, classification, DB init
│   └── ...                 aviation, personal, memory (Phase 2+)
├── infrastructure/
│   ├── db/                 SQLite schemas, connections (daybook.db + money.db + locations.db)
│   ├── api/                FastAPI backend (port 8000)
│   │   ├── routers/        days, locations, money, questionnaire, insights
│   │   └── models/         Pydantic models per domain
│   ├── web/                Next.js frontend (port 3000)
│   │   ├── app/            Pages: /, /day/[date], /timeline, /explore, /money
│   │   ├── components/     DayHeader, MorningBrief, MovementBlock, LocationMap,
│   │   │                   HeatMap, Questionnaire, SyncOnLoad, money/*
│   │   └── lib/            api.ts, money-api.ts
│   └── scripts/            daily_sync.sh, backup.sh, cron
├── insights/               correlations, anomalies, reviews (Phase 2)
├── docs/
│   ├── VISION.md           Full project vision and roadmap
│   ├── DECISIONS.md        Architecture Decision Records (ADRs)
│   ├── PHONE_SETUP.md      How to use Daybook on your iPhone via Tailscale + PWA
│   └── MIGRATION.md        Pi 3 migration checklist (future)
├── data/
│   ├── raw/                Gitignored — raw API payloads and session tokens
│   └── backups/            Gitignored — timestamped database snapshots
├── Makefile                All orchestration targets
├── .env                    Local credentials (gitignored)
├── .env.example            Environment variable template
└── CHANGELOG.md            Day-by-day build log
```

---

## Architecture in one paragraph

Three SQLite databases: `daybook.db` (health, questionnaire), `locations.db` (GPS tracks, visits), `money.db` (transactions, budgets). FastAPI backend exposes domain-specific routers (`/days`, `/locations`, `/money`, `/questionnaire`). Python sync scripts pull from Garmin Connect (daily via cron or on-demand), Notion (incremental), and Overland iOS (live GPS ingest). The Next.js frontend serves as a PWA — accessible locally at `localhost:3000` or remotely from your iPhone via Tailscale. See [docs/DECISIONS.md](docs/DECISIONS.md) for architectural rationale and [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md) for the iPhone setup guide.

---

## Databases

| DB | Size | Contents |
|---|---|---|
| `daybook.db` | ~2 MB | 5,971 days, sleep, daily stats, HRV, activities, sync log |
| `locations.db` | ~14 MB | 19,676 visits, 22,408 GPS track segments, place names |
| `money.db` | grows | transactions (Notion + local), budgets, sync log |

---

## Docs

| Document | Purpose |
|---|---|
| [docs/VISION.md](docs/VISION.md) | Why this exists, principles, full roadmap |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records |
| [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md) | iPhone access via Tailscale + PWA + Overland |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Future Raspberry Pi 3 migration checklist |
| [CHANGELOG.md](CHANGELOG.md) | What was built, changed, or fixed each day |
| [infrastructure/web/README.md](infrastructure/web/README.md) | Frontend dev guide |
| [domains/health/garmin/README.md](domains/health/garmin/README.md) | Garmin sync setup and runbook |
