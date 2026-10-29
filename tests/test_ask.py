"""Ask: read-only access, the SQL guard, the tool loop (with a fake Claude), threads."""

import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace as NS

from domains.ai import ask
from infrastructure.db.migrate_ask import migrate


def make_dbs(d: Path) -> None:
    c = sqlite3.connect(d / "daybook.db")
    c.executescript("""
        CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, distance_meters REAL, polyline TEXT);
        INSERT INTO activities VALUES ('a', '2026-10-01', 'running', 42195, 'x');
        INSERT INTO activities VALUES ('b', '2026-10-02', 'cycling', 180000, NULL);
    """)
    c.execute("INSERT INTO activities VALUES ('c', '2026-10-03', 'running', 5000, ?)", ("p" * 500,))
    c.commit(); c.close()
    m = sqlite3.connect(d / "money.db")
    m.executescript("CREATE TABLE transactions (date TEXT, amount REAL); INSERT INTO transactions VALUES ('2026-10-01', -12.5);")
    m.commit(); m.close()
    (d / "locations.db").touch()                     # empty file → not attached


def text(t):
    return NS(type="text", text=t)


def tool(id_, name, **inp):
    return NS(type="tool_use", id=id_, name=name, input=inp)


class FakeClient:
    """Replays scripted responses and records each request."""
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []
        self.messages = self

    def create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})
        return NS(content=self.responses.pop(0))


class ReadOnlyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        make_dbs(self.dir)
        self.ro = ask.connect_ro(self.dir)

    def tearDown(self):
        self.ro.close()
        self.tmp.cleanup()

    def test_attaches_money_and_skips_empty_files(self):
        out = ask.schema_outline(self.ro)
        self.assertIn("activities(id, date, activity_type", out)
        self.assertIn("money.transactions(date, amount)", out)
        self.assertNotIn("[locations]", out)

    def test_sql_guard(self):
        self.assertEqual(ask.clean_sql("  select 1; "), "select 1")
        self.assertEqual(ask.clean_sql("WITH x AS (SELECT 1) SELECT * FROM x"), "WITH x AS (SELECT 1) SELECT * FROM x")
        for bad in ("", "DELETE FROM activities", "select 1; drop table activities", "PRAGMA writable_schema=1"):
            with self.assertRaises(ValueError):
                ask.clean_sql(bad)

    def test_connection_cannot_write_even_past_the_guard(self):
        with self.assertRaises(sqlite3.Error):
            self.ro.execute("DELETE FROM activities")
        with self.assertRaises(sqlite3.Error):
            self.ro.execute("INSERT INTO money.transactions VALUES ('x', 1)")

    def test_query_caps_cells_and_rows(self):
        res = ask.run_query(self.ro, "SELECT polyline FROM activities WHERE id='c'")
        self.assertEqual(len(res["rows"][0][0]), ask.CELL_CHARS + 1)
        res = ask.run_query(self.ro, "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 500) SELECT i FROM n")
        self.assertEqual(len(res["rows"]), ask.MAX_ROWS)
        self.assertTrue(res["truncated"])

    def test_describe(self):
        d = ask.describe(self.ro, "money.transactions")
        self.assertIn("CREATE TABLE transactions", d["create"])
        self.assertEqual(d["sample"]["rows"], [["2026-10-01", -12.5]])
        with self.assertRaises(ValueError):
            ask.describe(self.ro, "nope")
        with self.assertRaises(ValueError):
            ask.describe(self.ro, 'activities"; --')

    def test_tool_loop_runs_queries_and_returns_the_answer(self):
        client = FakeClient(
            [tool("t1", "query", sql="SELECT COUNT(*) FROM activities WHERE activity_type='running'", purpose="runs"),
             tool("t2", "query", sql="DROP TABLE activities")],
            [text("You've logged **2** runs.")],
        )
        out = ask.answer("How many runs?", ro=self.ro, client=client, model="m", today=date(2026, 10, 29))
        self.assertEqual(out["answer"], "You've logged **2** runs.")
        self.assertEqual(out["queries"][0]["rows"], 1)
        self.assertIn("only SELECT", out["queries"][1]["error"])
        # The second request carries both tool results back, in order.
        results = client.calls[1]["messages"][-1]["content"]
        self.assertEqual([r["tool_use_id"] for r in results], ["t1", "t2"])
        self.assertIn("[[2]]", results[0]["content"])
        self.assertTrue(results[1]["content"].startswith("error:"))
        self.assertIn("2026-10-29", client.calls[0]["system"][0]["text"])

    def test_last_round_forces_an_answer(self):
        loop = [[tool(f"t{i}", "query", sql="SELECT 1")] for i in range(ask.MAX_ROUNDS)]
        client = FakeClient(*loop, [text("Done.")])
        out = ask.answer("q", ro=self.ro, client=client, model="m")
        self.assertEqual(out["answer"], "Done.")
        self.assertEqual(client.calls[-1]["tool_choice"], {"type": "none"})


class ThreadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        make_dbs(Path(self.tmp.name))
        self.ro = ask.connect_ro(Path(self.tmp.name))
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        migrate(self.conn)

    def tearDown(self):
        self.ro.close()
        self.tmp.cleanup()

    def test_ask_stores_turns_and_follow_ups_carry_history(self):
        c1 = FakeClient([text("First answer.")])
        t = ask.ask(self.conn, "  First question?  ", ro=self.ro, client=c1, model="m")
        self.assertEqual(t["title"], "First question?")
        self.assertEqual([m["role"] for m in t["messages"]], ["user", "assistant"])

        c2 = FakeClient([text("Second answer.")])
        t = ask.ask(self.conn, "And then?", t["id"], ro=self.ro, client=c2, model="m")
        sent = c2.calls[0]["messages"]
        self.assertEqual([m["content"] for m in sent], ["First question?", "First answer.", "And then?"])
        self.assertEqual(len(t["messages"]), 4)
        self.assertEqual(ask.threads(self.conn)[0]["turns"], 2)

        self.assertTrue(ask.delete_thread(self.conn, t["id"]))
        self.assertEqual(ask.threads(self.conn), [])

    def test_unknown_thread(self):
        with self.assertRaises(LookupError):
            ask.ask(self.conn, "q", 999, ro=self.ro, client=FakeClient(), model="m")


if __name__ == "__main__":
    unittest.main()
