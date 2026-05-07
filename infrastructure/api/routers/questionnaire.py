from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter

from infrastructure.api.questionnaire.questions import get_questionnaire

router = APIRouter(prefix="/questionnaire", tags=["questionnaire"])

TIMEZONE = "Europe/Madrid"


@router.get("/today")
def questionnaire_today():
    today = datetime.now(ZoneInfo(TIMEZONE)).date().isoformat()
    return get_questionnaire(today)


@router.get("/{date_str}")
def questionnaire_for_date(date_str: str):
    return get_questionnaire(date_str)
