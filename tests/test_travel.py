"""Travel journal: EXIF time/GPS, placing moments from the track, grouping photos, story, export."""

import importlib.util
import io
import json
import sqlite3
import unittest
import zipfile
from datetime import datetime, timedelta, timezone

from domains.travel import book, journal, photos, place
from infrastructure.db.migrate_travel import migrate
from tests.helpers import tmpdir


def daybook_db() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE days(date PRIMARY KEY, mood, energy, notes, photo_path, photo_caption);
        CREATE TABLE daily_stats(date PRIMARY KEY, steps);
        CREATE TABLE trips(id INTEGER PRIMARY KEY, start_date, end_date, return_date, user_name, auto_name,
                           cover_photo_path, primary_country, hidden DEFAULT 0);
        CREATE TABLE planned_trips(id INTEGER PRIMARY KEY, name, destination, start_date, end_date);
        CREATE TABLE planned_trip_days(planned_id, date, note);
        CREATE TABLE activities(id, source, strava_id, date, name, activity_type, distance_meters,
                                duration_seconds, start_time);
        CREATE TABLE restaurants(id INTEGER PRIMARY KEY, name, cuisine, city, rating_mf, date_visited);
    """)
    migrate(c)
    return c


def loc_db() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.executescript("""
        CREATE TABLE overland_locations(id INTEGER PRIMARY KEY, recorded_at, date, lat, lng, altitude);
        CREATE TABLE tracks(id INTEGER PRIMARY KEY, date, segment_start, segment_end, points_json,
                            geocode_name, geocode_city, geocode_country);
    """)
    return c


def z(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


HAS_PIL = importlib.util.find_spec("PIL") is not None
HAS_TZF = importlib.util.find_spec("timezonefinder") is not None

T0 = datetime(2026, 11, 20, 6, 0, tzinfo=timezone.utc)      # 14:00 in Taipei


def seed_taipei(loc: sqlite3.Connection) -> None:
    """A morning walk in Taipei (06:00–07:00 UTC), then a train to Hualien in the afternoon."""
    for i in range(0, 61, 5):
        loc.execute("INSERT INTO overland_locations(recorded_at, date, lat, lng, altitude) VALUES (?,?,?,?,?)",
                    (z(T0 + timedelta(minutes=i)), "2026-11-20", 25.0330 + i * 0.0001, 121.5654, 10))
    pts = [{"lat": 25.0330 + i * 0.0001, "lng": 121.5654, "t": 0} for i in range(0, 61, 5)]
    loc.execute("INSERT INTO tracks(date, segment_start, segment_end, points_json, geocode_name, geocode_city, geocode_country)"
                " VALUES (?,?,?,?,?,?,?)", ("2026-11-20", z(T0), z(T0 + timedelta(hours=1)), json.dumps(pts),
                                            "Taipei 101", "Taipei", "Taiwan"))
    loc.execute("INSERT INTO tracks(date, segment_start, segment_end, points_json, geocode_name, geocode_city, geocode_country)"
                " VALUES (?,?,?,?,?,?,?)", ("2026-11-21", z(T0 + timedelta(days=1)), z(T0 + timedelta(days=1, hours=2)),
                                            json.dumps([{"lat": 25.0330, "lng": 121.5654}, {"lat": 23.9911, "lng": 121.6011}]),
                                            "Hualien Station", "Hualien", "Taiwan"))


class Exif(unittest.TestCase):
    def test_gps_to_decimal(self):
        lat, lng = photos.gps_to_latlng({1: "N", 2: (25.0, 1.0, 58.8), 3: "E", 4: (121.0, 33.0, 55.44)})
        self.assertAlmostEqual(lat, 25.0330, places=3)
        self.assertAlmostEqual(lng, 121.5654, places=3)

    def test_gps_south_west_and_missing(self):
        lat, lng = photos.gps_to_latlng({1: "S", 2: (33, 52, 0), 3: "W", 4: (151, 12, 0)})
        self.assertLess(lat, 0)
        self.assertLess(lng, 0)
        self.assertEqual(photos.gps_to_latlng({}), (None, None))
        self.assertEqual(photos.gps_to_latlng({2: (0, 0, 0), 4: (0, 0, 0)}), (None, None))

    def test_time_with_offset(self):
        self.assertEqual(photos.exif_time_utc("2026:11:20 14:03:11", "+08:00"), "2026-11-20T06:03:11Z")

    @unittest.skipUnless(HAS_TZF, "timezonefinder not installed")
    def test_time_without_offset_uses_photo_place_then_fallback(self):
        # No offset tag: GPS in Taipei → read as Taipei time.
        self.assertEqual(photos.exif_time_utc("2026:11:20 14:00:00", None, 25.03, 121.56), "2026-11-20T06:00:00Z")
        self.assertEqual(photos.exif_time_utc("2026:11:20 14:00:00", None, fallback_tz="Europe/Madrid"),
                         "2026-11-20T13:00:00Z")
        self.assertIsNone(photos.exif_time_utc("garbage", None))

    @unittest.skipUnless(HAS_PIL, "Pillow not installed")
    def test_store_reads_a_real_jpeg(self):
        from PIL import Image
        img = Image.new("RGB", (3000, 2000), (200, 120, 40))
        exif = Image.Exif()
        exif[0x0132] = "2026:11:20 14:03:11"
        buf = io.BytesIO()
        img.save(buf, format="JPEG", exif=exif)
        d = tmpdir()
        out = photos.store(buf.getvalue(), fallback_tz="Asia/Taipei", photos_dir=d)
        self.assertEqual(max(out["width"], out["height"]), photos.FULL_PX)
        self.assertTrue((d / out["path"]).is_file() and (d / out["thumb_path"]).is_file())
        self.assertEqual(out["taken_at"], "2026-11-20T06:03:11Z")
        with self.assertRaises(ValueError):
            photos.store(b"not an image", photos_dir=d)
        photos.remove([out["path"], out["thumb_path"], "../etc/passwd"], photos_dir=d)
        self.assertFalse((d / out["path"]).exists())


class Placing(unittest.TestCase):
    def setUp(self):
        self.conn, self.loc = daybook_db(), loc_db()
        seed_taipei(self.loc)

    def test_position_and_label_from_the_track(self):
        pos = place.position_at(self.loc, z(T0 + timedelta(minutes=22)))
        self.assertAlmostEqual(pos[0], 25.0330 + 20 * 0.0001, places=4)     # the 20-minute fix
        self.assertIsNone(place.position_at(self.loc, z(T0 + timedelta(hours=5))))
        self.assertEqual(place.label_at(self.loc, z(T0 + timedelta(minutes=30))),
                         {"place": "Taipei 101", "city": "Taipei", "country": "Taiwan"})

    def test_resolve_fills_missing_place_only(self):
        mid = journal.create_moment(self.conn, {"date": "2026-11-20", "taken_at": z(T0 + timedelta(minutes=10)),
                                                "title": "Dumplings"})
        self.assertTrue(place.resolve(self.conn, self.loc, mid))
        m = journal.get_moment(self.conn, mid)
        self.assertEqual((m["city"], m["place_source"]), ("Taipei", "track"))
        self.assertFalse(place.resolve(self.conn, self.loc, mid))          # nothing left to fill
        typed = journal.create_moment(self.conn, {"date": "2026-11-20", "place": "Grandma's"})
        self.assertEqual(journal.get_moment(self.conn, typed)["place_source"], "manual")

    def test_dropped_photos_group_by_hour_and_place(self):
        def shot(minutes, **kw):
            return {"path": f"moments/{minutes}.jpg", "thumb_path": None,
                    "taken_at": z(T0 + timedelta(minutes=minutes)), "lat": None, "lng": None, **kw}
        a = journal.place_photo(self.conn, self.loc, shot(5), "2026-11-19", allow_network=False)
        b = journal.place_photo(self.conn, self.loc, shot(40), "2026-11-19", allow_network=False)
        c = journal.place_photo(self.conn, self.loc, shot(200), "2026-11-19", allow_network=False)
        far = journal.place_photo(self.conn, self.loc, shot(45, lat=24.0, lng=121.6), "2026-11-19",
                                  allow_network=False)
        self.assertEqual(a, b)                       # same hour, same street
        self.assertNotEqual(a, c)                    # three hours later
        self.assertNotEqual(a, far)                  # same hour, 100 km away
        m = journal.get_moment(self.conn, a)
        self.assertEqual(m["date"], "2026-11-20")    # local date in Taipei, not the fallback
        self.assertEqual(m["city"], "Taipei")
        self.assertEqual(len(m["photos"]), 2)

    def test_untimed_photos_of_one_batch_share_a_moment(self):
        s = {"path": "moments/x.jpg", "thumb_path": None, "taken_at": None, "lat": None, "lng": None}
        a = journal.place_photo(self.conn, None, s, "2026-11-22", allow_network=False)
        b = journal.place_photo(self.conn, None, {**s, "path": "moments/y.jpg"}, "2026-11-22", allow_network=False)
        self.assertEqual(a, b)
        self.assertEqual(journal.get_moment(self.conn, a)["date"], "2026-11-22")

    def test_delete_returns_files(self):
        mid = journal.create_moment(self.conn, {"date": "2026-11-20"})
        pid = journal.add_photo(self.conn, mid, {"path": "moments/a.jpg", "thumb_path": "moments/a_t.jpg"})
        journal.save_story(self.conn, "2026-11-20", "2026-11-22", {"cover_photo_id": pid})
        self.assertEqual(journal.delete_photo(self.conn, pid), ["moments/a.jpg", "moments/a_t.jpg"])
        self.assertIsNone(journal.story_row(self.conn, "2026-11-20", "2026-11-22")["cover_photo_id"])
        self.assertEqual(journal.delete_moment(self.conn, mid), [])


class Story(unittest.TestCase):
    def setUp(self):
        self.conn, self.loc = daybook_db(), loc_db()
        seed_taipei(self.loc)
        self.conn.execute("INSERT INTO planned_trips VALUES (1, 'Taiwan', 'Taiwan', '2026-11-19', '2026-11-22')")
        self.conn.execute("INSERT INTO planned_trip_days VALUES (1, '2026-11-21', 'Taipei → Hualien by train')")
        self.conn.execute("INSERT INTO days(date, mood, notes) VALUES ('2026-11-20', 8, 'Rain all morning')")
        self.conn.execute("INSERT INTO activities VALUES ('garmin_1','garmin',NULL,'2026-11-20','Elephant Mountain',"
                          "'hiking',3200,3600,'2026-11-20T07:00:00Z')")
        self.conn.execute("INSERT INTO restaurants(name, cuisine, city, date_visited) "
                          "VALUES ('Din Tai Fung','Taiwanese','Taipei','2026-11-20')")
        self.m1 = journal.create_moment(self.conn, {"date": "2026-11-20", "taken_at": z(T0 + timedelta(minutes=10)),
                                                    "title": "Top of 101", "story": "Clouds below us.\nWorth it."})
        journal.add_photo(self.conn, self.m1, {"path": "moments/a.jpg", "thumb_path": "moments/a_t.jpg"})
        self.conn.commit()

    @unittest.skipUnless(HAS_TZF, "timezonefinder not installed")
    def test_story_weaves_the_day(self):
        s = journal.story(self.conn, self.loc, None, "2026-11-19", "2026-11-22", fallback_tz="Europe/Madrid")
        self.assertEqual(s["name"], "Taiwan")
        self.assertEqual(s["planned_id"], 1)
        self.assertEqual(len(s["days"]), 4)
        d20 = s["days"][1]
        self.assertEqual(d20["index"], 2)
        self.assertEqual(d20["moments"][0]["local_time"], "14:10")         # Taipei clock, not Madrid
        self.assertEqual(d20["moments"][0]["city"], "Taipei")              # placed on read
        self.assertEqual(d20["cities"], ["Taipei"])
        self.assertEqual(d20["activities"][0]["name"], "Elephant Mountain")
        self.assertEqual(d20["restaurants"][0]["name"], "Din Tai Fung")
        self.assertEqual(d20["notes"], "Rain all morning")
        self.assertEqual(s["days"][2]["plan"], "Taipei → Hualien by train")
        self.assertGreater(s["days"][2]["km"], 100)                         # the train ride
        self.assertEqual(s["totals"]["moments"], 1)
        self.assertEqual(s["totals"]["countries"], ["Taiwan"])
        self.assertEqual(s["cover"]["path"], "moments/a.jpg")              # first photo until one is chosen

    def test_summary_is_shared_by_overlapping_trips(self):
        journal.save_story(self.conn, "2026-11-19", "2026-11-22", {"summary": "Ten days of rain and tea."})
        # The detected trip starts a day later (first night away) — same story.
        self.assertEqual(journal.story_row(self.conn, "2026-11-20", "2026-11-23")["summary"], "Ten days of rain and tea.")

    def test_book_and_export(self):
        s = journal.story(self.conn, self.loc, None, "2026-11-19", "2026-11-22")
        page = book.render(s, lambda p: f"/api/photos/{p}")
        self.assertIn("Top of 101", page)
        self.assertIn("<svg", page)
        self.assertIn("Clouds below us.", page)
        self.assertIn('src="/api/photos/moments/a.jpg"', page)
        self.assertIn("The plan: Taipei → Hualien by train", page)
        self.assertNotIn("<script", page)

        d = tmpdir()
        (d / "moments").mkdir()
        (d / "moments" / "a.jpg").write_bytes(b"\xff\xd8jpeg")
        path = book.export_zip(s, self.loc, photos_dir=d)
        try:
            with zipfile.ZipFile(path) as zf:
                names = set(zf.namelist())
                self.assertTrue({"index.html", "trip.json", "route.gpx", "README.txt", "photos/a.jpg"} <= names)
                self.assertIn('src="photos/a.jpg"', zf.read("index.html").decode())
                gpx = zf.read("route.gpx").decode()
                self.assertIn("<time>2026-11-20T06:00:00Z</time>", gpx)
                self.assertIn("<name>Top of 101</name>", gpx)
                self.assertEqual(json.loads(zf.read("trip.json"))["name"], "Taiwan")
        finally:
            path.unlink()
        self.assertEqual(book.filename(s), "2026-11-19-taiwan.zip")

    def test_map_box_ignores_the_flight_home(self):
        pts = [(25.03 + i * 1e-4, 121.56) for i in range(200)] + [(41.38, 2.17)]   # one fix in Barcelona
        lat0, lat1, lng0, lng1 = book._bounds(pts, [])
        self.assertGreater(lng0, 100)


if __name__ == "__main__":
    unittest.main()
