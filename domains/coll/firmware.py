"""
Firmware updates over Wi-Fi. You upload a build on the Coll tab; /coll/sync offers the newest
one (`firmware: {version, sha1, bytes, url}`); Coll compares it with its own version, downloads
GET /coll/firmware/<version> (token), checks the sha1, installs it (ESP32 OTA: the other app
slot, then reboots into it) and reports the new version in POST /coll/device.

Files live in data/coll-firmware/ (not in the DB), the newest 5 kept. An image must look like an
ESP32 app image (first byte 0xE9) so a wrong file can't be offered to the device.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / "data" / "coll-firmware"
KEEP = 5
MAX_BYTES = 8 * 1024 * 1024          # an app slot on the 16 MB flash
ESP_IMAGE_MAGIC = 0xE9
_VERSION = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}$")


def key(v: str | None) -> tuple:
    try:
        return tuple(int(x) for x in (v or "").split("."))
    except ValueError:
        return (-1,)


def valid_version(v: str) -> bool:
    return bool(_VERSION.match(v or ""))


def path(version: str, root: Path | None = None) -> Path:
    return (root or DIR) / f"coll-{version}.bin"


def add(conn: sqlite3.Connection, version: str, data: bytes, notes: str | None = None, root: Path | None = None) -> dict:
    version = (version or "").strip()
    if not valid_version(version):
        raise ValueError("version: three numbers, like 0.2.0")
    if len(data) < 1024 or data[0] != ESP_IMAGE_MAGIC:
        raise ValueError("that isn't an ESP32 app image (.bin from the firmware build)")
    if len(data) > MAX_BYTES:
        raise ValueError("image larger than an app slot (8 MB)")
    d = root or DIR
    d.mkdir(parents=True, exist_ok=True)
    p = path(version, d)
    tmp = p.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(p)
    sha = hashlib.sha1(data).hexdigest()
    conn.execute("""INSERT INTO coll_firmware (version, sha1, bytes, notes) VALUES (?,?,?,?)
                    ON CONFLICT(version) DO UPDATE SET sha1=excluded.sha1, bytes=excluded.bytes, notes=excluded.notes,
                      uploaded_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
                 (version, sha, len(data), (notes or "").strip() or None))
    for old in listing(conn)[KEEP:]:
        remove(conn, old["version"], root=d, commit=False)
    conn.commit()
    return next(f for f in listing(conn) if f["version"] == version)


def listing(conn: sqlite3.Connection) -> list[dict]:
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM coll_firmware")]
    except sqlite3.OperationalError:
        return []
    return sorted(rows, key=lambda r: key(r["version"]), reverse=True)


def latest(conn: sqlite3.Connection) -> dict | None:
    rows = listing(conn)
    return rows[0] if rows else None


def offer(conn: sqlite3.Connection) -> dict | None:
    """What /coll/sync tells Coll: the newest build. Coll installs it if it's newer than its own."""
    f = latest(conn)
    if not f:
        return None
    return {"version": f["version"], "sha1": f["sha1"], "bytes": f["bytes"], "url": f"/coll/firmware/{f['version']}"}


def remove(conn: sqlite3.Connection, version: str, root: Path | None = None, commit: bool = True) -> bool:
    n = conn.execute("DELETE FROM coll_firmware WHERE version=?", (version,)).rowcount
    try:
        path(version, root).unlink()
    except FileNotFoundError:
        pass
    if commit:
        conn.commit()
    return n > 0


def state(device_fw: str | None, newest: dict | None) -> str:
    """'up to date' · 'update offered' (Coll installs it at its next sync) · 'newer on Coll' · 'none'"""
    if not newest:
        return "none"
    if not device_fw:
        return "update offered"
    a, b = key(device_fw), key(newest["version"])
    return "up to date" if a == b else ("update offered" if a < b else "newer on Coll")
