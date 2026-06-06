# Daybook

One day at a time. Owned, indexed, and made meaningful.

A local-first personal life operating system — health, location, money, aviation, and memory, all indexed by date and owned by me.

**Full vision, principles, architecture, and roadmap → [docs/VISION.md](docs/VISION.md)**

---

## Current status — Phase 2 complete (2026-05-15)

Running on a Raspberry Pi, accessible from any device via Tailscale.

| | |
|---|---|
| **App** | `http://100.67.252.76:3000` |
| **API** | `http://100.67.252.76:8000` |
| **Services** | systemd (`daybook-api` + `daybook-web`) — auto-start on boot |
| **Sync** | hourly cron: Garmin + Notion + Overland |
| **Deploy** | `make deploy` from Mac |

---

## What's built

**Health**
- Garmin sync: 5,971 days of sleep, HRV, steps, activities, body battery (2010 → today)
- Auto-syncs today's data on every hourly cron run
- Today view: sleep duration, HRV, body battery, steps, activities
- Evening questionnaire: energy/mood/stress sliders, notes, rotating daily question

**Locations**
- 22,408 GPS track segments from Google Maps Timeline (2013–2026)
- Overland iOS live location ingest running
- Day view: Leaflet polyline map with named stops
- `/explore` page: world heatmap, country/city stats, year filter

**Finance**
- 363 transactions synced from Notion; incremental sync hourly
- `/money` — budget overview, category progress bars, recent transactions
- `/money/overview` — daily burn rate, projections, budget alerts
- `/money/trends` — savings streak, income vs expenses chart, forecast, anomaly detection, CSV export
- `/money/portfolio` — net worth, investment vs liquid, account classification
- `/money/category/[cat]` — per-category drill-down
- Add transactions (bottom sheet), edit inline (name/sign/amount/category/account), delete

---

## 5-minute quickstart (fresh Mac setup)

```bash
cd daybook/
make setup          # venv, npm deps, .env template
make db-init        # daybook.db (health + questionnaire)
make money-db-init  # money.db (finance)
make sync-garmin    # yesterday's Garmin data
make sync-notion    # last 90 days of Notion finance
make dev            # API → :8000  Web → :3000
```

Open `http://localhost:3000`.

---

## Daily routine

**Automated (hourly cron on Pi)**
- Garmin sync: today's steps/sleep always fresh
- Notion sync: new transactions appear automatically
- Overland: live GPS points processed

**Evening (manual)**
1. Open `http://100.67.252.76:3000` or the Daybook PWA on your phone
2. Check Morning Brief — sleep, HRV, body battery, RHR
3. Check Movement — steps, activities
4. Check Money — today's spend; tap **+ Add** to log anything missed
5. Fill Reflection — energy/mood/stress, notes, daily question

---

## Key commands

| Command | What it does |
|---|---|
| `make deploy` | Rsync to Pi, build frontend, restart services |
| `make dev` | Start API + Web locally (Mac dev) |
| `make sync-garmin` | Incremental Garmin sync |
| `make sync-garmin-full` | Full Garmin history (first run only) |
| `make sync-notion` | Last 90 days of Notion finance |
| `make sync-notion-full` | Full Notion history (first run only) |
| `make import-tracks JSON=path` | Import Google Maps Timeline JSON |
| `make geocode-tracks` | Geocode GPS tracks via Nominatim (run overnight) |
| `make backup` | Snapshot all databases to `data/backups/` |
| `make verify` | Coverage + gap report for all domains |
| `make help` | Full target list |

---

## Project layout

```
daybook/
├── domains/
│   ├── health/garmin/      Garmin sync, verify
│   ├── locations/          GPS import, geocoding, Overland processing
│   └── money/              Notion sync, classification, config, DB init
├── infrastructure/
│   ├── db/                 SQLite schemas + connections (daybook.db, money.db, locations.db)
│   ├── api/
│   │   ├── routers/        days, locations, money, questionnaire, insights
│   │   └── models/         Pydantic models per domain
│   ├── web/
│   │   ├── app/            /, /day/[date], /timeline, /explore, /money, /money/*
│   │   ├── components/     DayHeader, MorningBrief, LocationMap, HeatMap, money/*
│   │   └── lib/            api.ts, money-api.ts
│   ├── scripts/            daily_sync.sh, backup.sh
│   └── systemd/            daybook-api.service, daybook-web.service
├── docs/
│   ├── VISION.md           Why this exists, principles, roadmap
│   ├── DECISIONS.md        Architecture Decision Records
│   ├── MIGRATION.md        Pi deployment runbook (live ops + disaster recovery)
│   └── PHONE_SETUP.md      iPhone access via Tailscale + PWA + Overland
├── data/
│   ├── raw/                Gitignored — Garmin session tokens, raw payloads
│   └── backups/            Gitignored — daily database snapshots
├── Makefile
├── .env                    Local credentials (gitignored — never commit)
├── .env.example            Environment template
└── CHANGELOG.md            Day-by-day build log
```

---

## Architecture

Three SQLite databases (`daybook.db`, `locations.db`, `money.db`) joined by `date`. FastAPI backend exposes domain routers. Python sync scripts pull from Garmin Connect (cron + on-demand), Notion (incremental), and Overland iOS (live GPS). Next.js frontend is a PWA accessible via Tailscale from any device.

The key architectural constraint: `NEXT_PUBLIC_API_URL` is baked into the Next.js bundle at build time. Always access the app from `http://100.67.252.76:3000` (the Tailscale IP) — other URLs cause client-side fetch failures even with correct CORS headers.

---

## Databases

| DB | Contents |
|---|---|
| `daybook.db` | 5,971+ days, sleep, daily stats, HRV, activities, questionnaire, sync log |
| `locations.db` | 19,676 visits, 22,408 GPS segments, place names (2013–2026) |
| `money.db` | 363+ transactions, budgets, sync log |

---

## Docs

| Document | Purpose |
|---|---|
| [docs/VISION.md](docs/VISION.md) | Why this exists, principles, full roadmap |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Pi deployment runbook + disaster recovery |
| [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md) | iPhone access via Tailscale + PWA + Overland |
| [CHANGELOG.md](CHANGELOG.md) | What was built, changed, or fixed each session |
