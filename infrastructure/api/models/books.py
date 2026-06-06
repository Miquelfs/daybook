from datetime import date as _date
from typing import Optional
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str
    author: str
    date_finished: Optional[str] = Field(
        default=None,
        description="YYYY-MM-DD. NULL = currently reading or wishlist.",
    )
    genre: Optional[str] = None
    language: Optional[str] = None
    location: Optional[str] = None
    ownership: Optional[str] = None   # 'own' | 'kindle' | 'library'
    pages: Optional[int] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None
    gift_from: Optional[str] = None


class BookPatch(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    date_finished: Optional[str] = None
    genre: Optional[str] = None
    language: Optional[str] = None
    location: Optional[str] = None
    ownership: Optional[str] = None
    pages: Optional[int] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None
    gift_from: Optional[str] = None
    cover_url: Optional[str] = None


class BookOut(BaseModel):
    id: int
    title: str
    author: str
    date_finished: Optional[str]
    genre: Optional[str]
    language: Optional[str]
    location: Optional[str]
    ownership: Optional[str]
    pages: Optional[int]
    rating: Optional[int]
    notes: Optional[str]
    gift_from: Optional[str]
    cover_url: Optional[str]
    created_at: str
    updated_at: str


class BooksStats(BaseModel):
    books_per_year: dict
    pages_per_year: dict
    books_per_month: dict   # {YYYY-MM: count} for the requested year (or current year)
    genre_breakdown: dict
    language_breakdown: dict
    top_authors: list
    current_year: dict
    reading_pace: dict
