# Daybook
**One day at a time. Owned, indexed, and made meaningful.**

A local-first personal life operating system. A time-indexed journal where every day is a row, and every facet of life — health, location, money, work, mood, memory — attaches to it.

Built by one person, for one person, with the option to share later.

---

## Why this exists

Every meaningful piece of personal data lives somewhere I don't control. Garmin owns my sleep history. Google owns where I've been for the last decade. Notion owns my expenses. The airline owns my flight hours. Strava owns my runs. Apple owns my photos. None of them talk to each other. All of them charge me. Any of them can change their terms, raise prices, shut down, or lose my data.

This is not acceptable for the substance of a life.

Daybook is the answer: a single local system where all of it converges, where I can ask questions across domains, where my data outlives any company, and where the design serves *me* — not retention metrics or upsell flows.

It's also the system I want to use every day. A place to look back. A place to notice patterns. A place to write things down that matter.

---

## Principles

1. **Local-first, always.** Data lives on my machines. Cloud is a backup tier, never a dependency. The system must work fully offline.
2. **One day at a time.** The atomic unit is a Day. Every feature attaches to this primitive.
3. **Own the inputs.** Prefer raw data ingestion over polished APIs. Store full payloads even when only parsing fragments. The schema can change; the data can't be re-fetched.
4. **Boring tech.** Python, SQLite, FastAPI, Next.js, Docker. No exotic dependencies. Anything I add must run on a Raspberry Pi 3 eventually.
5. **Built for the long arc.** This system should still work in 20 years. That means standard formats, simple architecture, no vendor lock-in, exportable everything.
6. **AI as a lens, not a bottleneck.** AI helps me see patterns and surface memories. It does not gate functionality. The system works without it.
7. **Use what already works.** The existing finance_dashboard stays alive until the native version proves itself. Garmin, Strava, Notion remain inputs. Don't break what runs.
8. **Built for me first.** No premature generalization. Every feature must serve a real problem in my actual life. Sharing is a future question.

---

## The vision

**A timeline I can scrub.** Move backwards through my life day by day. See what I did, where I was, how I felt, what I spent, who I was with.

**A correlation engine.** Surface patterns I'd never spot manually: HRV vs. duty days, mood vs. travel, spending vs. social activity, sleep vs. crossing time zones.

**A memory machine.** "On this day" three years ago. The photos I took. The flight I flew. The restaurant I ate at. The mood I logged.

**A reflection prompt.** A 30-second evening ritual. Energy, mood, stress, plus one rotating question. Builds a corpus of self-knowledge over years.

**An aviation-aware second brain.** I'm a pilot. My life has unusual rhythms. No tool on the market understands that. Daybook will help me identify fatigue tracking, time zone load, duty-day patterns.

**A natural language interface.** Eventually: *"show me weekends I cycled and felt good."* Initially: structured search and filters. Later: local LLM over my own data.

---

## Scope

### In scope

- **Health.** Garmin (primary): sleep, HRV, activities, steps, stress, body battery, resting HR. Strava (secondary): workouts, GPS routes. Future: Apple Health, manual weight, hydration.
- **Locations.** Google Takeout history (2015 onwards). Future: live ingestion from phone or custom GPS device.
- **Money.** Notion expenses (existing, imported). Native expense entry replacing Notion input over time. Categories, merchants, recurring expenses, budgets.
- **Aviation.** Flight logbook ingestion. Type ratings, medical, recurrency tracking. Layover and duty-day awareness.
- **Personal.** Obsidian vault as long-form notes. Daily questionnaire. Decision log. Tags. Free-form journal entries.
- **Memory.** Photo. On-this-day surfacing. Yearly review artifacts.
- **Audio.** Voice memos transcribed locally via Whisper. Searchable across years.
- **Insights.** Correlation engine. Anomaly detection. Streaks. Weekly/monthly/yearly review summaries.

### Explicitly out of scope (for now)

