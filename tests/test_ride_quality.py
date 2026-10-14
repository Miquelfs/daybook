import unittest

from domains.training.ride_quality import best_climb


def ride(profile):
    """profile: list of (km, elevation_m) waypoints at 25 km/h → 1 Hz-ish streams (every 10 s)."""
    elev, dist, secs = [], [], []
    for (k0, e0), (k1, e1) in zip(profile, profile[1:]):
        n = max(1, int((k1 - k0) / 25 * 3600 / 10))
        for j in range(n):
            f = j / n
            dist.append((k0 + (k1 - k0) * f) * 1000)
            elev.append(e0 + (e1 - e0) * f)
            secs.append(dist[-1] / 1000 / 25 * 3600)
    return elev, dist, secs


class ClimbTest(unittest.TestCase):
    def test_finds_puig_major_like_climb_between_flats(self):
        # 10 km flat, 14 km climb 50→900 m with a small 10 m dip, 10 km descent
        elev, dist, secs = ride([(0, 50), (10, 50), (17, 470), (17.5, 460), (24, 900), (34, 100)])
        c = best_climb(elev, dist, secs)
        self.assertAlmostEqual(c["gain_m"], 850, delta=15)
        self.assertAlmostEqual(c["distance_km"], 14, delta=0.6)
        self.assertGreater(c["vam"], 0)

    def test_rolling_terrain_is_not_a_climb(self):
        prof = [(k, 100 + (40 if (k // 2) % 2 else 0)) for k in range(0, 40, 2)]
        elev, dist, secs = ride(prof)
        self.assertIsNone(best_climb(elev, dist, secs))

    def test_picks_the_bigger_of_two_climbs(self):
        elev, dist, secs = ride([(0, 0), (6, 300), (12, 0), (24, 700), (30, 0)])
        self.assertAlmostEqual(best_climb(elev, dist, secs)["gain_m"], 700, delta=15)


if __name__ == "__main__":
    unittest.main()
