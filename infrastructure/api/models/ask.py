from __future__ import annotations

from pydantic import BaseModel, Field


class AskIn(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)
    thread_id: int | None = None           # follow-up in an existing conversation
