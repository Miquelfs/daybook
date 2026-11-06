"""The course pack: one binary file per course, read by the device (core::Course::loadPack).

Little-endian. Strings: u8 length + UTF-8 (the course name: u16 length).
    "COL1"
    name
    u32 n, n × (i32 lat·1e7, i32 lon·1e7, i32 ele cm)            course line
    u16 n, n × (u8 kind, i32 lat·1e7, i32 lon·1e7, name)         waypoints (gpx.POI/FEED/...)
    u16 n, n × (f32 at m, i16 angle °, u8 kind, u8 exit, road)   turn prompts (build.TURN/...)
    u32 n, n × (u8 class, u16 count, i32 x dm, i32 y dm,         map roads, metres east/north of
                count-1 × (i16 dx dm, i16 dy dm))                 the first course point, in dm
"""
import struct


def _str(s, wide=False):
    b = s.encode('utf-8')[:65535 if wide else 255]
    return struct.pack('<H' if wide else '<B', len(b)) + b


def _deltas(pts):
    """dm offsets, splitting any step too long for an i16."""
    out, (px, py) = [], (round(pts[0][0] * 10), round(pts[0][1] * 10))
    for x, y in pts[1:]:
        tx, ty = round(x * 10), round(y * 10)
        steps = max(1, int(max(abs(tx - px), abs(ty - py)) // 32000) + 1)
        for k in range(1, steps + 1):
            nx, ny = px + (tx - px) * k // steps, py + (ty - py) * k // steps
            out.append((nx - px, ny - py))
            px, py = nx, ny
    return out


def write(g, turns, roads):
    b = bytearray(b'COL1')
    b += _str(g['name'], wide=True)
    b += struct.pack('<I', len(g['points']))
    for lat, lon, ele in g['points']:
        b += struct.pack('<iii', round(lat * 1e7), round(lon * 1e7), round(ele * 100))
    b += struct.pack('<H', len(g['waypoints']))
    for lat, lon, kind, name in g['waypoints']:
        b += struct.pack('<Bii', kind, round(lat * 1e7), round(lon * 1e7)) + _str(name)
    b += struct.pack('<H', len(turns))
    for t in turns:
        b += struct.pack('<fhBB', t['at'], t['angle'], t['kind'], t['exit']) + _str(t['road'])
    b += struct.pack('<I', len(roads))
    for cls, pts in roads:
        d = _deltas(pts)
        b += struct.pack('<BHii', cls, len(d) + 1, round(pts[0][0] * 10), round(pts[0][1] * 10))
        b += b''.join(struct.pack('<hh', dx, dy) for dx, dy in d)
    return bytes(b)