- Multi-user. This is a one-person system.
- Social features. No sharing, no comparison, no friends.
- Web hosting as a product. Local + Tailscale only.
- Real-time everything. Daily sync is fine. Hourly is overkill.
- Wearable hardware (Pi Pico GPS device). Garmin covers this. Revisit after the software is mature.
- E-paper display device. Separate project (pi-reader).

### Future scope

- Local LLM for natural language queries (Ollama on a Pi 4 or M-series Mac).
- Custom audio note hardware (Pi Zero 2W + mic + button).
- E-ink Day View display for the home.
- Friend/person tagging across expenses, photos, notes.
- Open source release for other technical users.

---

## Architecture

### Stack

```
Mac (development + production for now)
 │
 ├── SQLite databases (per-domain, joined by date)
 │    └── infrastructure/db/
 │
 ├── Python sync scripts (cron-driven)
 │    └── one per data source, idempotent, raw-first
 │
 ├── FastAPI backend (~200 lines, local only)
 │    └── /day/{date}, /range, /search, /correlate, /log
 │
 ├── Next.js web app (PWA on phone via Tailscale)
 │    └── Today, Day Detail, Timeline, Maps, Insights
 │
 └── Docker Compose orchestration
      └── Portable to Raspberry Pi 3 server later
```

### The Day primitive

Every domain table has a `date` column. The `days` table is the spine:

```sql
CREATE TABLE days (
    date            TEXT PRIMARY KEY,
    -- subjective state, populated by evening questionnaire
    energy          INTEGER,        -- 1-10
    mood            INTEGER,        -- 1-10
    stress          INTEGER,        -- 1-10
    sleep_quality   INTEGER,        -- 1-10, subjective
    notes           TEXT,           -- free-text reflection
    daily_question  TEXT,           -- the question that was asked
    daily_answer    TEXT,           -- one-sentence answer
    tags            TEXT,           -- comma-separated custom tags
    -- aviation context
    duty_day        BOOLEAN,
    away_from_base  BOOLEAN,
    timezone_offset INTEGER,
    created_at      TEXT,
    updated_at      TEXT
);
```

Every other table joins to this. Joins on `date` are fast in SQLite.

### Module structure

```
daybook/
├── domains/
│   ├── health/         Garmin + Strava sync
│   ├── locations/      Google Takeout import + future live GPS
│   ├── money/          Notion sync + native entry API
│   ├── aviation/       Logbook ingestion + duty-day logic
│   ├── personal/       Questionnaire, journal, decisions, tags
│   └── memory/         Photo metadata, audio notes, on-this-day
├── infrastructure/
│   ├── db/             SQLite databases (gitignored)
│   ├── api/            FastAPI backend
│   ├── web/            Next.js frontend
│   ├── docker/         Compose files
│   └── scripts/        Sync orchestration, cron, backups
├── insights/
│   ├── correlations/   Statistical analysis jobs
│   ├── anomalies/      Outlier detection
│   └── reviews/        Weekly/monthly/yearly summaries
└── docs/               This file and others
```

---

## Roadmap

### Phase 1 — Spine ✅ COMPLETE (2026-05-07)
The foundation. Get one full pipeline working end-to-end.

- ✅ Project scaffold, venv, environment config
- ✅ SQLite schema for days, health, activities
- ✅ Garmin sync: full historical pull + daily incremental (5,971 days, auto-syncs on Today page load)
- ✅ FastAPI backend with `/day/{date}`, `/range`, PATCH endpoints
- ✅ Next.js Today view + Day Detail view + Timeline
- ✅ Evening questionnaire (energy, mood, stress, free text, rotating question)
- ✅ Makefile orchestration (setup, dev, sync, backup, verify)

### Phase 2 — Brain ✅ COMPLETE (2026-05-15)
Add the other major domains and start surfacing intelligence.

