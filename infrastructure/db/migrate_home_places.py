"""
Named home locations (daybook.db).

Replaces the single implicit "Casa" (derived from one Google-Timeline Home
tag) with a small table of every place the user has called home, each with a
precise anchor + tight radius, so GPS jitter around each house collapses to
that house's name ("Casa Mallorca", "Casa Barcelona Pares", ...) instead of
a scatter of neighbouring-street names — and homes never get mixed, since
every point is checked against *all* homes regardless of the active period.

Seed anchors are derived from night-time GPS clusters over each home's
life_period, or geocoded from a known address. They're rough — the intent is
that the user nudges them (a future edit endpoint) or tells Claude a better
address. Run once: python -m infrastructure.db.migrate_home_places
"""

from infrastructure.db.connection import get_connection

_SEEDS = [
    # label,                 lat,         lng,         radius_m, note
    ("Casa Mallorca",         39.5701693,   2.6427381,  70, "Carrer de les Corralasses 11, Palma (geocoded)"),
    ("Casa Barcelona Pares",  41.387450,    2.146250,   70, "family home (GPS cluster 2014-2024)"),
    ("Casa Alice Barcelona",  41.385500,    2.180400,   70, "Carrer dels Mercaders 18, El Born (approx — adjust)"),
    ("Casa Tenerife",         28.040171,  -16.616018,   90, "Las Chafiras area (night GPS cluster)"),
    ("Casa Grassobio",        45.658200,    9.726300,   90, "Grassobbio, Bergamo (night GPS cluster)"),
    ("Casa Orio al Serio",    45.674090,    9.687005,   90, "Orio al Serio, Bergamo (night GPS cluster)"),
    ("Casa Oslo",             60.185300,   11.063800,   90, "near Gardermoen (night GPS cluster)"),
]


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS home_places (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            label      TEXT NOT NULL UNIQUE,
            lat        REAL NOT NULL,
            lng        REAL NOT NULL,
            radius_m   INTEGER NOT NULL DEFAULT 70,
            note       TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    for label, lat, lng, radius_m, note in _SEEDS:
        conn.execute(
            "INSERT OR IGNORE INTO home_places (label, lat, lng, radius_m, note) VALUES (?,?,?,?,?)",
            (label, lat, lng, radius_m, note),
        )
    conn.commit()
    print(f"home_places ready ({len(_SEEDS)} seeds ensured).")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
