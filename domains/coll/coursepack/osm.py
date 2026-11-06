"""Roads along a course from OpenStreetMap, via the Overpass API: works anywhere in the
world, fetches small boxes along the course (filtered to a corridor later), caches every
answer on disk. Standard library only (certifi if installed)."""
import hashlib
import json
import math
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

try:                       # python.org Python on macOS ships without root certificates
    import certifi
    _SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL = ssl.create_default_context()

# Public servers, tried in turn (Nov 2026: the main one answers a box in ~40 s; mirrors
# come and go). Daybook could point this at its own Overpass later.
ENDPOINTS = ['https://overpass-api.de/api/interpreter',
             'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
# Roads a bike can use. Footways, paths, steps and service roads (driveways, car parks)
# are left out: they would make every driveway look like a junction.
HIGHWAYS = ('motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|'
            'cycleway|track|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link')
CHUNK_POINTS = 60           # course points per box (~6 km at 100 m spacing)


def _thin(points, spacing_m):
    """Every point at least spacing_m from the previous kept one (cheap flat distance)."""
    out, last = [], None
    for lat, lon, *_ in points:
        if last is None or abs(lat - last[0]) * 111320 + abs(lon - last[1]) * 85000 >= spacing_m:
            out.append((lat, lon))
            last = (lat, lon)
    if out[-1] != tuple(points[-1][:2]):
        out.append(tuple(points[-1][:2]))
    return out


def _query(coords, margin_m):
    lats, lons = [c[0] for c in coords], [c[1] for c in coords]
    dlat = margin_m / 111320
    dlon = margin_m / (111320 * max(0.2, math.cos(math.radians(lats[0]))))
    box = f'{min(lats) - dlat:.5f},{min(lons) - dlon:.5f},{max(lats) + dlat:.5f},{max(lons) + dlon:.5f}'
    return f'[out:json][timeout:180];way[highway~"^({HIGHWAYS})$"]({box});(._;>;);out body qt;'


def _fetch(query, cache_dir, log):
    key = hashlib.sha1(query.encode()).hexdigest()[:20]
    path = os.path.join(cache_dir, key + '.json') if cache_dir else None
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    body = urllib.parse.urlencode({'data': query}).encode()
    for attempt in range(12):                      # public servers are often busy: be patient
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        req = urllib.request.Request(url, data=body, headers={'User-Agent': 'coll-coursepack/0.1'})
        try:
            with urllib.request.urlopen(req, timeout=120, context=_SSL) as r:
                data = json.load(r)
            break
        except (urllib.error.URLError, TimeoutError) as e:    # busy (429/5xx) or unreachable
            if isinstance(e, urllib.error.HTTPError) and e.code not in (429, 502, 503, 504):
                raise
            wait = min(60, 5 * (attempt + 1))
            log(f'  overpass {url.split("/")[2]}: {e}; trying again in {wait} s')
            time.sleep(wait)
    else:
        raise RuntimeError('Overpass API unavailable')
    time.sleep(1)                                       # be polite to the public server
    if path:
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, 'w') as f:
            json.dump(data, f)
    return data


def corridor(points, radius_m=300, cache_dir=None, log=print):
    """Roads in boxes reaching radius_m around the course:
    ({node id: (lat, lon)}, {way id: (node ids, tags)})."""
    coords = _thin(points, 100)
    nodes, ways = {}, {}
    chunks = range(0, len(coords) - 1, CHUNK_POINTS)
    for n, i in enumerate(chunks, 1):
        part = coords[i:i + CHUNK_POINTS + 1]          # overlap one point
        log(f'  roads {n}/{len(chunks)}')
        data = _fetch(_query(part, radius_m), cache_dir, log)
        for el in data['elements']:
            if el['type'] == 'node':
                nodes[el['id']] = (el['lat'], el['lon'])
            elif el['type'] == 'way':
                ways[el['id']] = (el['nodes'], el.get('tags', {}))
    return nodes, ways
