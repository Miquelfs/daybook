"""
Thin wrapper around garminconnect that handles login and session caching.
Tokens are stored at data/raw/garmin_session/ (a directory).
The garminconnect library's tokenstore mechanism handles the token format;
credentials in .env are only needed if the tokenstore is absent or expired.
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from garminconnect import Garmin

load_dotenv()

_ROOT = Path(__file__).parents[3]            # daybook/
_SESSION_DIR = _ROOT / "data" / "raw" / "garmin_session"


def _load_credentials() -> tuple[str, str]:
    email = os.getenv("GARMIN_EMAIL", "")
    password = os.getenv("GARMIN_PASSWORD", "")
    return email, password


def _fresh_login(email: str, password: str) -> Garmin:
    if not email or not password:
        sys.exit(
            "ERROR: No valid session found and GARMIN_EMAIL / GARMIN_PASSWORD "
            "are not set in .env. Set credentials or copy a valid tokenstore to "
            f"{_SESSION_DIR}"
        )
    print(f"Authenticating with Garmin Connect as {email}...", file=sys.stderr)
    client = Garmin(email, password)
    _SESSION_DIR.mkdir(parents=True, exist_ok=True)
    client.login(tokenstore=str(_SESSION_DIR))
    return client


def get_client() -> Garmin:
    """
    Return an authenticated Garmin client.

    Order of preference:
    1. Load from tokenstore directory (data/raw/garmin_session/) — handles
       token refresh automatically via garminconnect's DI OAuth flow.
    2. Full credential login if no tokenstore exists or if it's expired.
    """
    email, password = _load_credentials()
    _SESSION_DIR.mkdir(parents=True, exist_ok=True)

    token_files = list(_SESSION_DIR.glob("*.json"))
    if token_files:
        try:
            client = Garmin(email, password)
            client.login(tokenstore=str(_SESSION_DIR))
            _ = client.display_name   # probe
            return client
        except Exception as e:
            print(f"Tokenstore load failed ({e}), re-authenticating...", file=sys.stderr)

    return _fresh_login(email, password)
