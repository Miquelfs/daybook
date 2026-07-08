import sqlite3
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from infrastructure.api.db import get_db

router = APIRouter(prefix="/contacts", tags=["contacts"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


class ContactOut(BaseModel):
    id: int
    name: str
    emoji: str | None = None
    group_: str | None = None


class ContactCreate(BaseModel):
    name: str
    emoji: str | None = None
    group_: str | None = None


class ContactPatch(BaseModel):
    name: str | None = None
    emoji: str | None = None
    group_: str | None = None


def _streaks_from_dates(all_dates: list[str], today: date) -> tuple[int, int, str | None]:
    """(current_streak, longest_streak, longest_streak_end) from a sorted date list."""
    if not all_dates:
        return 0, 0, None
    parsed = [date.fromisoformat(d) for d in all_dates]
    longest, longest_end, cur = 1, parsed[-1], 1
    for i in range(1, len(parsed)):
        if (parsed[i] - parsed[i - 1]).days == 1:
            cur += 1
            if cur > longest:
                longest, longest_end = cur, parsed[i]
        else:
            cur = 1
    current = 1
    for i in range(len(parsed) - 1, 0, -1):
        if (parsed[i] - parsed[i - 1]).days == 1:
            current += 1
        else:
            break
    if (today - parsed[-1]).days > 1:
        current = 0
    return current, longest, longest_end.isoformat()


@router.get("/grid")
def contacts_grid(conn: DB, days: int = 371):
    """
    Per-person day list over the last `days` days — feeds the same HabitKit-style
    calendar grid as tags. Mirrors /tags/grid using day_companions.
    """
    today = date.today()
    cutoff = (today - timedelta(days=days)).isoformat()

    rows = conn.execute(
        """SELECT c.id, c.name, c.emoji, c.group_
           FROM contacts c
           WHERE EXISTS (SELECT 1 FROM day_companions dc WHERE dc.contact_id = c.id AND dc.date >= ?)
           ORDER BY c.name""",
        (cutoff,),
    ).fetchall()

    out = []
    for c in rows:
        dates = [
            r["date"] for r in conn.execute(
                "SELECT date FROM day_companions WHERE contact_id=? AND date >= ? ORDER BY date",
                (c["id"], cutoff),
            ).fetchall()
        ]
        current, longest, longest_end = _streaks_from_dates(dates, today)
        out.append({
            "kind": "person",
            "id": c["id"],
            "name": c["name"],
            "icon": c["emoji"],
            "category": c["group_"],
            "color": None,
            "is_negative": False,
            "dates": dates,
            "total_days": len(dates),
            "current_streak": current,
            "longest_streak": longest,
            "longest_streak_end": longest_end,
        })

    out.sort(key=lambda r: r["total_days"], reverse=True)
    return out


@router.get("", response_model=list[ContactOut])
def list_contacts(conn: DB):
    rows = conn.execute(
        "SELECT id, name, emoji, group_ FROM contacts ORDER BY group_, name"
    ).fetchall()
    return [ContactOut(id=r["id"], name=r["name"], emoji=r["emoji"], group_=r["group_"]) for r in rows]


@router.post("", response_model=ContactOut)
def create_contact(body: ContactCreate, conn: DB):
    try:
        cur = conn.execute(
            "INSERT INTO contacts (name, emoji, group_) VALUES (?,?,?)",
            (body.name, body.emoji, body.group_),
        )
        conn.commit()
        row = conn.execute("SELECT id, name, emoji, group_ FROM contacts WHERE id=?", (cur.lastrowid,)).fetchone()
        return ContactOut(id=row["id"], name=row["name"], emoji=row["emoji"], group_=row["group_"])
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Contact '{body.name}' already exists")


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: int, body: ContactPatch, conn: DB):
    row = conn.execute("SELECT id, name, emoji, group_ FROM contacts WHERE id=?", (contact_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Contact {contact_id} not found")

    updates = body.model_dump(exclude_unset=True)
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(status_code=422, detail="Name cannot be empty")

    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        try:
            conn.execute(
                f"UPDATE contacts SET {set_clause} WHERE id=?",
                [*updates.values(), contact_id],
            )
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail=f"Contact '{updates.get('name')}' already exists")
        row = conn.execute("SELECT id, name, emoji, group_ FROM contacts WHERE id=?", (contact_id,)).fetchone()

    return ContactOut(id=row["id"], name=row["name"], emoji=row["emoji"], group_=row["group_"])


@router.delete("/{contact_id}", status_code=204)
def delete_contact(contact_id: int, conn: DB):
    conn.execute("DELETE FROM contacts WHERE id=?", (contact_id,))
    conn.commit()
