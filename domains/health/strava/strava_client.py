"""
Strava API client wrapper.

Token lifecycle:
  - Tokens are stored in data/raw/strava_tokens/tokens.json
  - On each call, the access token is refreshed if it expires within 5 minutes
  - First-time setup requires running `make strava-auth` which exchanges the
    one-time authorization code for refresh + access tokens

Environment variables (in .env):
    STRAVA_CLIENT_ID      — from Strava API application settings
    STRAVA_CLIENT_SECRET  — from Strava API application settings
    STRAVA_REFRESH_TOKEN  — populated after first OAuth exchange; or set manually

The module never writes to Strava. Read-only access only.
"""

import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

_ROOT = Path(__file__).parents[3]
_TOKEN_PATH = _ROOT / "data" / "raw" / "strava_tokens" / "tokens.json"
_TOKEN_URL = "https://www.strava.com/oauth/token"


def _load_env() -> tuple[str, str]:
    client_id = os.getenv("STRAVA_CLIENT_ID", "")
    client_secret = os.getenv("STRAVA_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        sys.exit(
            "ERROR: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in .env\n"
            "Create a Strava API application at https://www.strava.com/settings/api"
        )
    return client_id, client_secret


def _load_tokens() -> dict:
    if _TOKEN_PATH.exists():
        try:
            return json.loads(_TOKEN_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_tokens(tokens: dict) -> None:
    _TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    _TOKEN_PATH.write_text(json.dumps(tokens, indent=2))


def _refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    resp = requests.post(_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


def exchange_code(code: str) -> dict:
    """Exchange a one-time authorization code for access + refresh tokens.
    Called once during initial OAuth setup."""
    client_id, client_secret = _load_env()
    resp = requests.post(_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
    }, timeout=30)
    resp.raise_for_status()
    tokens = resp.json()
    _save_tokens(tokens)
    print(f"Tokens saved to {_TOKEN_PATH}")
    return tokens


def get_access_token() -> str:
    """Return a valid access token, refreshing if necessary."""
    client_id, client_secret = _load_env()
    tokens = _load_tokens()

    # Fall back to STRAVA_REFRESH_TOKEN from .env if no token file exists yet
    if not tokens:
        refresh_token = os.getenv("STRAVA_REFRESH_TOKEN", "")
        if not refresh_token:
            sys.exit(
                "ERROR: No Strava tokens found. Run `make strava-auth` to complete OAuth.\n"
                f"Token file expected at: {_TOKEN_PATH}"
            )
        tokens = {"refresh_token": refresh_token, "expires_at": 0}

    # Refresh if token expires within 5 minutes
    if tokens.get("expires_at", 0) < time.time() + 300:
        print("Refreshing Strava access token...", file=sys.stderr)
        new_tokens = _refresh_access_token(
            client_id, client_secret, tokens["refresh_token"]
        )
        tokens.update(new_tokens)
        _save_tokens(tokens)

    return tokens["access_token"]


class StravaClient:
    """Thin authenticated wrapper around the Strava v3 API."""

    BASE = "https://www.strava.com/api/v3"

    def __init__(self) -> None:
        self._token = get_access_token()

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        resp = requests.get(
            f"{self.BASE}{path}",
            headers={"Authorization": f"Bearer {self._token}"},
            params=params or {},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def get_activities(self, after: int | None = None, before: int | None = None,
                       page: int = 1, per_page: int = 100) -> list[dict]:
        """List activities. after/before are Unix timestamps."""
        params: dict = {"page": page, "per_page": per_page}
        if after:
            params["after"] = after
        if before:
            params["before"] = before
        result = self._get("/athlete/activities", params)
        return result if isinstance(result, list) else []

    def get_activity(self, activity_id: int | str) -> dict:
        result = self._get(f"/activities/{activity_id}", {"include_all_efforts": True})
        return result if isinstance(result, dict) else {}

    def get_activity_streams(self, activity_id: int | str,
                              stream_types: list[str] | None = None) -> dict:
        types = ",".join(stream_types or ["time", "heartrate", "altitude", "velocity_smooth", "cadence"])
        result = self._get(f"/activities/{activity_id}/streams", {
            "keys": types,
            "key_by_type": True,
        })
        return result if isinstance(result, dict) else {}

    def get_segment(self, segment_id: int | str) -> dict:
        result = self._get(f"/segments/{segment_id}")
        return result if isinstance(result, dict) else {}

    def get_athlete(self) -> dict:
        result = self._get("/athlete")
        return result if isinstance(result, dict) else {}
