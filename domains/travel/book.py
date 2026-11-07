"""
A trip as something to keep: one HTML "book" (cover, the route drawn as SVG, the trip in a few
lines, then each day with its moments and photos and what Daybook recorded), plus the raw data.

The export is a zip that needs nothing but a browser, forever — no map tiles, no scripts, no
Daybook:
    index.html     the book (open it, or print it to PDF)
    photos/        every photo at full stored size
    route.gpx      the whole GPS track with timestamps (one segment per day) + moments as waypoints
    trip.json      everything on the page, as data
    README.txt

The same HTML is served live (photos from the Pi) for printing straight from Daybook.
"""

from __future__ import annotations

import html
import json
import os
import sqlite3
import tempfile
import zipfile
from datetime import date
from pathlib import Path
from typing import Callable

from domains.travel.photos import PHOTOS_DIR

AMBER = "#D97706"


def _e(s) -> str:
    return html.escape(str(s)) if s is not None else ""


def _paras(text: str | None) -> str:
    if not text:
        return ""
    return "".join(f"<p>{_e(p.strip())}</p>" for p in text.split("\n") if p.strip())


def _fmt_day(d: str) -> str:
    return date.fromisoformat(d).strftime("%A %-d %B")


def _fmt_range(a: str, b: str) -> str:
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    if da.year == db.year:
        return f"{da.strftime('%-d %B')} – {db.strftime('%-d %B %Y')}"
    return f"{da.strftime('%-d %B %Y')} – {db.strftime('%-d %B %Y')}"


def _sport(t: str | None) -> str:
    return (t or "activity").replace("_", " ")


# ── The route as SVG ──────────────────────────────────────────────────────────

def _bounds(points: list[tuple[float, float]], keep: list[tuple[float, float]]) -> tuple[float, float, float, float] | None:
    """Lat/lng box around the trip on the ground: the 2nd–98th percentile of the track (so the
    flight from home doesn't shrink the destination to a dot) plus every moment."""
    if not points and not keep:
        return None
    lats = sorted(p[0] for p in points)
    lngs = sorted(p[1] for p in points)

    def cut(v: list[float], q: float) -> float:
        return v[min(len(v) - 1, max(0, int(q * (len(v) - 1))))]

    box = [cut(lats, .02), cut(lats, .98), cut(lngs, .02), cut(lngs, .98)] if points else [90, -90, 180, -180]
    for la, ln in keep:
        box = [min(box[0], la), max(box[1], la), min(box[2], ln), max(box[3], ln)]
    return box[0], box[1], box[2], box[3]


def route_svg(story: dict, w: int = 760, h: int = 440) -> str:
    """Every day's path in grey with the numbered moments in amber — a map that needs no tiles."""
    import math
    pts = [(p[0], p[1]) for d in story["days"] for p in d["route"]]
    marks = [(m["lat"], m["lng"], m["n"]) for d in story["days"] for m in d["moments"] if m.get("lat") is not None]
    box = _bounds(pts, [(a, b) for a, b, _ in marks])
    if box is None:
        return ""
    lat0, lat1, lng0, lng1 = box
    kx = math.cos(math.radians((lat0 + lat1) / 2))
    span_x = max((lng1 - lng0) * kx, 0.01)
    span_y = max(lat1 - lat0, 0.01)
    pad = 28
    s = min((w - 2 * pad) / span_x, (h - 2 * pad) / span_y)
    ox = (w - span_x * s) / 2
    oy = (h - span_y * s) / 2

    def xy(la: float, ln: float) -> tuple[float, float]:
        return ox + (ln - lng0) * kx * s, oy + (lat1 - la) * s

    lines = []
    for d in story["days"]:
        if len(d["route"]) >= 2:
            pts_attr = " ".join("%.1f,%.1f" % xy(a, b) for a, b in d["route"])
            lines.append('<polyline points="%s" />' % pts_attr)
    dots = ""
    for a, b, n in marks:
        x, y = xy(a, b)
        dots += '<g><circle cx="%.1f" cy="%.1f" r="9" /><text x="%.1f" y="%.1f">%s</text></g>' % (x, y, x, y + 3.5, n)
    return (f'<svg class="map" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img" '
            f'aria-label="Route of the trip">'
            f'<rect width="{w}" height="{h}" class="bg" />'
            f'<g class="route">{"".join(lines)}</g><g class="marks">{dots}</g></svg>')


