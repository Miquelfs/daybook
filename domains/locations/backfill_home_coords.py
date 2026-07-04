"""
Backfill centroid coordinates for life_periods location periods (Plan B.1).

For each category='location' period without coords, forward-geocode the label
via Nominatim and write centroid_lat/centroid_lng back. Idempotent — rows that
already have coords are skipped. Re-run whenever a new location period is added.

Usage: python -m domains.locations.backfill_home_coords
"""

import time

import requests

from infrastructure.db.connection import get_connection

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "daybook-personal/1.0"

# Labels Nominatim can't resolve — known coordinates by hand.
MANUAL_COORDS: dict[str, tuple[float, float]] = {
    "Bergamo: Grassobio": (45.6640, 9.7270),  # Grassobbio (double-b in OSM)
}


def _query_for(label: str) -> str:
    # Labels look like "Barcelona", "UK: East Midlands", "Bergamo: Grassobio" —
    # "Region: Place" reads best for Nominatim as "Place, Region".
    if ":" in label:
        region, place = (part.strip() for part in label.split(":", 1))
        return f"{place}, {region}"
    return label


def geocode(label: str) -> tuple[float, float] | None:
    resp = requests.get(
        NOMINATIM_URL,
        params={"q": _query_for(label), "format": "json", "limit": 1},
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        timeout=15,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        return None
    return float(results[0]["lat"]), float(results[0]["lon"])


def main() -> None:
    conn = get_connection()
    rows = conn.execute(
        """SELECT id, label FROM life_periods
           WHERE category = 'location' AND (centroid_lat IS NULL OR centroid_lng IS NULL)"""
    ).fetchall()

    if not rows:
        print("all location periods already have coordinates.")
        return

    for row in rows:
        if row["label"] in MANUAL_COORDS:
            coords = MANUAL_COORDS[row["label"]]
            conn.execute(
                "UPDATE life_periods SET centroid_lat=?, centroid_lng=? WHERE id=?",
                (coords[0], coords[1], row["id"]),
            )
            conn.commit()
            print(f"  ✓ {row['label']} → {coords[0]:.4f}, {coords[1]:.4f} (manual)")
            continue
        try:
            coords = geocode(row["label"])
        except requests.RequestException as e:
            print(f"  ✗ {row['label']}: {e}")
            continue
        if coords is None:
            print(f"  ✗ {row['label']}: no geocode result — set coords manually")
        else:
            conn.execute(
                "UPDATE life_periods SET centroid_lat=?, centroid_lng=? WHERE id=?",
                (coords[0], coords[1], row["id"]),
            )
            conn.commit()
            print(f"  ✓ {row['label']} → {coords[0]:.4f}, {coords[1]:.4f}")
        time.sleep(1.1)  # Nominatim rate limit

    conn.close()


if __name__ == "__main__":
    main()
