"""
Thin subprocess wrapper around the `mercadona-cli` Go binary.
Returns parsed JSON dicts; returns None gracefully if the CLI is missing.

Install: npm install -g mercadona-cli
"""

import json
import logging
import shutil
import subprocess
from typing import Optional

log = logging.getLogger(__name__)

CLI = shutil.which("mercadona-cli") or shutil.which("mercadona")


def _run(*args: str) -> Optional[dict | list]:
    if CLI is None:
        log.warning("mercadona-cli not found in PATH")
        return None
    try:
        result = subprocess.run(
            [CLI, *args],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            log.warning("mercadona-cli error: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError) as e:
        log.warning("mercadona-cli call failed: %s", e)
        return None


def search(query: str, limit: int = 10) -> Optional[list]:
    """Search Mercadona product catalog. Returns list of product dicts."""
    return _run("search", query, "--limit", str(limit), "--json")


def get_product(product_id: str) -> Optional[dict]:
    """Fetch a single product by its Mercadona ID."""
    return _run("product", product_id, "--json")


def get_prices(product_ids: list[str]) -> Optional[list]:
    """Batch-fetch current prices for a list of Mercadona product IDs."""
    return _run("prices", *product_ids, "--json")
