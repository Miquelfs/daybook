"""GPX + OpenStreetMap roads → a course pack for the device.

What it works out, so the device doesn't have to:
- which road the course is on at every 10 m (map matching: route planners draw courses on
  OpenStreetMap roads, so the nearest road with the same direction is the right one);
- turn prompts only at real junctions, and only where the course doesn't simply carry on
  straight: "RIGHT onto Ma-2141", "KEEP LEFT", "ROUNDABOUT, exit 2";
- the roads near the course, simplified, for the map.
Standard library only.
"""
import math
from collections import defaultdict

from . import gpx as G
from . import osm

STEP = 10.0               # m between course samples
MATCH_MAX = 25.0          # m: farther than this from any road = unmatched
JUNCTION_NEAR = 12.0      # m: course passes this close to a junction node
CLUSTER = 35.0            # m: junction nodes this close along the course are one junction
EXIT_PROBE = 25.0         # m along a road to measure its direction from a junction
CONTEXT = 300.0           # m: roads kept for the map within this distance of the course
SIMPLIFY = 4.0            # m: Douglas–Peucker tolerance for map roads
K_PER_DEG = 111320.0

# map classes, drawn by the device from bold to faint
ROAD_CLASS = {'motorway': 0, 'trunk': 0, 'primary': 1, 'secondary': 1, 'tertiary': 2,
              'unclassified': 2, 'road': 2, 'residential': 3, 'living_street': 3,
              'cycleway': 4, 'track': 4}
TURN, KEEP, ROUNDABOUT = 0, 1, 2


def wrap(d):
    return (d + 180) % 360 - 180


def bearing(ax, ay, bx, by):
    return math.degrees(math.atan2(bx - ax, by - ay))


class Projection:
    """The device's projection: metres east/north of the course's first point."""
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0, self.kx = lat0, lon0, math.cos(math.radians(lat0))

    def xy(self, lat, lon):
        return (lon - self.lon0) * K_PER_DEG * self.kx, (lat - self.lat0) * K_PER_DEG


class Grid:
    """Bucket items by 50 m cells for nearby lookups."""
    def __init__(self, cell=50.0):
        self.cell, self.cells = cell, defaultdict(list)

    def add_box(self, x0, y0, x1, y1, item):
        c = self.cell
        for i in range(int(math.floor(min(x0, x1) / c)), int(math.floor(max(x0, x1) / c)) + 1):
            for j in range(int(math.floor(min(y0, y1) / c)), int(math.floor(max(y0, y1) / c)) + 1):
                self.cells[(i, j)].append(item)

    def near(self, x, y):
        i, j = int(math.floor(x / self.cell)), int(math.floor(y / self.cell))
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                yield from self.cells.get((i + di, j + dj), ())


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


class Course:
    def __init__(self, points, proj):
        self.xy = [proj.xy(lat, lon) for lat, lon, _ in points]
        self.at = [0.0]
        for (ax, ay), (bx, by) in zip(self.xy, self.xy[1:]):
            self.at.append(self.at[-1] + math.hypot(bx - ax, by - ay))
        self.length = self.at[-1]
        n = int(self.length / STEP) + 1
        self.samples, j = [], 0
        for i in range(n):
            a = i * STEP
            while j + 2 < len(self.at) and self.at[j + 1] < a:
                j += 1
            seg = self.at[j + 1] - self.at[j]
            f = 0 if seg <= 0 else min(1, max(0, (a - self.at[j]) / seg))
            (ax, ay), (bx, by) = self.xy[j], self.xy[j + 1]
            self.samples.append((ax + f * (bx - ax), ay + f * (by - ay)))

    def point(self, a):
        i = int(min(max(a, 0), self.length) / STEP)
        return self.samples[min(i, len(self.samples) - 1)]

    def bearing(self, a0, a1):
        return bearing(*self.point(a0), *self.point(a1))


