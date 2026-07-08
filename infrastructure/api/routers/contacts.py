import sqlite3
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
