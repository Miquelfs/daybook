"""Add tennis journal tables: tennis_session + tennis_session_player.

One tennis_session row per tennis activity (keyed on activity_id). A session is
either a match (result / score / opponents) or a training (a coach + what you
worked on). Players (partners / opponents / coach) reference the shared contacts
table so head-to-head and "who I train with" records can be computed later.
"""

from pathlib import Path
import sys

_REPO = Path(__file__).parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from infrastructure.db.connection import get_connection


def migrate():
    conn = get_connection()

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS tennis_session (
            activity_id     TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
            session_type    TEXT NOT NULL DEFAULT 'match',  -- 'match' | 'training'
            format          TEXT,      -- 'singles' | 'doubles' (matches)
            result          TEXT,      -- 'win' | 'loss' | 'draw' (matches)
            score           TEXT,      -- free text, e.g. "6-4 3-6 7-5" (matches)
            surface         TEXT,      -- 'hard' | 'clay' | 'grass' | 'indoor' | NULL
            focus           TEXT,      -- what you worked on (trainings), e.g. "serve, backhand slice"
            coaching_notes  TEXT,      -- tips / takeaways, separate from user_notes
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS tennis_session_player (
            activity_id TEXT    NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
            contact_id  INTEGER NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
            role        TEXT    NOT NULL,   -- 'partner' | 'opponent' | 'coach'
            PRIMARY KEY (activity_id, contact_id, role)
        );

        CREATE INDEX IF NOT EXISTS idx_tennis_session_player_activity
            ON tennis_session_player(activity_id);
        CREATE INDEX IF NOT EXISTS idx_tennis_session_player_contact
            ON tennis_session_player(contact_id);
        """
    )

    conn.commit()
    conn.close()
    print("Migration done — tennis_session + tennis_session_player ready.")


if __name__ == "__main__":
    migrate()
