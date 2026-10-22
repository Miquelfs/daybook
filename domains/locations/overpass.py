"""
OpenStreetMap Overpass queries, via curl (uses the system certificate store — python.org builds
on macOS ship without one) with retries across public mirrors, which are often busy.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time

UA = "daybook-personal/1.0 (personal data project)"
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def query(q: str, attempts: int = 6, timeout_s: int = 300, backoff_s: int = 10) -> dict:
    err = ""
    for attempt in range(attempts):
        url = MIRRORS[attempt % len(MIRRORS)]
        r = subprocess.run(["curl", "-sS", "--fail", "-m", str(timeout_s), "-A", UA, url,
                            "--data-urlencode", f"data={q}"], capture_output=True)
        if r.returncode == 0:
            return json.loads(r.stdout)
        err = r.stderr.decode(errors="replace").strip()[:200]
        print(f"  overpass {url}: {err[:120]} — retrying", file=sys.stderr)
        if attempt < attempts - 1:
            # 429 = "too many requests": that server wants us to slow down, not to hammer a mirror right away
            time.sleep(max(backoff_s * (attempt + 1), 60 if "429" in err else 0))
    raise RuntimeError(f"Overpass failed: {err}")