class Roads:
    def __init__(self, nodes, ways, proj):
        self.nxy = {nid: proj.xy(lat, lon) for nid, (lat, lon) in nodes.items()}
        self.ways = {wid: ([n for n in ns if n in self.nxy], tags)
                     for wid, (ns, tags) in ways.items() if tags.get('highway') in ROAD_CLASS
                     or tags.get('highway', '').endswith('_link')}
        self.segs = Grid()
        self.occ = defaultdict(list)          # node → [(way id, index)]
        self.degree = defaultdict(int)
        for wid, (ns, _) in self.ways.items():
            for i, nid in enumerate(ns):
                self.occ[nid].append((wid, i))
                self.degree[nid] += 1 if i in (0, len(ns) - 1) else 2
            for i in range(len(ns) - 1):
                (ax, ay), (bx, by) = self.nxy[ns[i]], self.nxy[ns[i + 1]]
                self.segs.add_box(ax, ay, bx, by, (wid, i))
        self.junctions = Grid()
        for nid, d in self.degree.items():
            if d >= 3:
                self.junctions.add_box(*self.nxy[nid], *self.nxy[nid], nid)

    def tags(self, wid):
        return self.ways[wid][1] if wid is not None else {}

    def is_roundabout(self, wid):
        return self.tags(wid).get('junction') in ('roundabout', 'circular')

    def label(self, wid):
        """What the device shows: the road number, else a name it can draw (Latin-1 fonts):
        the English or international name where the local one is in another script."""
        t = self.tags(wid)
        ref = ''.join(c for c in t.get('ref', '').split(';')[0] if ord(c) < 256).strip()
        if ref:                                    # "屏76" → "76"
            return ref
        for key in ('name', 'name:en', 'int_name', 'name:latin'):
            v = t.get(key, '')
            if v and all(ord(c) < 256 for c in v):
                return v
        return ''

    def exits(self, nid):
        """Directions a bike may leave a junction node in: [(bearing, way id)]."""
        out = []
        x0, y0 = self.nxy[nid]
        for wid, i in self.occ[nid]:
            ns, tags = self.ways[wid]
            ow = tags.get('oneway', 'roundabout' if self.is_roundabout(wid) else 'no')
            if tags.get('oneway:bicycle') == 'no':
                ow = 'no'
            for step in (1, -1):
                if not 0 <= i + step < len(ns):
                    continue
                if (ow in ('yes', '1', 'true', 'roundabout') and step < 0) or (ow == '-1' and step > 0):
                    continue
                k, dist, (px, py) = i, 0.0, (x0, y0)
                while 0 <= k + step < len(ns) and dist < EXIT_PROBE:
                    k += step
                    qx, qy = self.nxy[ns[k]]
                    dist += math.hypot(qx - px, qy - py)
                    px, py = qx, qy
                if dist > 0.5:
                    out.append((bearing(x0, y0, px, py), wid))
        return out


def match(course, roads):
    """The road under every course sample (None where nothing fits)."""
    matched, prev = [], None
    for i, (x, y) in enumerate(course.samples):
        a = i * STEP
        cb = course.bearing(a - 15, a + 15)
        scores = {}
        for wid, k in roads.segs.near(x, y):
            ns = roads.ways[wid][0]
            (ax, ay), (bx, by) = roads.nxy[ns[k]], roads.nxy[ns[k + 1]]
            d = seg_dist(x, y, ax, ay, bx, by)
            if d > MATCH_MAX:
                continue
            diff = abs(wrap(bearing(ax, ay, bx, by) - cb))
            score = d + 0.25 * min(diff, 180 - diff)
            scores[wid] = min(score, scores.get(wid, 1e9))
        best = min(scores, key=scores.get) if scores else None
        if prev in scores and scores[prev] <= scores[best] + 4:    # don't flicker between roads
            best = prev
        matched.append(best)
        prev = best
    return matched


