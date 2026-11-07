"""
Moment photos — decode any upload (iPhone HEIC too), read when and where it was taken from
EXIF, and store a web-sized copy plus a thumbnail under data/photos/moments/.

Sizes are capped (2048 px long edge, thumbnail 640 px) because the Pi's SD card is small; the
original stays on the phone. EXIF is not copied into the stored JPEGs — the time and position
live in moment_photos instead, so an exported trip carries them as data.
"""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PHOTOS_DIR = Path(__file__).parents[2] / "data" / "photos"
SUBDIR = "moments"
FULL_PX = 2048
THUMB_PX = 640

# EXIF tags
_EXIF_IFD, _GPS_IFD = 0x8769, 0x8825
_DATETIME, _DATETIME_ORIGINAL, _OFFSET_ORIGINAL = 0x0132, 0x9003, 0x9011


def _ratio(v) -> float:
    try:
        return float(v)
    except TypeError:
        num, den = v
        return num / den if den else 0.0


def gps_to_latlng(gps: dict) -> tuple[float | None, float | None]:
    """GPS IFD ({1: 'N', 2: (d, m, s), 3: 'E', 4: (d, m, s)}) → decimal degrees."""
    try:
        lat_v, lng_v = gps.get(2), gps.get(4)
        if not lat_v or not lng_v:
            return None, None
        lat = _ratio(lat_v[0]) + _ratio(lat_v[1]) / 60 + _ratio(lat_v[2]) / 3600
        lng = _ratio(lng_v[0]) + _ratio(lng_v[1]) / 60 + _ratio(lng_v[2]) / 3600
        if str(gps.get(1, "N")).upper().startswith("S"):
            lat = -lat
        if str(gps.get(3, "E")).upper().startswith("W"):
            lng = -lng
        if lat == 0 and lng == 0:
            return None, None
        return round(lat, 6), round(lng, 6)
    except (TypeError, ValueError, IndexError, ZeroDivisionError):
        return None, None


def exif_time_utc(stamp: str | None, offset: str | None, lat: float | None = None,
                  lng: float | None = None, fallback_tz: str | None = None) -> str | None:
    """'2026:11:20 14:03:11' (+ '+08:00') → '2026-11-20T06:03:11Z'.

    Without an offset tag the clock is read in the photo's own timezone (from its GPS), else in
    `fallback_tz` (where you are now)."""
    if not stamp:
        return None
    try:
        local = datetime.strptime(str(stamp).strip().rstrip("\x00")[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    tz = None
    if offset:
        try:
            sign = -1 if str(offset).strip().startswith("-") else 1
            hh, mm = str(offset).strip().lstrip("+-").split(":")[:2]
            tz = timezone(sign * timedelta(hours=int(hh), minutes=int(mm)))
        except ValueError:
            tz = None
    if tz is None and lat is not None and lng is not None:
        from domains.travel.place import tz_at
        name = tz_at(lat, lng)
        try:
            tz = ZoneInfo(name) if name else None
        except Exception:
            tz = None
    if tz is None and fallback_tz:
        try:
            tz = ZoneInfo(fallback_tz)
        except Exception:
            tz = None
    aware = local.replace(tzinfo=tz or timezone.utc)
    return aware.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_meta(img, fallback_tz: str | None = None) -> dict:
    """When and where from a PIL image's EXIF: {taken_at, lat, lng} (any may be None)."""
    try:
        exif = img.getexif()
    except Exception:
        return {"taken_at": None, "lat": None, "lng": None}
    try:
        sub = dict(exif.get_ifd(_EXIF_IFD))
    except Exception:
        sub = {}
    try:
        gps = dict(exif.get_ifd(_GPS_IFD))
    except Exception:
        gps = {}
    lat, lng = gps_to_latlng(gps)
    stamp = sub.get(_DATETIME_ORIGINAL) or exif.get(_DATETIME)
    return {"taken_at": exif_time_utc(stamp, sub.get(_OFFSET_ORIGINAL), lat, lng, fallback_tz),
            "lat": lat, "lng": lng}


def _fit(img, px: int):
    w, h = img.size
    scale = px / max(w, h)
    if scale >= 1:
        return img.copy()
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), resample=1)  # LANCZOS


def store(content: bytes, fallback_tz: str | None = None, photos_dir: Path = PHOTOS_DIR) -> dict:
    """Save an upload as moments/<id>.jpg (+ _t thumbnail). Returns the paths, size and EXIF meta.
    Raises ValueError when the file isn't an image."""
    if not content:
        raise ValueError("Empty file")
    import PIL.Image as Image
    from PIL import ImageOps
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    try:
        img = Image.open(io.BytesIO(content))
        meta = read_meta(img, fallback_tz)
        if img.format == "JPEG":
            img.draft("RGB", (FULL_PX, FULL_PX))     # decode at reduced size — the Pi has little RAM
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        full = _fit(img, FULL_PX)
        thumb = _fit(full, THUMB_PX)
    except Exception as e:
        raise ValueError(f"Not an image we can read: {e}") from e

    out = photos_dir / SUBDIR
    out.mkdir(parents=True, exist_ok=True)
    key = uuid.uuid4().hex
    full.save(out / f"{key}.jpg", format="JPEG", quality=85, optimize=True)
    thumb.save(out / f"{key}_t.jpg", format="JPEG", quality=78, optimize=True)
    return {"path": f"{SUBDIR}/{key}.jpg", "thumb_path": f"{SUBDIR}/{key}_t.jpg",
            "width": full.size[0], "height": full.size[1], **meta}


def remove(paths: list[str | None], photos_dir: Path = PHOTOS_DIR) -> None:
    for p in paths:
        if p and p.startswith(f"{SUBDIR}/") and ".." not in p:
            (photos_dir / p).unlink(missing_ok=True)
