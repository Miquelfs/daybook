"""Generic flat CSV export — all canonical columns, one row per flight."""

import csv
import io
import sqlite3


def generate_generic_csv(conn: sqlite3.Connection) -> str:
    rows = conn.execute(
        "SELECT * FROM flights ORDER BY date, off_block_utc"
    ).fetchall()

    if not rows:
        return ""

    buf = io.StringIO()
    columns = [d[0] for d in rows[0].description] if hasattr(rows[0], "description") else list(rows[0].keys())
    # sqlite3.Row doesn't expose .description; use keys()
    columns = list(rows[0].keys())
    # Drop raw_payload — too large for generic export
    columns = [c for c in columns if c != "raw_payload"]

    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(dict(r))

    return buf.getvalue()