- ✅ GPS track import (22,408 segments from Google Maps Timeline 2013–2026)
- ✅ Leaflet day-view map (polyline + named stops)
- ✅ Overland iOS live location ingestion (`POST /locations/ingest/overland`)
- ✅ World heatmap + `/explore` page (country/city stats, year filter)
- ✅ Finance domain: `money.db`, Notion sync, 13 API endpoints, full analytics suite
- ✅ Transaction entry, inline editing (name/sign/amount/category/account), deletion
- ✅ `/money/overview` — burn rate, daily projections, budget alerts
- ✅ `/money/trends` — savings streak, forecast, charts, anomaly detection, CSV export
- ✅ `/money/portfolio` — net worth, investment vs liquid, account classification
- ✅ `/money/category/[cat]` — per-category drill-down with transaction history
- ✅ Hourly cron: Garmin + Overland + Notion sync running autonomously on Pi
- ✅ Pi production deployment: systemd services (auto-start, auto-restart), `make deploy` pipeline
- ✅ Anomaly detection: large transactions (>3× avg) + category spikes (>1.5× 12-month avg)
- ⏳ Background geocoding (~8% complete; run `caffeinate -i python -m domains.locations.geocode_tracks`)
- ⏳ Aviation logbook CSV import + Day-view flight strip
- ⏳ Correlation engine (Pearson correlations across domains)
- ⏳ "On this day" widget on Today view

### Phase 2.5 — Daily usability ✅ COMPLETE (2026-05-18)
Make it something worth opening every single day.

