"""
Morning push: today's tasks, overdue ones, cutoffs coming up, notes resurfacing
and birthdays — one ntfy notification, at most once a day.

Opt-in: set NTFY_TOPIC in .env (install the ntfy iOS app and subscribe to the
same topic). NTFY_SERVER defaults to https://ntfy.sh — the topic name is the
only secret there, so make it long and random, or self-host. NTFY_TOKEN is sent
as a bearer token when set; DAYBOOK_WEB_URL makes the notification tap-to-open.

Run by daily_sync.sh in the morning window; manual:
  python -m domains.plans.notify [--force] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import date

from domains.plans.agenda import agenda
from infrastructure.db.connection import get_connection

_SENT_KEY = "agenda_notified_on"


def compose(a: dict) -> tuple[str, str] | None:
    """(title, body) for the agenda, or None when there's nothing worth a ping."""
    lines: list[str] = []
    for b in a["birthdays"]:
        if b["days_until"] == 0:
            turning = f" turns {b['turning']}" if b["turning"] else "'s birthday"
            lines.append(f"🎂 {b['name']}{turning} today")
        elif b["days_until"] <= 3:
            lines.append(f"🎂 {b['name']} in {b['days_until']}d")
    for t in a["today"]:
        lines.append(f"☐ {t['title']}")
    for t in a["overdue"]:
        lines.append(f"⚠️ {t['title']} (was {t['due_date'][5:]})")
    for t in a["upcoming"]:
        if t.get("remind_days") and t["days_until"] <= t["remind_days"]:
            lines.append(f"⏳ {t['title']} in {t['days_until']}d")
    for n in a["notes"]:
        lines.append(f"📝 {n['title']}")
    if not lines:
        return None
    n_today = len(a["today"])
    title = f"Today · {n_today} to do" if n_today else "Daybook · heads-up"
    return title, "\n".join(lines[:12]) + (f"\n+{len(lines) - 12} more" if len(lines) > 12 else "")


def send(title: str, body: str) -> None:
    # JSON publishing (POST to the server root) keeps the title UTF-8 safe —
    # HTTP headers would mangle the emoji.
    server = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    payload = {"topic": os.environ["NTFY_TOPIC"], "title": title, "message": body, "tags": ["calendar"]}
    if os.getenv("DAYBOOK_WEB_URL"):
        payload["click"] = os.environ["DAYBOOK_WEB_URL"]
    headers = {"Content-Type": "application/json"}
    if os.getenv("NTFY_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['NTFY_TOKEN']}"
    req = urllib.request.Request(server, data=json.dumps(payload).encode("utf-8"),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        r.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="send even if already sent today")
    ap.add_argument("--dry-run", action="store_true", help="print, don't send")
    args = ap.parse_args()

    if not os.getenv("NTFY_TOPIC") and not args.dry_run:
        print("NTFY_TOPIC not set — morning push disabled, skipping")
        return 0

    today = date.today()
    conn = get_connection()
    try:
        sent = conn.execute("SELECT value FROM app_settings WHERE key=?", (_SENT_KEY,)).fetchone()
        if sent and sent["value"] == today.isoformat() and not args.force:
            print("already sent today")
            return 0
        msg = compose(agenda(conn, today))
        if msg is None:
            print("nothing ahead today — no push")
        elif args.dry_run:
            print(msg[0]); print(msg[1])
            return 0
        else:
            send(*msg)
            print(f"sent: {msg[0]}")
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_SENT_KEY, today.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
