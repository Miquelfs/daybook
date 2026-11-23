"""Passing through vs being somewhere, and thinning fast stretches (domains/locations/passing.py)."""

import unittest
from datetime import datetime, timedelta

from domains.locations import passing

T0 = datetime(2026, 11, 21, 10, 0)


def seg(minute, lat, lng, minutes=0.0):
    s = T0 + timedelta(minutes=minute)
    return {"start": s.isoformat() + "Z", "end": (s + timedelta(minutes=minutes)).isoformat() + "Z", "points": [(lat, lng)]}


class Flags(unittest.TestCase):
    def test_motorway_pings_pass_stops_stay(self):
        # 20 min at the café, then pings every minute at ~120 km/h (2 km a minute), then 2 h at the beach
        segs = [seg(0, 39.57, 2.65, minutes=20)]
        segs += [seg(21 + i, 39.57 + 0.018 * (i + 1), 2.65) for i in range(5)]
        segs += [seg(27, 39.57 + 0.018 * 6, 2.65, minutes=120)]
        f = passing.flags(segs)
        self.assertEqual(f, [False, True, True, True, True, True, False])

    def test_single_ping_at_a_restaurant_is_a_place(self):
        # arrive by car (fast in), one ping, leave an hour later 3 km away (slow out on average)
        segs = [seg(0, 39.50, 2.60), seg(10, 39.57, 2.65), seg(70, 39.59, 2.66)]
        self.assertFalse(passing.flags(segs)[1])

    def test_home_never_passes(self):
        segs = [seg(0, 39.50, 2.60), seg(1, 39.52, 2.60), seg(2, 39.54, 2.60)]
        homes = (("Casa", 39.52, 2.60, 0.1),)
        self.assertFalse(passing.flags(segs, homes)[1])


class Thin(unittest.TestCase):
    def pt(self, sec, lat, lng):
        return {"recorded_at": (T0 + timedelta(seconds=sec)).isoformat() + "Z", "lat": lat, "lng": lng}

    def test_fast_straight_road_keeps_a_point_a_km_or_a_minute(self):
        # a ping every 5 s at ~108 km/h (150 m) for 5 minutes, due north
        pts = [self.pt(i * 5, 39.5 + i * 0.00135, 2.6) for i in range(61)]
        kept = passing.thin_fast(pts)
        self.assertLess(len(kept), 15)
        self.assertEqual((kept[0], kept[-1]), (pts[0], pts[-1]))

    def test_walking_is_untouched(self):
        pts = [self.pt(i * 5, 39.5 + i * 0.00006, 2.6) for i in range(40)]   # ~1.3 m/s
        self.assertEqual(passing.thin_fast(pts), pts)

    def test_a_turn_is_kept(self):
        north = [self.pt(i * 5, 39.5 + i * 0.00135, 2.6) for i in range(6)]
        east = [self.pt(30 + i * 5, 39.5 + 5 * 0.00135, 2.6 + i * 0.00175) for i in range(1, 6)]
        kept = passing.thin_fast(north + east)
        corner = north[-1]
        self.assertIn(corner, kept)


if __name__ == "__main__":
    unittest.main()
