"""
Thin wrapper around a chat LLM, with two interchangeable backends behind one API.
Falls back gracefully if the backend is unreachable — callers receive None and
skip the feature. Callers only ever use generate() / generate_json() /
is_available(); the provider switch is invisible to them.

Config (from .env):
  LLM_PROVIDER          — "claude" (cloud, default), "ollama" (local) or "groq"

  # Claude (Anthropic) backend — the default. Cost-tuned to Haiku:
  ANTHROPIC_API_KEY     — key from https://console.anthropic.com
  CLAUDE_MODEL          — structured/JSON tasks (default: claude-haiku-4-5)
  CLAUDE_MODEL_FAST     — short narration      (default: claude-haiku-4-5)
                          (both default to Haiku — cheapest tier; only bump a
                           specific task to claude-sonnet-5 if accuracy needs it)

  # Ollama (local) backend:
  OLLAMA_HOST           — e.g. http://192.168.1.17:11434  (default: http://localhost:11434)
  OLLAMA_MODEL_DEFAULT  — structured tasks: receipt parsing, meal planning (default: mistral)
  OLLAMA_MODEL_FAST     — short narration: morning brief, health narrative (default: phi3:mini)

  # Groq (free cloud, OpenAI-compatible) backend:
  GROQ_API_KEY          — free key from https://console.groq.com/keys
  GROQ_MODEL            — structured/JSON tasks (default: llama-3.3-70b-versatile)
  GROQ_MODEL_FAST       — short narration (default: llama-3.1-8b-instant)
"""

import json
import logging
import os
from typing import Optional

import urllib.request
import urllib.error

log = logging.getLogger(__name__)

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "claude").strip().lower()

# ─── Claude (Anthropic) config — the default backend ──────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
# Default everything to Haiku (cheapest capable tier). Override per-env only if a
# specific task needs more — do not bump the global default.
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5")
CLAUDE_MODEL_FAST = os.getenv("CLAUDE_MODEL_FAST", "claude-haiku-4-5")
# A smarter tier for tasks that reward better reasoning — nutrition analysis and
# coaching (heart-health judgement, foods-to-avoid). Costs more than Haiku but
# noticeably sharper. Falls back to Haiku for non-Claude providers.
CLAUDE_MODEL_SMART = os.getenv("CLAUDE_MODEL_SMART", "claude-sonnet-5")

# ─── Ollama (local) config ────────────────────────────────────────────────────
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
MODEL_DEFAULT = os.getenv("OLLAMA_MODEL_DEFAULT", "mistral")
MODEL_FAST = os.getenv("OLLAMA_MODEL_FAST", "phi3:mini")

# ─── Groq (free cloud) config ─────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_BASE = os.getenv("GROQ_HOST", "https://api.groq.com/openai/v1").rstrip("/")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MODEL_FAST = os.getenv("GROQ_MODEL_FAST", "llama-3.1-8b-instant")
# Groq's edge (Cloudflare) 403s the default Python-urllib User-Agent; a normal
# UA passes exactly like curl does.
GROQ_UA = os.getenv("GROQ_USER_AGENT", "Mozilla/5.0 (compatible; daybook/1.0)")

# Seconds to wait for a response — 10 min for cold model load on 2016 i5 (Ollama);
# Groq responds in seconds but the ceiling is harmless.
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


def _groq_chat(prompt: str, model: str, as_json: bool) -> Optional[str]:
    """Call Groq's OpenAI-compatible chat-completions API; return the text or None."""
    if not GROQ_API_KEY:
        log.warning("LLM_PROVIDER=groq but GROQ_API_KEY is not set")
        return None
    payload: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.4,
    }
    if as_json:
        payload["response_format"] = {"type": "json_object"}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{GROQ_BASE}/chat/completions",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "User-Agent": GROQ_UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            result = json.loads(resp.read())
        return result["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        body = e.read()[:300].decode(errors="replace")
        log.warning("Groq HTTP %s: %s", e.code, body)
        return None
    except Exception as e:
        log.warning("Groq call failed: %s", e)
        return None


def _groq_available() -> bool:
    if not GROQ_API_KEY:
        return False
    try:
        req = urllib.request.Request(
            f"{GROQ_BASE}/models",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "User-Agent": GROQ_UA},
        )
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def _claude_chat(prompt: str, model: Optional[str], as_json: bool) -> Optional[str]:
    """Call the Claude Messages API via the official SDK; return the text or None."""
    if not ANTHROPIC_API_KEY:
        log.warning("LLM_PROVIDER=claude but ANTHROPIC_API_KEY is not set")
        return None
    try:
        import anthropic
    except ImportError:
        log.warning("LLM_PROVIDER=claude but the `anthropic` SDK is not installed")
        return None

    m = model or (CLAUDE_MODEL if as_json else CLAUDE_MODEL_FAST)
    p = prompt
    if as_json:
        p = (
            prompt
            + "\n\nRespond with ONLY a single valid JSON object — no markdown, "
            "no code fences, no commentary before or after."
        )
    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=m,
            max_tokens=2048,
            messages=[{"role": "user", "content": p}],
        )
        parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
        return "".join(parts).strip() or None
    except Exception as e:  # anthropic errors, network, etc. — degrade gracefully
        log.warning("Claude call failed: %s", e)
        return None


def _claude_available() -> bool:
    if not ANTHROPIC_API_KEY:
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def is_available() -> bool:
    """Quick health check for the active provider — True if the backend is reachable."""
    if LLM_PROVIDER == "claude":
        return _claude_available()
    if LLM_PROVIDER == "groq":
        return _groq_available()
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags")
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False


def generate(prompt: str, model: Optional[str] = None, as_json: bool = False) -> Optional[str]:
    """
    Send a prompt to the active LLM backend, return the response text.
    Returns None if the backend is unreachable or the call fails.

    Model selection mirrors the Ollama fast/default split: short narration
    (as_json=False) uses the fast model, structured/JSON tasks use the default.
    """
    if LLM_PROVIDER == "claude":
        return _claude_chat(prompt, model, as_json)

    if LLM_PROVIDER == "groq":
        gmodel = GROQ_MODEL if as_json else GROQ_MODEL_FAST
        return _groq_chat(prompt, gmodel, as_json)

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
    Returns None if the backend is unreachable or the response is not valid JSON.
    """
    # Only Ollama needs an explicit default model; the cloud providers pick their
    # own JSON model inside generate() when model is None (passing the Ollama
    # default "mistral" to Claude/Groq would be an invalid model id).
    if LLM_PROVIDER in ("claude", "groq"):
        text = generate(prompt, model=model, as_json=True)
    else:
        text = generate(prompt, model=model or MODEL_DEFAULT, as_json=True)
    if text is None:
        return None
    text = _strip_json_fences(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.warning("LLM returned invalid JSON: %s — raw: %s", e, text[:200])
        return None


def _strip_json_fences(text: str) -> str:
    """Drop ```json ... ``` fences a model may wrap around JSON despite instructions."""
    t = text.strip()
    if t.startswith("```"):
        nl = t.find("\n")           # drop the opening fence line (``` or ```json)
        t = t[nl + 1:] if nl != -1 else t[3:]
        t = t.rstrip()
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()
