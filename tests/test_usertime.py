import os
import sqlite3
import tempfile
import time
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from infrastructure.db import usertime


class UserTimeTest(unittest.TestCase):
    def setUp(self):
        self._tz = os.environ.get("TZ")
        self.db = Path(tempfile.mkdtemp()) / "d.db"

    def tearDown(self):
        if self._tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = self._tz
        time.tzset()

    def test_default_home_and_persist(self):
        self.assertEqual(usertime.read_tz(self.db), "Europe/Madrid")
        usertime.write_tz("Asia/Taipei", self.db)
        self.assertEqual(usertime.read_tz(self.db), "Asia/Taipei")
        with self.assertRaises(ValueError):
            usertime.write_tz("Mars/Olympus", self.db)

    def test_process_today_follows_you(self):
        usertime.apply_tz("Asia/Tokyo")
        tokyo = date.today()
        usertime.apply_tz("America/Los_Angeles")
        la = date.today()
        # Tokyo is 16–17 h ahead of LA: the local dates differ for most of the day, never by more than one
        self.assertLessEqual((tokyo - la).days, 1)
        self.assertEqual(datetime.now().astimezone().utcoffset(), datetime.now(timezone.utc).astimezone().utcoffset())
        self.assertEqual(usertime.current_tz(), "America/Los_Angeles")


if __name__ == "__main__":
    unittest.main()
