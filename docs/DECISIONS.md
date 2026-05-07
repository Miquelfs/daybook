# Architecture Decision Records

Lightweight ADR log. Each entry captures what was decided, why, and what was considered and rejected.

---

## ADR-001 — SQLite over PostgreSQL

**Status:** Accepted  
**Date:** 2026-05-07

### Decision
Use SQLite as the single persistence layer, with one database per domain (`daybook.db`, `locations.db`), joined by `date`.

### Rationale
- **One user, one machine.** PostgreSQL's concurrency model solves a problem Daybook does not have.
- **Portability.** A `.db` file can be copied, backed up with `cp`, opened in DB Browser for SQLite, and inspected without a running server.
- **Raspberry Pi 3 target.** SQLite runs comfortably on 1 GB RAM. A Postgres instance adds ~200 MB overhead for nothing.
- **WAL mode** (`PRAGMA journal_mode=WAL`) gives adequate read/write concurrency for a local web app hitting the DB from a single FastAPI process.
- **Durability.** Daily `gzip` backups of the `.db` file to `data/backups/`, weekly snapshot to encrypted cloud. SQLite's file format is one of the most stable on the planet.

### Rejected alternatives
- **PostgreSQL** — operational overhead (daemon, migrations tooling, connection pooling) not justified for a single-user local system.
- **DuckDB** — analytically excellent but overkill; Daybook's queries are simple joins on `date`.
- **InfluxDB / TimescaleDB** — time-series focus is appealing but adds exotic dependencies that won't run well on a Pi 3.

---

## ADR-002 — FastAPI + Next.js over Grafana

**Status:** Accepted  
**Date:** 2026-05-07

### Decision
Build a bespoke FastAPI backend and Next.js frontend rather than wiring metrics into Grafana or another dashboarding tool.

### Rationale
- **This is a journal, not a monitoring dashboard.** Grafana is optimised for time-series metrics, alerts, and ops visibility. Daybook needs subjective entry (questionnaire), freeform notes, "on this day" surfacing, and narrative context — none of which fit Grafana's model.
- **Questionnaire requires write capability.** Grafana is fundamentally read-only from a data perspective. Implementing PATCH/POST flows on top of it would be more work than building a simple FastAPI backend.
- **Ownership of the data contract.** A custom API means the schema, the response shape, and the query logic are in code we control and version. Grafana's panels encode logic in JSON blobs that are hard to audit.
- **The frontend needs to feel like a personal tool.** Field-notes aesthetic, large typography, dark mode, navigation between days — these are not possible in Grafana without significant plugin work.

### Rejected alternatives
- **Grafana** — good for ops dashboards, wrong for reflective journaling.
- **Metabase** — similar objections; no write path, no custom UI.
- **Obsidian plugin** — Obsidian is used as a *source* (long-form notes), not the primary interface. Keeping them separate preserves optionality.
- **Static site generator** — no write path; questionnaire requires a live backend.

---

## ADR-003 — Mac-first development, Raspberry Pi 3 as future server

**Status:** Accepted  
**Date:** 2026-05-07

### Decision
Develop and run Daybook on a Mac (development = production for now). Target a Raspberry Pi 3 as a future always-on home server once the system is stable and used daily.

### Rationale
- **Iterate fast first.** Running on the Mac means no SSH roundtrip, instant hot-reload, full IDE tooling, and no cross-compilation headaches. Phase 1 shipped in days, not weeks.
- **The Pi 3 constraint shapes decisions now.** Every dependency must run on 1 GB RAM, ARMv7. This rules out heavy ML runtimes, Electron, and anything requiring GPU. SQLite, FastAPI, and Next.js all pass this test.
- **Tailscale makes remote access trivial.** When the Pi becomes the server, Tailscale provides encrypted remote access from the phone without exposing anything to the public internet.
- **Docker Compose from day one.** The `infrastructure/docker/` directory is a placeholder that will contain the Pi deployment config. Running on Mac without Docker now does not prevent clean containerisation later.
- **Data lives in files.** SQLite `.db` files and raw JSON payloads in `data/raw/` make migration a literal file copy. No pg_dump, no schema export.

### Rejected alternatives
- **Cloud VM (Hetzner, DigitalOcean, etc.)** — contradicts the local-first principle. Data would leave the machine. Monthly cost forever.
- **NAS (Synology, etc.)** — possible but the Pi 3 is already on hand, runs Linux natively, and is cheaper.
- **Always run on Mac** — the Mac is a laptop; it travels. The Pi is always home, always on, always accessible via Tailscale.

### Migration path
See `docs/MIGRATION.md` for the Pi 3 migration checklist.
