"""
Import restaurant records from two Notion CSV exports into daybook.db.

Sources:
  --notion   Restaurants...csv   (Catalan/Spanish Notion export, 2022-2023 data)
                Columns: Name, Dia, Acompanyant, Ciutat, País, Google Maps, Puntuació, Tipus, Viatge
  --alice    "Places with Alice...csv"  (2025-2026 data with Alice)
                Columns: Name, Cuisine Type, Location, Date, Rating AD, Rating MF

Usage (run from repo root):
  python -m domains.restaurants.import_csv --notion "path/to/Restaurants...csv"
  python -m domains.restaurants.import_csv --alice  "path/to/Places with Alice...csv"
  python -m domains.restaurants.import_csv --notion "..." --alice "..."
"""

import argparse
import csv
import io
import re
from datetime import datetime
from pathlib import Path

from infrastructure.db.connection import get_connection

# ISO-2/3 country codes + partial names → English country names
_COUNTRY_MAP: dict[str, str] = {
    "ES": "Spain", "E": "Spain",
    "FR": "France",
    "DE": "Germany",
    "IT": "Italy",
    "PT": "Portugal",
    "NL": "Netherlands",
    "BE": "Belgium",
    "LU": "Luxembourg", "LUX": "Luxembourg",
    "CH": "Switzerland",
    "AT": "Austria",
    "GB": "United Kingdom", "UK": "United Kingdom",
    "NO": "Norway",
    "SE": "Sweden",
    "DK": "Denmark",
    "US": "United States",
    "JP": "Japan",
    "TH": "Thailand",
    "MA": "Morocco",
    "AE": "United Arab Emirates",
    "QA": "Qatar",
}

# Catalan/Spanish cuisine type → normalised English
_CUISINE_MAP: dict[str, str] = {
    "asiàtic": "Asian",
    "asiatic": "Asian",
    "italià": "Italian",
    "italia": "Italian",
    "japonés": "Japanese",
    "japones": "Japanese",
    "japonès": "Japanese",
    "japonese": "Japanese",
    "sushi": "Sushi",
    "tapas": "Tapas",
    "fast food": "Fast Food",
    "bar": "Bar/Tapas",
    "francès": "French",
    "frances": "French",
    "grec": "Greek",
    "portugues": "Portuguese",
    "portuguès": "Portuguese",
    "àrab": "Middle Eastern",
    "arab": "Middle Eastern",
    "mexicà": "Mexican",
    "mexica": "Mexican",
    "indio": "Indian",
    "indi": "Indian",
    "català": "Catalan",
    "catala": "Catalan",
    "espagnol": "Spanish",
    "espanyol": "Spanish",
    "pizza": "Pizza",
    "vegetarià": "Vegetarian",
    "vegetaria": "Vegetarian",
    "peruvià": "Peruvian",
    "peruvia": "Peruvian",
    "brunch": "Brunch",
    "breakfast": "Breakfast",
    "burger": "Burger",
    "ramen": "Ramen",
}


def _norm_cuisine(raw: str | None) -> str | None:
    if not raw:
        return None
    return _CUISINE_MAP.get(raw.strip().lower(), raw.strip().title())


def _norm_country(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    return _COUNTRY_MAP.get(raw.upper(), raw.title() if len(raw) <= 3 else raw)


def _parse_date_notion(raw: str) -> str | None:
    """Parse 'March 22, 2023' → '2023-03-22'."""
    raw = raw.strip()
    if not raw:
        return None
    for fmt in ("%B %d, %Y", "%B %Y"):
        try:
            d = datetime.strptime(raw, fmt)
            return d.strftime("%Y-%m-%d") if "%d" in fmt else f"{d.year}-{d.month:02d}-01"
        except ValueError:
            pass
    return None


def _parse_date_alice(raw: str) -> str | None:
    """Parse 'DD/MM/YYYY' → 'YYYY-MM-DD'."""
    raw = raw.strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _extract_trip_context(raw: str) -> str | None:
    """Extract the readable trip name from a Notion internal link like 'Paris (https://...)'."""
    if not raw:
        return None
    # Match "Some Text (https://...)" — keep just the text part
    m = re.match(r"^([^(]+)\s*\(https?://", raw)
    if m:
        return m.group(1).strip()
    return raw.strip() if raw.strip() else None


def _split_location(raw: str) -> tuple[str | None, str | None]:
    """Split 'neighbourhood, City' or just 'City' into (city, neighbourhood_hint)."""
    if not raw:
        return None, None
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) >= 2:
        # Last part is the city; all others are neighbourhood/district
        city = parts[-1]
        return city, ", ".join(parts[:-1])
    return parts[0], None


