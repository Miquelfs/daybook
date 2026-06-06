"""
Fetch book cover URLs from Open Library.
Used by the import script and the API router (auto-fetch on new book creation).
"""

import json
import time
import unicodedata
import urllib.parse
import urllib.request


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def _query_open_library(title: str, author: str, timeout: int = 5) -> str | None:
    params = urllib.parse.urlencode({
        "title": title, "author": author, "limit": 1, "fields": "cover_i",
    })
    req = urllib.request.Request(
        f"https://openlibrary.org/search.json?{params}",
        headers={"User-Agent": "Daybook/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    docs = data.get("docs", [])
    if docs and docs[0].get("cover_i"):
        return f"https://covers.openlibrary.org/b/id/{docs[0]['cover_i']}-M.jpg"
    return None


def fetch_cover_url(title: str, author: str) -> str | None:
    """
    Try Open Library with the original title+author, then with accent-stripped
    versions. Returns a cover URL string or None if nothing found.
    """
    candidates = [
        (title, author),
        (_strip_accents(title), _strip_accents(author)),
    ]
    for t, a in candidates:
        try:
            url = _query_open_library(t, a)
            if url:
                return url
        except Exception:
            pass
        time.sleep(0.2)
    return None
