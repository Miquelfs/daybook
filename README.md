# Daybook

One day at a time. Owned, indexed, and made meaningful.

A local-first personal life operating system — health, location, money, aviation, and memory, all indexed by date and owned by me.

**The full vision, principles, architecture, and roadmap live in [docs/VISION.md](docs/VISION.md).**

---

## Quick start

```bash
# Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Copy and fill in secrets
cp .env.example .env
```

## Project layout

```
daybook/
├── domains/        one folder per data domain (health, money, aviation…)
├── infrastructure/ db, api, web, docker, scripts
├── insights/       correlations, anomalies, reviews
├── docs/           vision and technical docs
└── data/           gitignored — raw payloads and backups
```

See [CHANGELOG.md](CHANGELOG.md) for what's changed and when.