# ── The book ──────────────────────────────────────────────────────────────────

_CSS = """
:root { --ink:#18181B; --soft:#52525B; --faint:#A1A1AA; --line:#E4E4E7; --paper:#FAFAF9; --accent:%s; }
* { box-sizing:border-box; }
body { margin:0; background:var(--paper); color:var(--ink);
       font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width:780px; margin:0 auto; padding:32px 20px 80px; }
.cover { width:100%%; aspect-ratio:16/9; object-fit:cover; border-radius:14px; display:block; }
h1 { font-size:34px; line-height:1.15; letter-spacing:-0.02em; margin:28px 0 4px; }
.dates { color:var(--soft); margin:0; }
.stats { display:flex; flex-wrap:wrap; gap:8px 28px; margin:22px 0; padding:16px 0;
         border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.stats div { min-width:80px; } .stats b { display:block; font-size:20px; }
.stats span { font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--faint); }
.summary { font-size:18px; color:#3F3F46; }
.map { width:100%%; height:auto; border-radius:14px; margin:12px 0 8px; }
.map .bg { fill:#F4F4F5; } .map .route polyline { fill:none; stroke:#71717A; stroke-width:2; stroke-linejoin:round; stroke-linecap:round; opacity:.7; }
.map .marks circle { fill:var(--accent); stroke:#fff; stroke-width:2; }
.map .marks text { fill:#fff; font-size:10px; font-weight:700; text-anchor:middle; }
.places { color:var(--soft); font-size:14px; }
.day { margin-top:56px; break-before:page; }
.day:first-of-type { break-before:auto; }
.eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.16em; color:var(--faint); margin:0; }
h2 { font-size:24px; margin:2px 0 4px; letter-spacing:-0.01em; }
.facts { color:var(--soft); font-size:14px; margin:0 0 6px; }
.plan { color:var(--faint); font-size:14px; font-style:italic; margin:0 0 10px; }
.moment { margin:26px 0; break-inside:avoid; }
.moment h3 { font-size:18px; margin:0; display:flex; gap:10px; align-items:baseline; }
.num { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; border-radius:11px;
       background:var(--accent); color:#fff; font-size:11px; font-weight:700; }
.where { color:var(--faint); font-size:13px; margin:2px 0 8px 32px; }
.moment .text { margin-left:32px; }
.moment .text p { margin:0 0 8px; }
.photos { display:grid; grid-template-columns:repeat(2, 1fr); gap:6px; margin:10px 0 0 32px; }
.photos img { width:100%%; border-radius:8px; display:block; aspect-ratio:4/3; object-fit:cover; }
.photos img.solo { grid-column:span 2; aspect-ratio:auto; max-height:520px; }
figure { margin:0; } figcaption { color:var(--faint); font-size:12px; margin-top:3px; }
.notes { border-left:3px solid var(--line); padding-left:12px; color:var(--soft); margin:16px 0; }
footer { margin-top:64px; color:var(--faint); font-size:12px; text-align:center; }
@media print { body { background:#fff; } main { padding:0; max-width:none; } a { color:inherit; text-decoration:none; } }
""" % AMBER


def _moment_html(m: dict, src: Callable[[str], str]) -> str:
    title = m.get("title") or m.get("place") or m.get("city") or "A moment"
    where = " · ".join(x for x in [m.get("local_time"), m.get("place") if m.get("title") else None,
                                    m.get("city"), m.get("country")] if x)
    photos = m.get("photos") or []
    solo = "solo" if len(photos) == 1 else ""
    figs = ""
    for p in photos:
        cap = "<figcaption>" + _e(p["caption"]) + "</figcaption>" if p.get("caption") else ""
        figs += '<figure><img loading="lazy" class="%s" src="%s" alt="">%s</figure>' % (solo, _e(src(p["path"])), cap)
    out = '<article class="moment"><h3><span class="num">%s</span>%s</h3>' % (m["n"], _e(title))
    if where:
        out += '<p class="where">' + _e(where) + "</p>"
    out += '<div class="text">' + _paras(m.get("story")) + "</div>"
    if figs:
        out += '<div class="photos">' + figs + "</div>"
    return out + "</article>"