def _ensure_table(conn) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS restaurants (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            date_visited    TEXT,
            city            TEXT,
            country         TEXT,
            cuisine         TEXT,
            rating_mf       INTEGER,
            rating_ad       INTEGER,
            companions      TEXT,
            google_maps_url TEXT,
            notes           TEXT,
            trip_context    TEXT,
            source          TEXT,
            created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
    """)
    conn.commit()


def import_notion_csv(csv_path: str) -> int:
    text = Path(csv_path).read_bytes().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    conn = get_connection()
    _ensure_table(conn)
    imported = updated = 0

    for row in reader:
        name = row.get("Name", "").strip()
        if not name:
            continue

        date_visited = _parse_date_notion(row.get("Dia", ""))
        companions = row.get("Acompanyant", "").strip() or None
        if companions and companions.lower() in ("none", "cap", ""):
            companions = None
        city = row.get("Ciutat", "").strip() or None
        if city:
            city = city.strip()
        country = _norm_country(row.get("País", ""))
        google_maps_url = row.get("Google Maps", "").strip() or None
        rating_raw = row.get("Puntuació", "").strip()
        # Notion CSV ratings are /5 — store as /10 to match the Alice CSV scale
        rating_mf = int(rating_raw) * 2 if rating_raw.isdigit() else None
        cuisine = _norm_cuisine(row.get("Tipus", ""))
        trip_context = _extract_trip_context(row.get("Viatge", ""))

        existing = conn.execute(
            "SELECT id FROM restaurants WHERE name=? AND (date_visited=? OR (date_visited IS NULL AND ? IS NULL))",
            (name, date_visited, date_visited),
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE restaurants SET
                    city=COALESCE(?,city), country=COALESCE(?,country),
                    cuisine=COALESCE(?,cuisine), rating_mf=COALESCE(?,rating_mf),
                    companions=COALESCE(?,companions), google_maps_url=COALESCE(?,google_maps_url),
                    trip_context=COALESCE(?,trip_context),
                    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE id=?""",
                (city, country, cuisine, rating_mf, companions, google_maps_url,
                 trip_context, existing["id"]),
            )
            updated += 1
        else:
            conn.execute(
                """INSERT INTO restaurants
                    (name, date_visited, city, country, cuisine,
                     rating_mf, companions, google_maps_url, trip_context, source)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (name, date_visited, city, country, cuisine,
                 rating_mf, companions, google_maps_url, trip_context, "notion_restaurants"),
            )
            imported += 1

    conn.commit()
    conn.close()
    print(f"  notion_restaurants: {imported} inserted, {updated} updated")
    return imported


def import_alice_csv(csv_path: str) -> int:
    text = Path(csv_path).read_bytes().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    conn = get_connection()
    _ensure_table(conn)
    imported = updated = 0

    for row in reader:
        name = row.get("Name", "").strip()
        if not name:
            continue

        cuisine = _norm_cuisine(row.get("Cuisine Type", ""))
        location_raw = row.get("Location", "").strip()
        city, _ = _split_location(location_raw)
        date_visited = _parse_date_alice(row.get("Date", ""))
        rating_ad_raw = row.get("Rating AD", "").strip()
        rating_mf_raw = row.get("Rating MF", "").strip()
        rating_ad = int(rating_ad_raw) if rating_ad_raw.isdigit() else None
        rating_mf = int(rating_mf_raw) if rating_mf_raw.isdigit() else None

        # Infer country from known cities
        country = None
        if city:
            city_lower = city.lower()
            if any(c in city_lower for c in ("barcelona", "palma", "mallorca", "madrid", "tenerife", "cervera", "sarrià", "sitges", "la laguna", "sant salvador", "gràcia")):
                country = "Spain"
            elif "luxembourg" in city_lower:
                country = "Luxembourg"
            elif "paris" in city_lower:
                country = "France"
            elif "london" in city_lower:
                country = "United Kingdom"

        existing = conn.execute(
            "SELECT id FROM restaurants WHERE name=? AND date_visited=?",
            (name, date_visited),
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE restaurants SET
                    cuisine=COALESCE(?,cuisine), city=COALESCE(?,city),
                    country=COALESCE(?,country),
                    rating_ad=?, rating_mf=COALESCE(?,rating_mf),
                    source=CASE WHEN source='notion_restaurants' THEN 'notion_both' ELSE 'notion_alice' END,
                    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE id=?""",
                (cuisine, city, country, rating_ad, rating_mf, existing["id"]),
            )
            updated += 1
        else:
            conn.execute(
                """INSERT INTO restaurants
                    (name, date_visited, city, country, cuisine,
                     rating_mf, rating_ad, source)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (name, date_visited, city, country, cuisine,
                 rating_mf, rating_ad, "notion_alice"),
            )
            imported += 1

    conn.commit()
    conn.close()
    print(f"  notion_alice: {imported} inserted, {updated} updated")
    return imported


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import restaurant CSVs into daybook.db")
    parser.add_argument("--notion", metavar="CSV", help="Path to Notion Restaurants CSV")
    parser.add_argument("--alice", metavar="CSV", help="Path to 'Places with Alice' CSV")
    args = parser.parse_args()

    if not args.notion and not args.alice:
        parser.error("Provide at least one of --notion or --alice")

    total = 0
    if args.notion:
        total += import_notion_csv(args.notion)
    if args.alice:
        total += import_alice_csv(args.alice)

    print(f"Done. Total new records: {total}")
