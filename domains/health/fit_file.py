"""
Minimal FIT decoder — just enough to read a ride recorded by a trainer app
(MyWhoosh, Zwift, …) or a bike computer: the per-second `record` messages
(power, heart rate, cadence, speed, distance, altitude, position) plus the
`session` summary and the device that wrote it.

No dependency on fitparse/fitdecode: the Pi installs nothing extra, and the
subset of the format we need is small (normal + compressed-timestamp headers,
little/big endian definitions, developer fields skipped).

    parse_fit(data: bytes) -> {"records": [...], "session": {...}, "device": str|None}

Each record is {"ts": epoch_s, "power": W, "hr": bpm, "cadence": rpm,
"speed": m/s, "distance": m, "altitude": m, "lat": deg, "lng": deg} with only
the fields the file actually has.
"""

from __future__ import annotations

import struct

FIT_EPOCH = 631065600          # 1989-12-31T00:00:00Z in unix seconds
SEMI_TO_DEG = 180.0 / 2 ** 31

# base type id (low 5 bits) → (struct code, size, invalid value)
_BASE = {
    0x00: ("B", 1, 0xFF), 0x01: ("b", 1, 0x7F), 0x02: ("B", 1, 0xFF),
    0x03: ("h", 2, 0x7FFF), 0x04: ("H", 2, 0xFFFF), 0x05: ("i", 4, 0x7FFFFFFF),
    0x06: ("I", 4, 0xFFFFFFFF), 0x07: (None, 1, None), 0x08: ("f", 4, None),
    0x09: ("d", 8, None), 0x0A: ("B", 1, 0x00), 0x0B: ("H", 2, 0x0000),
    0x0C: ("I", 4, 0x00000000), 0x0D: (None, 1, None), 0x0E: ("q", 8, 0x7FFFFFFFFFFFFFFF),
    0x0F: ("Q", 8, 0xFFFFFFFFFFFFFFFF), 0x10: ("Q", 8, 0x0000000000000000),
}

# message 20 = record: field → (name, scale, offset)
_RECORD = {
    253: ("ts", 1, 0), 0: ("lat", None, 0), 1: ("lng", None, 0),
    2: ("altitude", 5, 500), 3: ("hr", 1, 0), 4: ("cadence", 1, 0),
    5: ("distance", 100, 0), 6: ("speed", 1000, 0), 7: ("power", 1, 0),
    73: ("speed", 1000, 0), 78: ("altitude", 5, 500),     # enhanced_* win if present
}
# message 18 = session
_SESSION = {
    2: ("start_ts", 1, 0), 5: ("sport", 1, 0), 6: ("sub_sport", 1, 0),
    7: ("elapsed_s", 1000, 0), 8: ("timer_s", 1000, 0), 9: ("distance", 100, 0),
    16: ("avg_hr", 1, 0), 17: ("max_hr", 1, 0), 20: ("avg_power", 1, 0),
    21: ("max_power", 1, 0), 22: ("ascent", 1, 0), 34: ("np", 1, 0),
    11: ("calories", 1, 0),
}
_MANUFACTURER = {1: "Garmin", 32: "Wahoo", 86: "Elite", 89: "Tacx", 260: "Zwift",
                 255: "Development", 294: "MyWhoosh", 331: "MyWhoosh"}


class FitError(ValueError):
    pass


def _read_value(buf: bytes, pos: int, size: int, base: int, endian: str):
    code, bsize, invalid = _BASE.get(base & 0x1F, (None, 1, None))
    if code is None or size != bsize:
        return None          # strings, byte arrays and arrays — not needed here
    v = struct.unpack_from(endian + code, buf, pos)[0]
    if invalid is not None and v == invalid:
        return None
    if code in "fd" and v != v:   # NaN
        return None
    return v


def parse_fit(data: bytes) -> dict:
    if len(data) < 14:
        raise FitError("File too short to be a FIT file")
    hsize = data[0]
    if data[8:12] != b".FIT":
        raise FitError("Not a FIT file (missing .FIT signature)")
    data_size = struct.unpack_from("<I", data, 4)[0]
    end = min(hsize + data_size, len(data))
    pos = hsize

    defs: dict[int, dict] = {}
    records: list[dict] = []
    session: dict = {}
    device = None
    last_ts = None

    while pos < end:
        header = data[pos]
        pos += 1
        if header & 0x80:                                   # compressed timestamp
            local = (header >> 5) & 0x03
            offset = header & 0x1F
            if last_ts is not None:
                ts = (last_ts & ~0x1F) + offset
                if offset < (last_ts & 0x1F):
                    ts += 0x20
                last_ts = ts
            d = defs.get(local)
            if d is None:
                raise FitError(f"Data for undefined local message {local} at byte {pos}")
            msg, pos = _read_message(data, pos, d)
            if last_ts is not None:
                msg.setdefault(253, last_ts)
        elif header & 0x40:                                 # definition message
            local = header & 0x0F
            has_dev = bool(header & 0x20)
            arch = data[pos + 1]
            endian = ">" if arch == 1 else "<"
            gnum = struct.unpack_from(endian + "H", data, pos + 2)[0]
            nfields = data[pos + 4]
            pos += 5
            fields = []
            for _ in range(nfields):
                fields.append((data[pos], data[pos + 1], data[pos + 2]))
                pos += 3
            dev_size = 0
            if has_dev:
                ndev = data[pos]
                pos += 1
                for _ in range(ndev):
                    dev_size += data[pos + 1]
                    pos += 3
            defs[local] = {"gnum": gnum, "endian": endian, "fields": fields, "dev_size": dev_size}
            continue
        else:                                               # normal data message
            local = header & 0x0F
            d = defs.get(local)
            if d is None:
                raise FitError(f"Data for undefined local message {local} at byte {pos}")
            msg, pos = _read_message(data, pos, d)
            if msg.get(253) is not None:
                last_ts = msg[253]

        gnum = d["gnum"]
        if gnum == 20:
            rec = _decode(msg, _RECORD)
            if "ts" in rec:
                rec["ts"] += FIT_EPOCH
                for k in ("lat", "lng"):
                    if k in rec:
                        rec[k] = rec[k] * SEMI_TO_DEG
                records.append(rec)
        elif gnum == 18:
            session = _decode(msg, _SESSION)
            if "start_ts" in session:
                session["start_ts"] += FIT_EPOCH
        elif gnum == 0 and device is None:                  # file_id: manufacturer
            device = _MANUFACTURER.get(msg.get(1))
        elif gnum == 23 and device is None and msg.get(2) is not None:   # device_info
            device = _MANUFACTURER.get(msg.get(2))

    if not records:
        raise FitError("FIT file has no per-second records")
    records.sort(key=lambda r: r["ts"])
    return {"records": records, "session": session, "device": device}


def _read_message(data: bytes, pos: int, d: dict) -> tuple[dict, int]:
    msg = {}
    for num, size, base in d["fields"]:
        msg[num] = _read_value(data, pos, size, base, d["endian"])
        pos += size
    return msg, pos + d["dev_size"]


def _decode(msg: dict, spec: dict) -> dict:
    out = {}
    for num, (name, scale, offset) in spec.items():
        v = msg.get(num)
        if v is None:
            continue
        if scale is not None:
            v = v / scale - offset if (scale != 1 or offset) else v
        # enhanced fields come later in the spec order and should win
        if num in (73, 78) or name not in out:
            out[name] = v
    return out
