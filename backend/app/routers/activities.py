from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.schemas import ActivityLogResponse
from app.repositories import ActivityLogRepository

router = APIRouter(prefix="/activities", tags=["Activities"])

@router.get("", response_model=List[ActivityLogResponse])
def get_recent_activities(limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db)):
    """
    Retrieves a list of recent user activities on the workspace (e.g. uploads, edits, lineage creations).
    """
    return ActivityLogRepository(db).get_recent(limit)