def maneuvers(course, roads, matched):
    """Turn prompts at junctions where the course doesn't take the obvious way."""
    way_at = lambda a: matched[min(len(matched) - 1, max(0, int(a / STEP)))]
    hits = {}                                       # junction node → (along, distance)
    for i, (x, y) in enumerate(course.samples):
        for nid in roads.junctions.near(x, y):
            nx, ny = roads.nxy[nid]
            d = math.hypot(nx - x, ny - y)
            if d <= JUNCTION_NEAR and (nid not in hits or d < hits[nid][1]):
                hits[nid] = (i * STEP, d)
    clusters = []
    for nid, (a, _) in sorted(hits.items(), key=lambda kv: kv[1][0]):
        if clusters and a - clusters[-1][-1][1] <= CLUSTER:
            clusters[-1].append((nid, a))
        else:
            clusters.append([(nid, a)])

    out, ring = [], None                            # ring: roundabout being ridden
    for cl in clusters:
        a0, a1 = cl[0][1], cl[-1][1]
        w_in, w_out = way_at(a0 - 20), way_at(a1 + 20)
        b_in, b_out = course.bearing(a0 - 45, a0 - 10), course.bearing(a1 + 10, a1 + 45)
        dev = wrap(b_out - b_in)
        exits = [e for nid, _ in cl for e in roads.exits(nid)]
        options = [(b, w) for b, w in exits if abs(wrap(b - (b_in + 180))) > 40]
        on_in, on_out = roads.is_roundabout(w_in), roads.is_roundabout(w_out)
        if not on_in and on_out:                    # entering a roundabout
            ring = {'at': a0, 'b_in': b_in, 'exits': 0}
            continue
        if ring is not None and on_in:
            if on_out:                              # passing an exit we don't take
                ring['exits'] += sum(1 for b, w in options if not roads.is_roundabout(w))
                continue
            out.append({'at': ring['at'], 'angle': round(wrap(b_out - ring['b_in'])), 'kind': ROUNDABOUT,
                        'exit': ring['exits'] + 1, 'road': roads.label(w_out)})
            ring = None
            continue
        if not options:
            continue
        straightest = min(abs(wrap(b - b_in)) for b, _ in options)
        if abs(dev) > straightest + 15:             # leaves the obvious line: a real turn
            out.append({'at': a0, 'angle': round(dev), 'kind': TURN, 'exit': 0, 'road': roads.label(w_out)})
            continue
        # carries on straight-ish; a fork if another way also goes nearly straight and the
        # course changes road there (staying on the same road through a split needs no prompt)
        rivals = [b for b, w in options if abs(wrap(b - b_out)) > 15 and abs(wrap(b - b_in)) < 40]
        same_road = roads.label(w_in) and roads.label(w_in) == roads.label(w_out)
        if rivals and not same_road:
            side = 1 if wrap(rivals[0] - b_out) < 0 else -1     # the other way is left → keep right
            out.append({'at': a0, 'angle': side * max(10, round(abs(dev))), 'kind': KEEP, 'exit': 0,
                        'road': roads.label(w_out)})
    return out


def simplify(pts, tol):
    """Douglas–Peucker."""
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    best, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = seg_dist(*pts[i], ax, ay, bx, by)
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def map_roads(course, roads):
    """Roads near the course, cut to the corridor and simplified: [(class, [(x, y)])]."""
    near = Grid(CONTEXT)
    for i, (x, y) in enumerate(course.samples[::10]):         # every 100 m
        near.add_box(x, y, x, y, (x, y))

    def close(p):
        return any(math.hypot(p[0] - x, p[1] - y) <= CONTEXT for x, y in near.near(*p))

    out = []
    for wid, (ns, tags) in roads.ways.items():
        cls = ROAD_CLASS.get(tags.get('highway', '').replace('_link', ''), 2)
        run = []
        for nid in ns + [None]:
            p = roads.nxy[nid] if nid is not None else None
            if p is not None and close(p):
                run.append(p)
                continue
            if p is not None and run:
                run.append(p)                      # one point past the edge, so lines reach it
            if len(run) >= 2:
                out.append((cls, simplify(run, SIMPLIFY)))
            run = []
    return out


def build(gpx_text, cache_dir=None, log=print, elevations=None):
    """GPX text → (course pack bytes, summary dict, turns).
    elevations: optional metres, one per course point, replacing the GPX's own (Daybook
    passes its tunnel-corrected profile so ClimbPro doesn't show climbs over tunnels)."""
    from . import pack
    g = G.parse(gpx_text)
    if len(g['points']) < 2:
        raise ValueError('no track or route points')
    if elevations is not None:
        if len(elevations) != len(g['points']):
            raise ValueError('elevations: one per course point')
        g['points'] = [(lat, lon, float(e)) for (lat, lon, _), e in zip(g['points'], elevations)]
    lat0, lon0, _ = g['points'][0]
    proj = Projection(lat0, lon0)
    course = Course(g['points'], proj)
    log(f"{g['name']}: {course.length / 1000:.1f} km, {len(g['waypoints'])} waypoints")
    nodes, ways = osm.corridor(g['points'], CONTEXT, cache_dir, log)
    roads = Roads(nodes, ways, proj)
    matched = match(course, roads)
    turns = maneuvers(course, roads, matched)
    lines = map_roads(course, roads)
    data = pack.write(g, turns, lines)
    summary = {
        'name': g['name'], 'km': round(course.length / 1000, 1), 'waypoints': len(g['waypoints']),
        'matched_pct': round(100 * sum(m is not None for m in matched) / len(matched), 1),
        'turns': len(turns), 'roundabouts': sum(t['kind'] == ROUNDABOUT for t in turns),
        'keeps': sum(t['kind'] == KEEP for t in turns), 'map_roads': len(lines),
        'map_points': sum(len(p) for _, p in lines), 'bytes': len(data),
    }
    return data, summary, turns
