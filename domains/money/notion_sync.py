#!/usr/bin/env python3
"""
Sync Notion finance database into money.db.

Usage:
  python -m domains.money.notion_sync                  # incremental (last 90 days)
  python -m domains.money.notion_sync --full-history   # import everything
  python -m domains.money.notion_sync --since 2025-01-01
  python -m domains.money.notion_sync --dry-run --full-history
  python -m domains.money.notion_sync --force          # re-upsert even existing rows

Requires .env or environment variables:
  NOTION_TOKEN        — Notion integration token (secret_xxx...)
  NOTION_DATABASE_ID  — 32-char Notion database ID
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parents[2]

# ── Env / credentials ─────────────────────────────────────────────────────────

def _load_env() -> None:
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def _notion_token() -> str:
    t = os.environ.get("NOTION_TOKEN", "")
    if not t:
        print("ERROR: NOTION_TOKEN not set. Add it to .env or environment.", file=sys.stderr)
        sys.exit(1)
    return t


def _notion_db_id() -> str:
    d = os.environ.get("NOTION_DATABASE_ID", "")
    if not d:
        print("ERROR: NOTION_DATABASE_ID not set. Add it to .env or environment.", file=sys.stderr)
        sys.exit(1)
    return d


# ── Notion API ────────────────────────────────────────────────────────────────

NOTION_API_VERSION = "2022-06-28"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_notion_token()}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
    }


def _fetch_page_batch(url: str, payload: dict, retries: int = 3) -> dict:
    """POST one paginated batch to Notion with retry on timeout."""
    data = json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers=_headers(), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read())
        except (TimeoutError, urllib.error.URLError) as e:
            if attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  Timeout/network error (attempt {attempt+1}/{retries}), retrying in {wait}s: {e}", file=sys.stderr)
                time.sleep(wait)
            else:
                raise
        except urllib.error.HTTPError as e:
            print(f"Notion API error {e.code}: {e.read().decode()}", file=sys.stderr)
            raise


def fetch_pages(database_id: str, since: str | None = None) -> list[dict]:
    """Fetch all pages from a Notion database. Optionally filter by date >= since."""
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    all_pages: list[dict] = []
    start_cursor: str | None = None
    page_num = 0

    filter_body: dict = {}
    if since:
        filter_body = {
            "filter": {
                "property": "Date",
                "date": {"on_or_after": since},
            }
        }

    while True:
        payload: dict = {**filter_body}
        if start_cursor:
            payload["start_cursor"] = start_cursor

        body = _fetch_page_batch(url, payload)
        batch = body.get("results", [])
        all_pages.extend(batch)
        page_num += 1

        if page_num % 5 == 0:
            print(f"  Fetched {len(all_pages)} pages so far…", file=sys.stderr)

        if not body.get("has_more"):
            break
        start_cursor = body.get("next_cursor")
        time.sleep(0.4)  # Notion rate limit: 3 req/sec

    return all_pages


# ── Property parsers ──────────────────────────────────────────────────────────

def _title(prop: dict | None) -> str | None:
    if not prop:
        return None
    parts = prop.get("title", [])
    return "".join(t.get("plain_text", "") for t in parts) or None


def _rich_text(prop: dict | None) -> str | None:
    if not prop:
        return None
    parts = prop.get("rich_text", [])
    return "".join(t.get("plain_text", "") for t in parts) or None


def _number(prop: dict | None) -> float | None:
    if not prop:
        return None
    return prop.get("number")


def _select(prop: dict | None) -> str | None:
    if not prop:
        return None
    sel = prop.get("select")
    return sel.get("name") if sel else None


def _date(prop: dict | None) -> str | None:
    if not prop:
        return None
    d = prop.get("date")
    return d.get("start") if d else None


# ── Page → row mapping ────────────────────────────────────────────────────────

from domains.money.money_config import CATEGORY_MAPPING, classify


def _parse_page(page: dict) -> dict | None:
    props = page.get("properties", {})

    raw_date = _date(props.get("Date"))
    if not raw_date:
        return None

    raw_name = _title(props.get("Name"))
    if not raw_name:
        return None

    raw_amount = _number(props.get("Amount"))
    if raw_amount is None:
        raw_amount = 0.0

    raw_category = _select(props.get("Category"))
    category = CATEGORY_MAPPING.get(raw_category or "", raw_category)

    return {
        "id":               page["id"],
        "source":           "notion",
        "notion_id":        page["id"],
        "date":             raw_date[:10],   # YYYY-MM-DD
        "name":             raw_name.strip(),
        "amount":           raw_amount,
        "account":          _select(props.get("Account")),
        "category":         category,
        "subcategory":      _select(props.get("Subcategory")),
        "transaction_type": classify(category),
        "notes":            _rich_text(props.get("Notes")),
    }


# ── DB helpers ────────────────────────────────────────────────────────────────

from infrastructure.db.money_connection import get_money_connection
from domains.money.money_db import init_money_db


def _upsert(conn, row: dict, force: bool, dry_run: bool) -> str:
    """
    Insert or update a row. Skips if source='local' (locally-edited row).
    Returns 'inserted', 'updated', or 'skipped'.
    """
    existing = conn.execute(
        "SELECT id, source FROM transactions WHERE notion_id = ?", (row["notion_id"],)
    ).fetchone()

    if existing:
        if existing["source"] == "local" and not force:
            return "skipped"
        if dry_run:
            return "updated"
        conn.execute(
            """UPDATE transactions
               SET date=?, name=?, amount=?, account=?, category=?, subcategory=?,
                   transaction_type=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE notion_id=? AND source != 'local'""",
            (row["date"], row["name"], row["amount"], row["account"],
             row["category"], row["subcategory"], row["transaction_type"],
             row["notes"], row["notion_id"]),
        )
        return "updated"
    else:
        if dry_run:
            return "inserted"
        conn.execute(
            """INSERT INTO transactions
                 (id, source, notion_id, date, name, amount, account, category,
                  subcategory, transaction_type, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (row["id"], row["source"], row["notion_id"], row["date"], row["name"],
             row["amount"], row["account"], row["category"], row["subcategory"],
             row["transaction_type"], row["notes"]),
        )
        return "inserted"


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    _load_env()

    parser = argparse.ArgumentParser(description="Sync Notion finance data into money.db")
    parser.add_argument("--full-history", action="store_true", help="Import all Notion records")
    parser.add_argument("--since", metavar="YYYY-MM-DD", help="Import records on/after this date")
    parser.add_argument("--force", action="store_true", help="Re-upsert even locally-edited rows")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    args = parser.parse_args()

    # Ensure DB exists
    if not args.dry_run:
        init_money_db()

    # Determine date filter
    since: str | None = None
    if args.full_history:
        since = None
        print("Fetching full Notion history…", file=sys.stderr)
    elif args.since:
        since = args.since
        print(f"Fetching records since {since}…", file=sys.stderr)
    else:
        # Default: last 90 days
        since = (date.today() - timedelta(days=90)).isoformat()
        print(f"Fetching records since {since} (default 90 days)…", file=sys.stderr)

    database_id = _notion_db_id()
    pages = fetch_pages(database_id, since=since)
    print(f"Fetched {len(pages)} pages from Notion.", file=sys.stderr)

    if args.dry_run:
        parsed = [_parse_page(p) for p in pages]
        valid = [r for r in parsed if r]
        print(f"Dry run: {len(valid)} parseable rows ({len(pages)-len(valid)} skipped).")
        if valid:
            for r in valid[:5]:
                print(f"  {r['date']}  {r['name'][:40]:<40}  {r['amount']:>10.2f}  {r['category']}")
            if len(valid) > 5:
                print(f"  … {len(valid)-5} more rows")
        return

    conn = get_money_connection()
    inserted = updated = skipped = errors = 0

    for i, page in enumerate(pages):
        row = _parse_page(page)
        if row is None:
            skipped += 1
            continue
        try:
            result = _upsert(conn, row, force=args.force, dry_run=False)
            if result == "inserted":
                inserted += 1
            elif result == "updated":
                updated += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  Error page {page['id']}: {e}", file=sys.stderr)
            errors += 1

        if (i + 1) % 100 == 0:
            conn.commit()
            pct = round((i + 1) / len(pages) * 100)
            print(f"  {i+1}/{len(pages)} ({pct}%) — inserted={inserted} updated={updated}", file=sys.stderr)

    conn.commit()

    # Log sync result
    conn.execute(
        """INSERT INTO money_sync_log (source, status, records_upserted, records_skipped, error)
           VALUES ('notion', ?, ?, ?, ?)""",
        ("ok" if not errors else "error", inserted + updated, skipped,
         f"{errors} errors" if errors else None),
    )
    conn.commit()
    conn.close()

    print(f"Done: {inserted} inserted, {updated} updated, {skipped} skipped, {errors} errors.")


if __name__ == "__main__":
    main()
