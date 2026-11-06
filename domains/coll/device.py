"""
Pretend to be Coll: run the device's sync against Daybook, from the Mac, before the hardware exists
(and to check the Pi when Coll misbehaves). Standard library only.

  1. GET  /coll/sync                 settings digest + the courses Coll should hold
  2. GET  /coll/courses/{id}/pack    each pack it doesn't have yet (If-None-Match), checked:
                                     sha1 = pack_sha1, it parses as COL1 (packread = the firmware's reader)
     packs no longer listed are deleted, like the device does
  3. GET  /coll/settings             when settings_sha1 changed
  4. POST /coll/rides                each ride file given (.gpx from Coll / the simulator, or a .clg
                                     log) not sent before, with X-Coll-Ride-Id = its start time

  5. POST /coll/device               what it now holds (pack ids + sha1), firmware, free space,
                                     rides still waiting — so Daybook shows a route as really on Coll

Its "flash" is data/coll-device/ (packs, settings.json, sent.json), so a second run downloads
nothing and uploads nothing, as on the device.

  python3 -m domains.coll.device --url http://daybook-pi:8000 --token … [ride.gpx | dir …]
  make coll-device RIDES=~/Desktop/ciclocomputer/sim/out    (fetches the token from the Pi)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from domains.coll import packread

ROOT = Path(__file__).resolve().parents[2]
FLASH = ROOT / "data" / "coll-device"


class Daybook:
    def __init__(self, url: str, token: str | None):
        self.url, self.token = url.rstrip("/"), token

    def call(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None,
             token: bool = True) -> tuple[int, dict, bytes]:
        h = dict(headers or {})
        if token and self.token:
            h["X-Coll-Token"] = self.token
        req = urllib.request.Request(self.url + path, data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def json(self, method: str, path: str, **kw) -> tuple[int, dict | list | None]:
        code, _, data = self.call(method, path, **kw)
        try:
            return code, json.loads(data) if data else None
        except ValueError:
            return code, {"detail": data[:200].decode(errors="replace")}


def ride_id(path: Path, data: bytes) -> str:
    """What Coll sends as X-Coll-Ride-Id: the ride's start time, UTC ISO."""
    if data[:4] == b"CLG1":
        from datetime import datetime, timezone
        from domains.coll import collog
        start, _, _ = collog.read(data)
        return datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    m = re.search(rb"<metadata>\s*<time>([^<]+)</time>", data) or re.search(rb"<time>([^<]+)</time>", data)
    return m.group(1).decode().strip() if m else path.stem


def ride_files(args: list[str]) -> list[Path]:
    out = []
    for a in args:
        p = Path(os.path.expanduser(a))
        if p.is_dir():
            out += sorted(q for q in p.iterdir() if q.suffix.lower() in (".gpx", ".clg"))
        elif p.exists():
            out.append(p)
        else:
            print(f"  ! {a}: no such file")
    return out


def fmt_km(c: dict) -> str:
    return f"{c.get('km') or 0:.1f} km"