- ✅ **Photo of the day** — upload from phone gallery (HEIC→JPEG conversion), stored on Pi, displayed on Today + all day pages; `/moments` library page
- ✅ **Questionnaire overhaul** — compact Today pill row (Outdoors, Social, Work, S.I. with rating, Drinks with count); "With" smart autocomplete from history; Past 7 days collapsible
- ✅ **People tracking** — `with:Name` tags stored per day; autocomplete from 90-day history; foundation for future correlation (who I'm with vs mood/spend/sleep)
- ✅ **Money sign fix** — reimbursements/income correctly offset daily spending total
- ✅ **Account color badges** — 12 accounts color-coded to match Notion palette
- ✅ **Location polish** — max 10 named stops on Today, deduped; dwell thresholds tuned for sparse iPhone tracking days
- ✅ **Nav bar** — Timeline before Finance; Camera/Moments icon added
- ✅ Photo dot on Timeline cards when photo is logged

### Phase 3 — Self ✅ COMPLETE (2026-06-05)
The features that make it personal and reflective over time.

**Implemented (beyond Phase 2.5):**
- ✅ Aviation logbook — full CSV import (Full.csv / Aerolink), 45+ endpoint API, logbook stats, currency tracking, EASA/Excel/PDF/CSV exports, routes map, analytics (delays, fuel, pax, YoY)
- ✅ "On this day" — same date in previous years: HRV, mood, location, spend surfaced on Today
- ✅ Correlation engine — Pearson r across all domains (energy, mood, HRV, steps, spend, screen time, aviation), top correlations, scatter plots, weekly stats, journal search
- ✅ Books domain — reading log, stats by year/genre/author/language, cover fetching, Goodreads import
- ✅ Life in Weeks — 90×52 grid, life periods (color-coded, layered), life events with photos
- ✅ Screen time — iPhone Shortcuts ingest, per-app breakdown, `/screen-time` API
- ✅ Weather — historical sync via Open-Meteo, condition auto-tagging
- ✅ Health trends + training analytics — HRV/sleep/stress dashboards, weekly load, personal records, best efforts, Strava integration (segments, segment efforts, polylines)
- ✅ Tags system — structured day tags with categories, icons, per-day notes
- ✅ Contacts + companions — people tracking per day (with:Name expanded to full contacts table)
- ✅ Money enhancements — category detail pages, month navigation, Notion sync button, FAB

**Done when:** I voluntarily open this every morning and every evening. It feels like a tool I trust.

### Phase 4 — Native iOS App 🔄 NEXT (started 2026-06-05)
Take Daybook from a web app accessed via Tailscale to a native Swift/SwiftUI iOS app installed via Xcode. The Pi remains the single source of truth; the app is a thin client with offline write capabilities.

Full plan: `.claude/plans/hello-claude-can-you-mutable-parrot.md`

**Phase 4.0 — Foundation:**
- ⏳ Xcode project scaffold (`com.miquelfarr.daybook`, iOS 17, SwiftUI)
- ⏳ `DaybookAPIClient` actor, `OfflineQueue` actor, `NWPathMonitor` connectivity
- ⏳ `NSAppTransportSecurity` for HTTP over Tailscale
- ⏳ 5-tab navigation: Today, Aviation, Money, Explore, Settings

**Phase 4.1 — Daily Core:**
- ⏳ Today view (HRV, sleep, steps, body battery, flights, tags)
- ⏳ Evening questionnaire — offline-capable (CryptoKit MD5, hardcoded questions)
- ⏳ Photo upload (PHPicker → multipart POST)
- ⏳ Day detail view (read-only)

**Phase 4.2 — Data Reading:**
- ⏳ Health trends (Swift Charts)
- ⏳ Activities list + detail (MapKit polyline)
- ⏳ Money overview + transactions
- ⏳ Aviation logbook (read-only) + currency badge
- ⏳ Books list + stats

**Phase 4.3 — Active Input:**
- ⏳ Flight logging form with offline queue (replaces needing a laptop at the gate)
- ⏳ Expense entry FAB with 8-second UX target
- ⏳ Book logging sheet
- ⏳ Overland deep link integration

**Phase 4.4 — Insights:**
- ⏳ Correlations explorer (scatter plot, top correlations)
- ⏳ Life in Weeks grid (LazyVGrid / Canvas)
- ⏳ Location heatmap (WKWebView + Leaflet bridge)
- ⏳ Training dashboard, Timeline, Sync controls in Settings

**Done when:** I log flights from the cockpit without a laptop, fill the questionnaire in bed, and the Pi web app is a secondary interface.

### Phase 5 — Spark (ongoing)
The advanced features. Build only after Phase 4 is stable and used daily.

- ⏳ Local LLM (Ollama) for natural language search: *"show me weekends I cycled and felt good"*
- ⏳ Voice memo recording + Whisper transcription
- ⏳ Aviation duty-day fatigue pattern analysis (HRV vs. duty days, time zone load)
- ⏳ "Was today different?" widget — automatic anomaly surfacing across all domains
- ⏳ Custom audio note hardware (Pi Zero 2W + mic + button)
- ⏳ **Receipt photos + OCR** — attach a photo of a receipt to any transaction; OCR via Tesseract locally; structured parsing for line-item extraction. Enables grocery analytics.

**Done when:** the system is teaching me things about my life I didn't know.

---

## Risks and how I'm handling them

- **Credential exposure.** All secrets in `.env`, never committed. Long-term: 1Password CLI integration. The project folder never syncs to iCloud or Dropbox unencrypted.
- **Unofficial APIs breaking.** `python-garminconnect` is unofficial. Mitigation: store raw JSON payloads always; periodic manual Garmin Connect exports as backup; abstract the sync layer so swapping libraries is one file.
- **Scope creep.** The whole point of phases. No Phase 2 work until Phase 1 is genuinely used daily for two weeks.
- **Data loss.** Daily SQLite backups to external drive via cron. Weekly snapshot to encrypted cloud (Backblaze or similar).
- **Format changes.** Google Takeout has already changed format twice. Importers must store raw input + parse separately. Re-parse from raw if format changes.
- **Becoming a project about the project.** The biggest risk. Mitigation: every Sunday, ask "did I use it this week?" If no, stop building and start using.

---

## What this is not

It is not a product. It is not for sale. It does not need users. It does not need to be perfect. It does not need to be pretty (yet). It does not need to be finished.

It is a tool for one person to live a more examined life with the data they already generate every day.

If, in two years, it has become something other people would benefit from, that question can be asked then.

*Started: May 2026.*
