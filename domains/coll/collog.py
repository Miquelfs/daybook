"""Coll ride log (.clg) → GPX. Vendored from ciclocomputer/tools/collog.py — change it there, copy it here.

    python3 tools/collog.py ride.clg [-o ride.gpx]

Format (little-endian), the same as firmware/lib/core/ridelog.h:
    "CLG1", i64 start (UTC s), u16 length + UTF-8 course name
    records of 24 bytes: u32 t (s since start), i32 lat·1e7, i32 lon·1e7, i32 elevation cm,
    u16 speed cm/s, u8 heart rate (0 none), u8 cadence (255 none), u16 power (0xFFFF none),
    u8 flags (1 fix, 2 lap starts, 4 resumed after a pause or a reboot), u8 satellites
A crash can leave half a record at the end; it is ignored.
"""
import argparse
import struct
from datetime import datetime, timezone
from xml.sax.saxutils import escape

FIX, LAP, RESUME = 1, 2, 4
_REC = struct.Struct('<IiiiHBBHBB')


def read(data):
    """(start UTC seconds, course name, [record dicts])"""
    if data[:4] != b'CLG1':
        raise ValueError('not a Coll ride log')
    start, n = struct.unpack_from('<qH', data, 4)
    course = data[14:14 + n].decode('utf-8')
    records = []
    for off in range(14 + n, len(data) - _REC.size + 1, _REC.size):
        t, lat, lon, ele, spd, hr, cad, pw, flags, sats = _REC.unpack_from(data, off)
        records.append({'time': start + t, 'lat': lat / 1e7, 'lon': lon / 1e7, 'ele': ele / 100,
                        'speed': spd / 100, 'hr': hr or None, 'cad': None if cad == 255 else cad,
                        'power': None if pw == 0xFFFF else pw, 'fix': bool(flags & FIX),
                        'lap': bool(flags & LAP), 'resume': bool(flags & RESUME), 'sats': sats})
    return start, course, records


def to_gpx(data):
    start, course, records = read(data)
    iso = lambda s: datetime.fromtimestamp(s, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<gpx version="1.1" creator="Coll" xmlns="http://www.topografix.com/GPX/1/1"',
           ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
           f' <metadata><time>{iso(start)}</time></metadata>',
           f' <trk><name>{escape(course or "Ride")}</name><type>cycling</type><trkseg>']
    for i, r in enumerate(records):
        if i and (r['lap'] or r['resume']):
            out.append(' </trkseg><trkseg>')
        if not r['fix']:
            continue
        ext = ''
        if r['power'] is not None:
            ext += f"<power>{r['power']}</power>"
        tpx = (f"<gpxtpx:hr>{r['hr']}</gpxtpx:hr>" if r['hr'] else '') + \
              (f"<gpxtpx:cad>{r['cad']}</gpxtpx:cad>" if r['cad'] is not None else '')
        if tpx:
            ext += f'<gpxtpx:TrackPointExtension>{tpx}</gpxtpx:TrackPointExtension>'
        out.append(f"  <trkpt lat=\"{r['lat']:.6f}\" lon=\"{r['lon']:.6f}\"><ele>{r['ele']:.1f}</ele>"
                   f"<time>{iso(r['time'])}</time>{f'<extensions>{ext}</extensions>' if ext else ''}</trkpt>")
    out.append(' </trkseg></trk>\n</gpx>\n')
    return '\n'.join(out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('log')
    ap.add_argument('-o', '--out')
    a = ap.parse_args()
    with open(a.log, 'rb') as f:
        gpx = to_gpx(f.read())
    out = a.out or a.log.rsplit('.', 1)[0] + '.gpx'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(gpx)
    print(f'wrote {out}')
