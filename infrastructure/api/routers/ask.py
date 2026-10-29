"""
Ask — free-form questions about your own data, answered by Claude over read-only SQL.

POST   /ask                  — {question, thread_id?} → the thread with the new answer
GET    /ask/threads          — past conversations, newest first
GET    /ask/threads/{id}     — one conversation with its messages and the SQL behind each answer
DELETE /ask/threads/{id}
"""

import logging
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response

from domains.ai import ask as ask_domain
from infrastructure.api.db import get_db
from infrastructure.api.models.ask import AskIn

log = logging.getLogger(__name__)
router = APIRouter(prefix="/ask", tags=["ask"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


@router.post("")
def ask(body: AskIn, conn: DB):
    try:
        return ask_domain.ask(conn, body.question, body.thread_id)
    except LookupError:
        raise HTTPException(404, "thread not found")
    except RuntimeError as e:                       # no API key / SDK
        raise HTTPException(503, str(e))
    except Exception as e:                          # Claude unreachable, rate limit…
        log.warning("ask failed: %s", e)
        raise HTTPException(502, f"Couldn't reach Claude: {e}")


@router.get("/threads")
def list_threads(conn: DB):
    return ask_domain.threads(conn)


@router.get("/threads/{thread_id}")
def get_thread(thread_id: int, conn: DB):
    t = ask_domain.thread(conn, thread_id)
    if t is None:
        raise HTTPException(404, "not found")
    return t


@router.delete("/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: int, conn: DB):
    if not ask_domain.delete_thread(conn, thread_id):
        raise HTTPException(404, "not found")
    return Response(status_code=204)
