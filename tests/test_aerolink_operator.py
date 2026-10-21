"""School flights: Aerolink-imported entries get operator 'Aerolink', nothing else changes."""

import sqlite3
import unittest

from infrastructure.db.migrate_aerolink_operator import migrate


class AerolinkOperatorTest(unittest.TestCase):
    def test_sets_missing_operator_only_on_aerolink_rows(self):
        c = sqlite3.connect(":memory:")
        c.executescript("""
            CREATE TABLE flights(id, source, operator);
            INSERT INTO flights VALUES ('a', 'aerolink', NULL), ('b', 'aerolink', ''),
                                       ('c', 'full_csv', NULL), ('d', 'norwegian', 'Norwegian'),
                                       ('e', 'aerolink', 'Custom');""")
        self.assertEqual(migrate(c), 2)
        self.assertEqual(dict(c.execute("SELECT id, operator FROM flights")),
                         {"a": "Aerolink", "b": "Aerolink", "c": None, "d": "Norwegian", "e": "Custom"})
        self.assertEqual(migrate(c), 0)   # idempotent

    def test_no_flights_table(self):
        self.assertEqual(migrate(sqlite3.connect(":memory:")), 0)


if __name__ == "__main__":
    unittest.main()
