# Garmin sync

Pulls sleep, daily stats, HRV, and activities from Garmin Connect into daybook.db.

## First-time setup

1. Add credentials to `.env` at the daybook root:
   ```
   GARMIN_EMAIL=you@example.com
   GARMIN_PASSWORD=yourpassword
   ```

All commands run from the `daybook/` root directory.

2. If you have pre-existing raw JSON files (e.g. from a previous export), import them without hitting the API:
   ```bash
   python -m domains.health.garmin.import_raw \
       --source-dir /path/to/existing/garmin/raw/
   ```
   The default source-dir is `data/raw/garmin/` (relative to daybook root).

3. Pull the full history from Garmin Connect (first live API run — takes a while):
   ```bash
   python -m domains.health.garmin.garmin_sync --full-history
   ```
   Session tokens are cached at `data/raw/garmin_session/session.json` — you won't need to re-authenticate on every run.

## Daily incremental sync

```bash
python -m domains.health.garmin.garmin_sync
# defaults: yesterday → today, all types
```

To sync a specific range:
```bash
python -m domains.health.garmin.garmin_sync --start-date 2026-01-01 --end-date 2026-02-01
```

To sync only certain data types:
```bash
python -m domains.health.garmin.garmin_sync --types sleep,hrv
```

## Coverage report

```bash
python -m domains.health.garmin.garmin_verify
```

Shows row counts, date ranges, gaps, and sync log history for every health table.

## What to do when Garmin breaks the unofficial API

`python-garminconnect` is not an official library. When it breaks:

1. **Don't panic.** All raw payloads are stored in `data/raw/garmin/` and in the `raw_json` column. No data is lost.
2. Check the [python-garminconnect releases](https://github.com/cyberjunky/python-garminconnect/releases) — a fix usually appears within days.
3. Update the package: `pip install --upgrade garminconnect`
4. If the API has changed structurally, update the parser functions in `garmin_sync.py`. The raw data is always preserved, so you can re-parse without re-fetching using `import_raw.py --force`.
5. As a fallback, do a manual Garmin Connect export (Settings → Data Management → Export) and re-import.

## Files

| File | Purpose |
|---|---|
| `garmin_client.py` | Login + session caching |
| `garmin_sync.py` | Live API sync (per-date loop) |
| `import_raw.py` | Bootstrap from existing raw JSON files |
| `garmin_verify.py` | Coverage report + gap detection |
