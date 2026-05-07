"""
Thin wrapper around garminconnect that handles login and session caching.
Session tokens are stored at data/raw/garmin_session/ to avoid re-authenticating
on every run. On expiry the client re-authenticates transparently.
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from garminconnect import Garmin, GarminConnectAuthenticationError

load_dotenv()

_ROOT = Path(__file__).parents[3]            # daybook/
_SESSION_DIR = _ROOT / "data" / "raw" / "garmin_session"
_SESSION_FILE = _SESSION_DIR / "session.json"


def _load_credentials() -> tuple[str, str]:
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        sys.exit("ERROR: GARMIN_EMAIL and GARMIN_PASSWORD must be set in .env")
    return email, password


def _save_session(client: Garmin) -> None:
    _SESSION_DIR.mkdir(parents=True, exist_ok=True)
    tokens = client.garth.dumps()
    _SESSION_FILE.write_text(tokens)


def _fresh_login() -> Garmin:
    email, password = _load_credentials()
    print(f"Authenticating with Garmin Connect as {email}...", file=sys.stderr)
    client = Garmin(email, password)
    client.login()
    _save_session(client)
    return client


def get_client() -> Garmin:
    """Return an authenticated Garmin client, reusing cached session if valid."""
    if _SESSION_FILE.exists():
        try:
            email, password = _load_credentials()
            client = Garmin(email, password)
            client.garth.loads(_SESSION_FILE.read_text())
            client.display_name  # probe to confirm session is still live
            return client
        except Exception:
            print("Cached session expired, re-authenticating...", file=sys.stderr)
            _SESSION_FILE.unlink(missing_ok=True)

    return _fresh_login()
