"""GPX reading: the course line (track or route points, with elevation) and its waypoints.
Standard library only, so it runs unchanged inside Daybook on the Pi."""
import re
import xml.etree.ElementTree as ET

# Waypoint kinds, the same numbers as core::Waypoint::Kind on the device
POI, FEED, SUMMIT, ALERT = 0, 1, 2, 3

_FEED_WORDS = re.compile(r'water|drink|food|aid|feed|refresh|avituall|ravito|verpfleg|bebida|agua', re.I)
_SUMMIT_WORDS = re.compile(r'summit|peak|top|cima|cumbre|gipfel|sommet', re.I)
_ALERT_WORDS = re.compile(r'alert|danger|caution|warning|hazard|perill|peligro', re.I)


def classify(sym, typ, name):
    """Waypoint kind from its symbol / type (Garmin, Strava, Komoot use these), else POI."""
    tag = f'{sym} {typ}'
    if _FEED_WORDS.search(tag):
        return FEED
    if _SUMMIT_WORDS.search(tag):
        return SUMMIT
    if _ALERT_WORDS.search(tag):
        return ALERT
    return FEED if re.search(r'avituallament|feed zone|aid station', name, re.I) else POI


def _local(tag):
    return tag.rsplit('}', 1)[-1]


def parse(text):
    """{'name', 'points': [(lat, lon, ele)], 'waypoints': [(lat, lon, kind, name)]}"""
    root = ET.fromstring(text)
    name, track, route, waypoints = '', [], [], []
    for el in root.iter():
        tag = _local(el.tag)
        if tag == 'name' and not name and el.text:
            name = el.text.strip()
        elif tag in ('trkpt', 'rtept', 'wpt'):
            lat, lon = float(el.get('lat')), float(el.get('lon'))
            fields = {_local(c.tag): (c.text or '').strip() for c in el}
            if tag == 'wpt':
                kind = classify(fields.get('sym', ''), fields.get('type', ''), fields.get('name', ''))
                waypoints.append((lat, lon, kind, fields.get('name', '')))
            else:
                ele = float(fields['ele']) if fields.get('ele') else 0.0
                (track if tag == 'trkpt' else route).append((lat, lon, ele))
    return {'name': name, 'points': track or route, 'waypoints': waypoints}
