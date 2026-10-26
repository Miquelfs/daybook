"""
Run cues used to store a pace ("conversational, ~5:48/km"), frozen at the threshold
the plan was built with. Now cues carry no zone pace (the card / watch show it live)
and race pace is a {pace:race:<type>} token rendered from today's threshold. This
rewrites the sessions still to come. Idempotent; runs at API startup.
"""

import json

from domains.training.b_race import _STORED_PACE, race_token, strip_stored_pace
from infrastructure.db.connection import get_connection

RACE_LABELS = ("Race", "First 5 km")


def _is_race_step(st: dict) -> bool:
    label = st.get("label") or ""
    return "race pace" in label.lower() or label in RACE_LABELS


def _race_type(conn, goal_id: int, on: str) -> str:
    try:
        r = conn.execute("SELECT race_type FROM b_races WHERE goal_id=? AND race_date >= ? ORDER BY race_date LIMIT 1",
                         (goal_id, on)).fetchone() or \
            conn.execute("SELECT race_type FROM b_races WHERE goal_id=? ORDER BY race_date DESC LIMIT 1",
                         (goal_id,)).fetchone()
    except Exception:
        r = None
    return r[0] if r else "half_marathon"


def rewrite(structure: list, race_type: str) -> list:
    out = []
    for st in structure:
        cue = st.get("cue")
        if cue and _STORED_PACE.search(cue):
            if _is_race_step(st):
                tok = race_token(race_type)
                cue = _STORED_PACE.sub(lambda m: ("~" if m.group(0).startswith("~") else "") + tok, cue)
            else:
                cue = strip_stored_pace(cue)
            st = {k: v for k, v in st.items() if k != "cue"} | ({"cue": cue} if cue else {})
        out.append(st)
    return out


def migrate(conn) -> int:
    try:
        rows = conn.execute("SELECT id, goal_id, session_date, structure_json FROM plan_sessions "
                            "WHERE status='pending' AND structure_json LIKE '%/km%'").fetchall()
    except Exception:
        return 0
    n = 0
    for r in rows:
        try:
            structure = json.loads(r[3])
        except ValueError:
            continue
        new = rewrite(structure, _race_type(conn, r[1], r[2]))
        if new != structure:
            conn.execute("UPDATE plan_sessions SET structure_json=? WHERE id=?", (json.dumps(new), r[0]))
            n += 1
    conn.commit()
    return n


if __name__ == "__main__":
    c = get_connection()
    print(f"sessions rewritten: {migrate(c)}")
    c.close()
