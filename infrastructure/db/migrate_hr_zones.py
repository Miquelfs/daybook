"""
Rebuild every athlete_zones.zones_json with the one zone builder (domains.training.hr_zones):
% of threshold HR when a test set one, else % of max HR. Before this the stored run table
was %-of-max while the watch got %-of-threshold targets, so a run held in the watch's
"Z2" was graded as tempo. Idempotent; runs at API startup.
"""

from domains.training import hr_zones
from infrastructure.db.connection import get_connection


def migrate(conn) -> int:
    try:
        rows = conn.execute("SELECT valid_from, sport, max_hr, threshold_hr, zones_json FROM athlete_zones").fetchall()
    except Exception:
        return 0
    n = 0
    for r in rows:
        z = hr_zones.zones_json(r[1], r[3], r[2])
        if z != r[4]:
            conn.execute("UPDATE athlete_zones SET zones_json=? WHERE valid_from=? AND sport=?", (z, r[0], r[1]))
            n += 1
    conn.commit()
    return n


if __name__ == "__main__":
    c = get_connection()
    print(f"zone tables rebuilt: {migrate(c)}")
    c.close()
