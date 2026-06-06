"""
Import books from a CSV export into daybook.db.

CSV columns (Catalan headers):
  Títol, Autor, Comentari, Data Llegit, Gènere, Idioma, Localització,
  Ownership, Pàgines, Rating (⭐ chars), Regal

Usage:
  python -m domains.books.books_import --csv path/to/library.csv [--covers]
  python -m domains.books.books_import --csv path/to/library.csv --restore-covers path/to/book_covers.json
"""

import argparse
import csv
import io
import json
import time
from datetime import datetime
from pathlib import Path

from infrastructure.db.connection import get_connection
from domains.books.cover_fetch import fetch_cover_url

OWNERSHIP_MAP = {
    "propi": "own",
    "kindle": "kindle",
    "biblioteca": "library",
}


def _parse_date(raw: str) -> str | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_rating(raw: str) -> int | None:
    count = raw.count("⭐")
    return count if count > 0 else None


def _parse_ownership(raw: str) -> str:
    return OWNERSHIP_MAP.get(raw.strip().lower(), raw.strip().lower())


def import_csv(csv_path: str, fetch_covers: bool = False) -> int:
    text = Path(csv_path).read_bytes().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    conn = get_connection()
    imported = 0

    for row in reader:
        title      = row["Títol"].strip()
        author     = row["Autor"].strip()
        notes      = row["Comentari"].strip() or None
        date_fin   = _parse_date(row["Data Llegit"])
        genre      = row["Gènere"].strip() or None
        language   = row["Idioma"].strip() or None
        location   = row["Localització"].strip() or None
        ownership  = _parse_ownership(row["Ownership"])
        pages_raw  = row["Pàgines"].strip()
        pages      = int(pages_raw) if pages_raw.isdigit() else None
        rating     = _parse_rating(row["Rating"])
        gift_raw   = row["Regal"].strip()
        gift_from  = gift_raw if gift_raw.upper() != "NO" else None

        cover_url = None
        if fetch_covers:
            cover_url = fetch_cover_url(title, author)
            time.sleep(0.1)

        existing = conn.execute(
            "SELECT id FROM books WHERE title = ? AND author = ?",
            (title, author),
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE books SET
                    date_finished=?, genre=?, language=?, location=?, ownership=?,
                    pages=?, rating=?, notes=?, gift_from=?,
                    cover_url=COALESCE(?, cover_url),
                    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE id=?""",
                (date_fin, genre, language, location, ownership,
                 pages, rating, notes, gift_from, cover_url, existing["id"]),
            )
        else:
            conn.execute(
                """INSERT INTO books
                    (title, author, date_finished, genre, language, location,
                     ownership, pages, rating, notes, gift_from, cover_url)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (title, author, date_fin, genre, language, location,
                 ownership, pages, rating, notes, gift_from, cover_url),
            )
            imported += 1

    conn.commit()
    conn.close()
    return imported


def restore_covers(covers_json_path: str) -> int:
    """Apply pre-fetched cover URLs from a JSON dump (title+author keyed)."""
    data = json.loads(Path(covers_json_path).read_bytes())
    conn = get_connection()
    updated = 0
    for entry in data:
        cur = conn.execute(
            """UPDATE books SET cover_url=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE title=? AND author=? AND cover_url IS NULL""",
            (entry["cover_url"], entry["title"], entry["author"]),
        )
        if cur.rowcount:
            updated += 1
    conn.commit()
    conn.close()
    return updated


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import books CSV into daybook.db")
    parser.add_argument("--csv", required=True, help="Path to the CSV file")
    parser.add_argument(
        "--covers", action="store_true",
        help="Fetch cover URLs from Open Library (one request per book)",
    )
    parser.add_argument(
        "--restore-covers", metavar="JSON",
        help="Path to book_covers.json — apply pre-fetched URLs without hitting the API",
    )
    args = parser.parse_args()

    n = import_csv(args.csv, fetch_covers=args.covers)
    print(f"Imported {n} new books.")

    if args.restore_covers:
        r = restore_covers(args.restore_covers)
        print(f"Restored {r} cover URLs from {args.restore_covers}.")
