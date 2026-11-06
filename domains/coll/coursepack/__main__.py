"""python3 -m tools.coursepack course.gpx [-o course.coll] [--turns]

GPX → course pack for the device (and the simulator: ./sim --gpx course.coll).
OpenStreetMap answers are cached in ~/.cache/coursepack, so a second run is offline."""
import argparse
import os
import sys

from .build import build, KEEP, ROUNDABOUT


def main():
    ap = argparse.ArgumentParser(prog='coursepack')
    ap.add_argument('gpx')
    ap.add_argument('-o', '--out')
    ap.add_argument('--turns', action='store_true', help='list every turn prompt')
    args = ap.parse_args()
    with open(args.gpx, encoding='utf-8') as f:
        text = f.read()
    cache = os.path.expanduser('~/.cache/coursepack')
    data, summary, turns = build(text, cache, log=lambda m: print(m, file=sys.stderr))
    out = args.out or os.path.splitext(args.gpx)[0] + '.coll'
    with open(out, 'wb') as f:
        f.write(data)
    for k, v in summary.items():
        print(f'{k:12s} {v}')
    print(f'wrote {out}')
    if args.turns:
        for t in turns:
            what = ('ROUNDABOUT exit %d' % t['exit']) if t['kind'] == ROUNDABOUT else \
                   ('KEEP ' if t['kind'] == KEEP else '') + ('RIGHT' if t['angle'] > 0 else 'LEFT')
            print(f"  km {t['at'] / 1000:6.2f}  {t['angle']:+4d}  {what:18s} {t['road']}")


if __name__ == '__main__':
    main()