def _facts(d: dict) -> str:
    bits = []
    if d.get("cities"):
        bits.append(" → ".join(d["cities"][:6]))
    if d.get("km") and d["km"] >= 1:
        bits.append(f"{round(d['km']):,} km")
    if d.get("steps"):
        bits.append(f"{d['steps']:,} steps")
    for a in d.get("activities") or []:
        dist = f" {a['distance_meters'] / 1000:.1f} km" if a.get("distance_meters") else ""
        bits.append(f"{_e(a.get('name') or _sport(a.get('activity_type')))}{dist}")
    for r in d.get("restaurants") or []:
        bits.append(f"ate at {_e(r['name'])}")
    if d.get("spent_eur"):
        bits.append(f"€{d['spent_eur']:,.0f} spent")
    return " · ".join(bits)


def render(story: dict, src: Callable[[str], str], name: str | None = None) -> str:
    """The book as one HTML document. `src` maps a stored photo path to its URL."""
    title = name or story.get("name") or "A trip"
    t = story["totals"]
    stats = [(t["days"], "days"), (len(t["countries"]), "countries" if len(t["countries"]) != 1 else "country"),
             (len(t["cities"]), "places"), (f'{t["km"]:,}', "km travelled"), (t["moments"], "moments"),
             (t["photos"], "photos")]
    stats_html = "".join(f"<div><b>{_e(v)}</b><span>{_e(k)}</span></div>" for v, k in stats if v not in (0, "0"))
    cover = story.get("cover")
    out = [f"<!doctype html><html lang=en><head><meta charset=utf-8>"
           f"<meta name=viewport content='width=device-width,initial-scale=1'>"
           f"<title>{_e(title)}</title><style>{_CSS}</style></head><body><main>"]
    if cover:
        out.append(f'<img class="cover" src="{_e(src(cover["path"]))}" alt="">')
    out.append(f"<h1>{_e(title)}</h1><p class=dates>{_e(_fmt_range(story['start'], story['end']))}</p>")
    out.append(f"<div class=stats>{stats_html}</div>")
    if story.get("summary"):
        out.append(f"<div class=summary>{_paras(story['summary'])}</div>")
    out.append(route_svg(story))
    if t["cities"]:
        out.append(f"<p class=places>{_e(' · '.join(t['cities']))}</p>")

    for d in story["days"]:
        has_content = d["moments"] or d.get("notes") or d.get("day_photo") or d.get("plan")
        facts = _facts(d)
        if not has_content and not facts:
            continue
        out.append(f"<section class=day><p class=eyebrow>Day {d['index']}</p><h2>{_e(_fmt_day(d['date']))}</h2>")
        if facts:
            out.append(f"<p class=facts>{facts}</p>")
        if d.get("plan"):
            out.append(f"<p class=plan>The plan: {_e(d['plan'])}</p>")
        for m in d["moments"]:
            out.append(_moment_html(m, src))
        in_moments = {p["path"] for m in d["moments"] for p in m["photos"]}
        if d.get("day_photo") and d["day_photo"] not in in_moments:
            cap = f"<figcaption>{_e(d.get('day_photo_caption'))}</figcaption>" if d.get("day_photo_caption") else ""
            out.append(f'<figure class=moment><img class="cover" src="{_e(src(d["day_photo"]))}" alt="">{cap}</figure>')
        if d.get("notes"):
            out.append(f"<div class=notes>{_paras(d['notes'])}</div>")
        out.append("</section>")
    out.append(f"<footer>Kept with Daybook · {_e(date.today().isoformat())}</footer></main></body></html>")
    return "".join(out)


# ── GPX ───────────────────────────────────────────────────────────────────────