def run(db: Daybook, rides: list[str], flash: Path) -> int:
    problems = 0
    packs = flash / "packs"
    packs.mkdir(parents=True, exist_ok=True)

    code, _ = db.json("GET", "/coll/sync", token=False)
    print(f"token check   without a token → {code} {'ok' if code == 401 else '!! expected 401'}")
    problems += code != 401

    code, sync = db.json("GET", "/coll/sync")
    if code != 200:
        print(f"sync          !! {code} {sync}")
        return problems + 1
    print(f"sync          server {sync['server_time']} · {len(sync['courses'])} courses listed")

    listed = set()
    for c in sync["courses"]:
        listed.add(c["id"])
        f = packs / f"{c['id']}.coll"
        have = hashlib.sha1(f.read_bytes()).hexdigest() if f.exists() else None
        when = c.get("date") or (f"race {c['race_date']}" if c.get("race_date") else "upload")
        line = f"  course {c['id']:>4}  {c['name'][:38]:<38} {fmt_km(c):>9}  {when}"
        if have == c["pack_sha1"]:
            print(f"{line}  · have it")
        else:
            st, hdr, data = db.call("GET", f"/coll/courses/{c['id']}/pack",
                                    headers={"If-None-Match": f'"{have}"'} if have else None)
            if st != 200:
                print(f"{line}  !! pack {st}")
                problems += 1
                continue
            sha = hashlib.sha1(data).hexdigest()
            try:
                p = packread.read(data)
            except Exception as e:                                # noqa: BLE001
                print(f"{line}  !! unreadable pack: {e}")
                problems += 1
                continue
            ok = sha == c["pack_sha1"] == hdr.get("ETag", hdr.get("etag", "")).strip('"')
            f.write_bytes(data)
            keeps = sum(1 for t in p["turns"] if t[2] == 1)
            print(f"{line}  ↓ {len(data) // 1024} KB · {len(p['points'])} pts · {len(p['turns'])} turns "
                  f"({keeps} keep) · {len(p['waypoints'])} waypoints · {len(p['roads'])} roads"
                  f"{'' if ok else '  !! sha1/ETag mismatch'}")
            problems += not ok
            st2, _, _ = db.call("GET", f"/coll/courses/{c['id']}/pack", headers={"If-None-Match": f'"{sha}"'})
            if st2 != 304:
                print(f"                 !! asking again with its ETag gave {st2}, expected 304")
                problems += 1
        fuel, src, cut = c.get("fuel_plan"), c.get("fuel_source"), c.get("cutoffs")
        extra = (f" ({src})" if fuel and src else "") + (f" · cut-offs {cut}" if cut else "")
        print(f"                 fuel {fuel or '—'}{extra}")
    for f in packs.glob("*.coll"):
        if int(f.stem) not in listed:
            f.unlink()
            print(f"  course {f.stem:>4}  deleted (no longer listed)")

    sfile = flash / "settings.json"
    old = json.loads(sfile.read_text()) if sfile.exists() else {}
    if old.get("_sha1") == sync["settings_sha1"]:
        print("settings      unchanged")
    else:
        code, s = db.json("GET", "/coll/settings")
        if code != 200:
            print(f"settings      !! {code} {s}")
            problems += 1
        else:
            sfile.write_text(json.dumps({**s, "_sha1": sync["settings_sha1"]}, indent=1))
            pr = s.get("profile") or {}
            print(f"settings      ↓ {pr.get('weight_kg')} kg · {pr.get('age')} y · {pr.get('sex')} · "
                  f"zones {s.get('hr_zones')} · max {s.get('max_hr')} · {s.get('timezone')} · "
                  f"default fuel {s.get('fuel_plan') or '—'}")

    sent_file = flash / "sent.json"
    sent = json.loads(sent_file.read_text()) if sent_file.exists() else {}
    files = ride_files(rides)
    if not files:
        print("rides         none given (pass .gpx/.clg files or a folder)")
    for path in files:
        data = path.read_bytes()
        rid = ride_id(path, data)
        if rid in sent:
            print(f"  ride {rid}  · sent before → {sent[rid]}")
            continue
        ctype = "application/x-coll-log" if data[:4] == b"CLG1" else "application/gpx+xml"
        code, r = db.json("POST", "/coll/rides", body=data, headers={"Content-Type": ctype, "X-Coll-Ride-Id": rid})
        if code in (200, 201):
            s = r.get("summary") or {}
            where = r["activity_id"] + (" (the watch's copy)" if r.get("status") == "merged" else "")
            print(f"  ride {rid}  {'↑' if code == 201 else '= duplicate'} {r.get('name')} · "
                  f"{(s.get('distance_m') or 0) / 1000:.1f} km · {round((s.get('moving_s') or 0) / 60)} min moving · "
                  f"HR {s.get('avg_hr')} → {where}")
            sent[rid] = r["activity_id"]
            sent_file.write_text(json.dumps(sent, indent=1))
            if code == 201:      # Coll retries after a dropped Wi-Fi: the same id must not make a second one
                c2, r2 = db.json("POST", "/coll/rides", body=data,
                                 headers={"Content-Type": ctype, "X-Coll-Ride-Id": rid})
                if c2 != 200 or r2.get("activity_id") != r["activity_id"]:
                    print(f"                 !! re-sending gave {c2}, expected 200 with the same activity")
                    problems += 1
        else:
            print(f"  ride {rid}  !! {code} {r}")
            problems += 1

    have = [{"id": int(f.stem), "pack_sha1": hashlib.sha1(f.read_bytes()).hexdigest()} for f in packs.glob("*.coll")]
    used = sum(f.stat().st_size for f in flash.rglob("*") if f.is_file())
    code, rep = db.json("POST", "/coll/device", body=json.dumps({
        "have": have, "firmware": "emulator (domains/coll/device.py)",
        "free_kb": max(0, (12 * 1024 * 1024 - used) // 1024),            # ~12 MB files area on the XIAO
        "rides_waiting": sum(1 for p in files if ride_id(p, p.read_bytes()) not in sent),
    }).encode(), headers={"Content-Type": "application/json"})
    if code == 200:
        print(f"report        ↑ holds {len(have)} pack(s) · Daybook marks them as on Coll")
    else:
        print(f"report        !! {code} {rep}")
        problems += 1

    print("OK — everything Coll needs works" if not problems else f"{problems} problem(s)")
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description="Run Coll's sync against Daybook")
    ap.add_argument("rides", nargs="*", help=".gpx / .clg ride files or folders to upload")
    ap.add_argument("--url", default=os.environ.get("COLL_URL", "http://daybook-pi:8000"))
    ap.add_argument("--token", default=os.environ.get("COLL_TOKEN"))
    ap.add_argument("--flash", default=str(FLASH), help="where the pretend device keeps its files")
    ap.add_argument("--forget", action="store_true", help="wipe the pretend device first (download/upload again)")
    a = ap.parse_args()
    if not a.token:
        sys.exit("no token: --token or COLL_TOKEN (make coll-device fetches it from the Pi)")
    flash = Path(a.flash)
    if a.forget and flash.exists():
        for f in sorted(flash.rglob("*"), reverse=True):
            f.unlink() if f.is_file() else f.rmdir()
    sys.exit(1 if run(Daybook(a.url, a.token), a.rides, flash) else 0)


if __name__ == "__main__":
    main()
