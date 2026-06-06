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


@router.delete("/{contact_id}", status_code=204)
def delete_contact(contact_id: int, conn: DB):
    conn.execute("DELETE FROM contacts WHERE id=?", (contact_id,))
    conn.commit()
