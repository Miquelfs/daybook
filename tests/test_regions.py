"""Catalan places get the senyera: city → region from a track point inside Catalonia's outline."""

import json
import sqlite3
import unittest

from domains.locations import regions


class CataloniaTest(unittest.TestCase):
    def test_outline(self):
        inside = [(2.17, 41.39), (0.62, 41.61), (2.82, 41.98), (1.25, 41.12), (0.52, 40.81), (0.80, 42.70)]
        outside = [(2.65, 39.57), (0.35, 41.52), (-0.88, 41.65), (0.47, 40.47), (2.89, 42.70), (-0.38, 39.47)]
        self.assertTrue(all(regions.in_catalonia(*p) for p in inside))         # BCN, Lleida, Girona, Tarragona, Tortosa, Vielha
        self.assertFalse(any(regions.in_catalonia(*p) for p in outside))       # Palma, Fraga, Zaragoza, Vinaròs, Perpinyà, València

    def test_cities_and_region(self):
        regions._CACHE.clear()
        c = sqlite3.connect(":memory:")
        c.executescript("""
            CREATE TABLE tracks(id INTEGER PRIMARY KEY, geocode_city TEXT, geocode_country TEXT, points_json TEXT);
            CREATE TABLE visits(place_id TEXT, lat REAL, lng REAL);
            CREATE TABLE place_names(place_id TEXT, city TEXT, country TEXT);
            INSERT INTO place_names VALUES ('s', 'Sabadell', 'España'), ('t', 'Arona', 'España');
            INSERT INTO visits VALUES ('s', 41.55, 2.11), ('t', 28.10, -16.68);""")
        regions._CACHE.clear()
        for city, country, lng, lat in [("Barcelona", "España", 2.17, 41.39), ("Gelida", "España", 1.86, 41.44),
                                        ("Palma", "España", 2.65, 39.57), ("Perpignan", "France", 2.89, 42.70)]:
            c.execute("INSERT INTO tracks (geocode_city, geocode_country, points_json) VALUES (?,?,?)",
                      (city, country, json.dumps([{"lat": lat, "lng": lng}])))
        cat = regions.catalan_cities(c)
        self.assertEqual(cat, {"Barcelona", "Gelida", "Sabadell"})                      # Google-history city too
        self.assertEqual(regions.region_for("Spain", ["Barcelona", "Gelida"], cat), "Catalonia")
        self.assertIsNone(regions.region_for("Spain", ["Barcelona", "Palma"], cat))       # a city list: all must be
        pts = regions.city_points(c)
        palma = (2.64, 39.57)                                                             # home: Mallorca
        self.assertEqual(regions.trip_region("Spain", ["Barcelona", "Palma", "Gelida"], cat, pts, palma), "Catalonia")
        self.assertEqual(regions.trip_region("Spain", ["Barcelona", "Palma"], cat, pts, palma), "Catalonia")
        self.assertIsNone(regions.trip_region("Spain", ["Arona", "Palma"], cat, pts, palma))       # Tenerife trip
        self.assertIsNone(regions.trip_region("Spain", ["Palma"], cat, pts, palma))               # nothing away
        self.assertIsNone(regions.trip_region("Spain", ["Barcelona", "Arona"], cat, pts, palma))  # Spain beyond Catalonia
        self.assertEqual(regions.trip_region("Spain", ["Barcelona", "Gelida", "Palma"], cat, pts, None), "Catalonia")
        self.assertIsNone(regions.region_for("France", ["Barcelona"], cat))


if __name__ == "__main__":
    unittest.main()