def gpx(story: dict, loc: sqlite3.Connection | None, name: str) -> str:
    """Full-resolution track (Overland, with times) one segment per day; moments as waypoints."""
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="Daybook" xmlns="http://www.topografix.com/GPX/1/1">',
             f"<metadata><name>{_e(name)}</name></metadata>"]
    for d in story["days"]:
        for m in d["moments"]:
            if m.get("lat") is None:
                continue
            t = "<time>" + _e(m["taken_at"]) + "</time>" if m.get("taken_at") else ""
            label = m.get("title") or m.get("place") or "Moment %s" % m["n"]
            desc = "<desc>" + _e(m["story"]) + "</desc>" if m.get("story") else ""
            parts.append('<wpt lat="%s" lon="%s">%s<name>%s</name>%s</wpt>' % (m["lat"], m["lng"], t, _e(label), desc))
    parts.append(f"<trk><name>{_e(name)}</name>")
    raw = False
    if loc is not None:
        try:
            for d in story["days"]:
                rows = loc.execute("""SELECT lat, lng, altitude, recorded_at FROM overland_locations
                                      WHERE date = ? ORDER BY recorded_at""", (d["date"],)).fetchall()
                if not rows:
                    continue
                raw = True
                parts.append("<trkseg>")
                parts += [f'<trkpt lat="{r[0]}" lon="{r[1]}">'
                          f'{f"<ele>{r[2]:.1f}</ele>" if r[2] is not None else ""}<time>{_e(r[3])}</time></trkpt>'
                          for r in rows]
                parts.append("</trkseg>")
        except sqlite3.OperationalError:
            raw = False
    if not raw:                                        # older trips: the day paths without times
        for d in story["days"]:
            if d["route"]:
                parts.append("<trkseg>" + "".join(f'<trkpt lat="{a}" lon="{b}"/>' for a, b in d["route"]) + "</trkseg>")
    parts.append("</trk></gpx>")
    return "\n".join(parts)


# ── The zip ───────────────────────────────────────────────────────────────────

_README = """{name}
{dates}

Exported from Daybook on {today}.

  index.html   the trip as a book — open it in any browser; print it to keep it on paper
  photos/      the photos ({n_photos})
  route.gpx    where you went (open in Google Earth, Strava, Komoot, gpx.studio…)
  trip.json    everything above as data: days, moments, places, times, what you did and spent
"""


def export_zip(story: dict, loc: sqlite3.Connection | None, name: str | None = None,
               photos_dir: Path = PHOTOS_DIR) -> Path:
    """Write the export to a temp file and return its path (the caller deletes it)."""
    title = name or story.get("name") or "Trip"
    paths: list[str] = []
    for d in story["days"]:
        paths += [p["path"] for m in d["moments"] for p in m["photos"]]
        if d.get("day_photo"):
            paths.append(d["day_photo"])
    if story.get("cover"):
        paths.append(story["cover"]["path"])
    local = {p: f"photos/{Path(p).name}" for p in dict.fromkeys(paths)}

    fd, tmp = tempfile.mkstemp(prefix="daybook-trip-", suffix=".zip")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.html", render(story, lambda p: local.get(p, p), title))
        z.writestr("trip.json", json.dumps({"exported": date.today().isoformat(), "format": 1, **story},
                                           ensure_ascii=False, indent=1))
        z.writestr("route.gpx", gpx(story, loc, title))
        z.writestr("README.txt", _README.format(name=title, dates=_fmt_range(story["start"], story["end"]),
                                                today=date.today().isoformat(), n_photos=len(local)))
        for src_path, arc in local.items():
            f = photos_dir / src_path
            if f.is_file():
                z.write(f, arc, compress_type=zipfile.ZIP_STORED)   # JPEGs don't compress
    return Path(tmp)


def filename(story: dict, name: str | None = None) -> str:
    import re
    base = re.sub(r"[^A-Za-z0-9]+", "-", (name or story.get("name") or "trip")).strip("-").lower() or "trip"
    return f"{story['start']}-{base}.zip"
