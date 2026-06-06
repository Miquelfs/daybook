"""
Mac-side Screen Time collector.
Reads ~/Library/Application Support/Knowledge/knowledgeC.db and pushes
daily summaries to the Pi via SCP + SSH.

Usage:
    python -m domains.screen_time.screentime_collect              # yesterday
    python -m domains.screen_time.screentime_collect 2026-05-01   # single date
    python -m domains.screen_time.screentime_collect 2026-05-01 2026-05-23  # range
    python -m domains.screen_time.screentime_collect --dry-run    # print JSON, don't push
"""

import json
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

KNOWLEDGE_DB = Path.home() / "Library/Application Support/Knowledge/knowledgeC.db"
APPLE_EPOCH = 978307200  # CoreData epoch offset (seconds from 1970 to 2001-01-01)

PI_HOST = "pi@daybook-pi"
PI_INGEST = "python3 -m domains.screen_time.screentime_ingest"
PI_DAYBOOK = "/home/pi/daybook"

# Bundle ID → human-readable name. Extend as needed.
APP_NAMES: dict[str, str] = {
    "com.apple.mobilephone": "Phone",
    "com.apple.mobilesms": "Messages",
    "com.apple.MobileSMS": "Messages",
    "com.apple.mobilesafari": "Safari",
    "com.apple.AppStore": "App Store",
    "com.apple.mobilemail": "Mail",
    "com.apple.maps": "Maps",
    "com.apple.camera": "Camera",
    "com.apple.photos": "Photos",
    "com.apple.Music": "Music",
    "com.apple.Podcasts": "Podcasts",
    "com.apple.news": "News",
    "com.apple.Health": "Health",
    "com.apple.reminders": "Reminders",
    "com.apple.mobilecal": "Calendar",
    "com.apple.facetime": "FaceTime",
    "com.google.chrome.ios": "Chrome",
    "com.google.Gmail": "Gmail",
    "com.google.Maps": "Google Maps",
    "com.instagram.instagram": "Instagram",
    "com.facebook.Facebook": "Facebook",
    "com.atebits.Tweetie2": "Twitter/X",
    "com.burbn.instagram": "Instagram",
    "com.spotify.client": "Spotify",
    "com.netflix.Netflix": "Netflix",
    "com.whatsapp.WhatsApp": "WhatsApp",
    "net.whatsapp.WhatsApp": "WhatsApp",
    "com.telegram.TelegramEnterprise": "Telegram",
    "ph.telegra.Telegraph": "Telegram",
    "com.tinyspeck.chatlyio": "Slack",
    "com.microsoft.teams": "Teams",
    "com.microsoft.Office.Outlook": "Outlook",
    "com.readdle.CommonDocuments": "Documents",
    "com.apple.Notes": "Notes",
    "com.apple.shortcuts": "Shortcuts",
}


def _app_name(bundle_id: str) -> str:
    return APP_NAMES.get(bundle_id, bundle_id)


def _open_db() -> sqlite3.Connection:
    if not KNOWLEDGE_DB.exists():
        raise FileNotFoundError(
            f"knowledgeC.db not found at {KNOWLEDGE_DB}\n"
            "Make sure Screen Time 'Share Across Devices' is enabled on your iPhone and Mac."
        )
    conn = sqlite3.connect(f"file:{KNOWLEDGE_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def collect_day(conn: sqlite3.Connection, date_str: str) -> dict | None:
    """Collect Screen Time data for a single date. Returns None if no data."""

    # Total screen time from /app/usage
    row = conn.execute(
        """
        SELECT SUM(ZENDDATE - ZSTARTDATE) / 60.0 AS total_minutes
        FROM ZOBJECT
        WHERE ZSTREAMNAME = '/app/usage'
          AND DATE(DATETIME(ZSTARTDATE + ?, 'UNIXEPOCH'), 'localtime') = ?
        """,
        (APPLE_EPOCH, date_str),
    ).fetchone()

    total_minutes = row["total_minutes"] if row and row["total_minutes"] else None
    if total_minutes is None:
        return None

    # Per-app breakdown
    app_rows = conn.execute(
        """
        SELECT ZVALUESTRING AS bundle_id,
               SUM(ZENDDATE - ZSTARTDATE) / 60.0 AS minutes
        FROM ZOBJECT
        WHERE ZSTREAMNAME = '/app/usage'
          AND DATE(DATETIME(ZSTARTDATE + ?, 'UNIXEPOCH'), 'localtime') = ?
          AND ZVALUESTRING IS NOT NULL
        GROUP BY bundle_id
        ORDER BY minutes DESC
        """,
        (APPLE_EPOCH, date_str),
    ).fetchall()

    app_usage = [
        {
            "bundle_id": r["bundle_id"],
            "name": _app_name(r["bundle_id"]),
            "minutes": round(r["minutes"], 1),
        }
        for r in app_rows
        if r["bundle_id"] and r["minutes"] and r["minutes"] > 0.1
    ]

    # Device unlocks (isLocked transitions to 0 = unlocked)
    unlock_row = conn.execute(
        """
        SELECT COUNT(*) AS unlocks
        FROM ZOBJECT
        WHERE ZSTREAMNAME = '/device/isLocked'
          AND ZVALUEINTEGER = 0
          AND DATE(DATETIME(ZSTARTDATE + ?, 'UNIXEPOCH'), 'localtime') = ?
        """,
        (APPLE_EPOCH, date_str),
    ).fetchone()
    unlocks = unlock_row["unlocks"] if unlock_row else 0

    return {
        "date": date_str,
        "total_minutes": round(total_minutes, 1),
        "unlocks": unlocks,
        "app_usage": app_usage,
    }


def push_to_pi(records: list[dict]) -> None:
    """SCP payload to Pi, then run ingest script."""
    payload = json.dumps(records, indent=2)

    with tempfile.NamedTemporaryFile(
        suffix=".json", mode="w", delete=False, prefix="screentime_"
    ) as f:
        f.write(payload)
        tmp_path = f.name

    remote_tmp = "/tmp/screentime_payload.json"
    subprocess.run(
        ["scp", "-q", tmp_path, f"{PI_HOST}:{remote_tmp}"],
        check=True,
    )
    subprocess.run(
        ["ssh", PI_HOST, f"cd {PI_DAYBOOK} && {PI_INGEST} {remote_tmp}"],
        check=True,
    )
    Path(tmp_path).unlink(missing_ok=True)


def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]

    today = date.today()
    if len(args) == 0:
        dates = [(today - timedelta(days=1)).isoformat()]
    elif len(args) == 1:
        dates = [args[0]]
    else:
        start_d = date.fromisoformat(args[0])
        end_d = date.fromisoformat(args[1])
        dates = []
        d = start_d
        while d <= end_d:
            dates.append(d.isoformat())
            d += timedelta(days=1)

    conn = _open_db()
    records = []
    for date_str in dates:
        result = collect_day(conn, date_str)
        if result:
            records.append(result)
            print(f"  ✓ {date_str}: {result['total_minutes']:.0f} min, {result['unlocks']} unlocks, {len(result['app_usage'])} apps")
        else:
            print(f"  – {date_str}: no data")
    conn.close()

    if not records:
        print("No data collected.")
        return

    if dry_run:
        print("\n--- DRY RUN (not pushing to Pi) ---")
        print(json.dumps(records, indent=2))
        return

    print(f"\nPushing {len(records)} day(s) to Pi…")
    push_to_pi(records)
    print("Done.")


if __name__ == "__main__":
    main()
