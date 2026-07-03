"""
Thin wrapper around the Ollama HTTP API running on the HP.
Falls back gracefully if the HP is unreachable — callers receive None and skip the feature.

Config (from .env):
  OLLAMA_HOST           — e.g. http://192.168.1.17:11434  (default: http://localhost:11434)
  OLLAMA_MODEL_DEFAULT  — for structured tasks: receipt parsing, meal planning (default: mistral)
  OLLAMA_MODEL_FAST     — for short narration: morning brief, health narrative (default: phi3:mini)
"""

import json
import logging
import os
from typing import Optional

import urllib.request
import urllib.error

log = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
MODEL_DEFAULT = os.getenv("OLLAMA_MODEL_DEFAULT", "mistral")
MODEL_FAST = os.getenv("OLLAMA_MODEL_FAST", "phi3:mini")

# Seconds to wait for a response — 10 min for cold model load on 2016 i5
TIMEOUT = 600


def _post(path: str, payload: dict) -> Optional[dict]:
    url = f"{OLLAMA_HOST}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        log.warning("Ollama unreachable at %s: %s", OLLAMA_HOST, e)
        return None
    except Exception as e:
        log.warning("Ollama call failed: %s", e)
        return None


def is_available() -> bool:
    """Quick health check — returns True if Ollama is reachable."""
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags")
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def generate(prompt: str, model: Optional[str] = None, as_json: bool = False) -> Optional[str]:
    """
    Send a prompt to Ollama, return the response text.
    Returns None if Ollama is unreachable or the call fails.
    """
    m = model or MODEL_FAST
    payload: dict = {"model": m, "prompt": prompt, "stream": False}
    if as_json:
        payload["format"] = "json"

    result = _post("/api/generate", payload)
    if result is None:
        return None

    return result.get("response")


def generate_json(prompt: str, model: Optional[str] = None) -> Optional[dict]:
    """
    Like generate() but parses the response as JSON.
    Returns None if Ollama is unreachable or the response is not valid JSON.
    """
    m = model or MODEL_DEFAULT
    text = generate(prompt, model=m, as_json=True)
    if text is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.warning("Ollama returned invalid JSON: %s — raw: %s", e, text[:200])
        return None
