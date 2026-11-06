"""
python -m domains.coll.worker — builds pending Coll courses, one at a time.

Started by courses.kick() (API) in its own process: the build's ~150 MB peak is
released when it exits, and an hour of Overpass retries never blocks a request.
Holds an exclusive lock on data/coll/build.lock, so only one build runs at a time;
a second worker waits for the lock, then builds whatever is still pending.
"""

from __future__ import annotations

import fcntl
import os
import time

from domains.coll import courses
from infrastructure.db.connection import get_connection


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def main() -> None:
    courses.DATA.mkdir(parents=True, exist_ok=True)
    try:
        os.nice(10)                                  # the API and the nightly sync come first
    except OSError:
        pass
    with open(courses.DATA / "build.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        conn = get_connection()
        try:
            n = courses.recover(conn)
            if n:
                log(f"re-queued {n} course(s)")
            while True:
                cid = courses.build_next(conn, str(courses.CACHE), log=log)
                if cid is None:
                    break
                r = conn.execute("SELECT name, status, error FROM coll_courses WHERE id=?", (cid,)).fetchone()
                if r:
                    log(f"course {cid} {r['name']!r}: {r['status']}" + (f" — {r['error']}" if r["error"] else ""))
                if r and r["status"] == "ready":
                    try:                             # your earlier rides of it, against its plan
                        from domains.coll import review
                        n = review.scan_course(conn, cid, log=log)
                        if n:
                            log(f"course {cid}: {n} earlier ride(s) reviewed")
                    except Exception as e:           # noqa: BLE001
                        log(f"course {cid}: review scan failed: {e}")
        finally:
            conn.close()


if __name__ == "__main__":
    main()
