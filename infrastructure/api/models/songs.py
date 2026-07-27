from typing import Optional
from pydantic import BaseModel, Field


class SongIn(BaseModel):
    date: str = Field(description="YYYY-MM-DD — the day this song accompanied me")
    title: str
    artist: Optional[str] = None
    album: Optional[str] = None
    url: Optional[str] = None          # YouTube Music (or any) link
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    mood: Optional[str] = None
    notes: Optional[str] = None


class SongPatch(BaseModel):
    date: Optional[str] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    url: Optional[str] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    mood: Optional[str] = None
    notes: Optional[str] = None


class SongOut(BaseModel):
    id: int
    date: str
    title: str
    artist: Optional[str]
    album: Optional[str]
    url: Optional[str]
    rating: Optional[int]
    mood: Optional[str]
    notes: Optional[str]
    created_at: str
    updated_at: str


class SongsStats(BaseModel):
    songs_per_year: dict          # {YYYY: count}
    songs_per_month: dict         # {YYYY-MM: count} for the requested/current year
    top_artists: list             # [{artist, songs}]
    current_year: dict            # {year, songs, distinct_artists, days_covered, with_links}
    total_songs: int
    total_with_links: int
