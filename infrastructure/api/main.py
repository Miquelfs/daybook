"""
Daybook FastAPI backend.
Local only — binds to 127.0.0.1:8000. Never expose to LAN without Tailscale.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from infrastructure.api.routers import days, insights, questionnaire

VERSION = "0.1.0"

app = FastAPI(
    title="Daybook API",
    version=VERSION,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "PATCH"],
    allow_headers=["*"],
)

app.include_router(days.router)
app.include_router(insights.router)
app.include_router(questionnaire.router)


@app.get("/")
def root():
    return {
        "service": "daybook-api",
        "version": VERSION,
        "status": "ok",
        "docs": "/docs",
    }
