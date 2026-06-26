from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import SearchResponse
from app.repositories import SearchRepository

router = APIRouter(prefix="/search", tags=["Search"])

@router.get("", response_model=SearchResponse)
def search_metadata(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """
    Searches assets and columns by name, description, tags, business notes, and owners.
    Returns matching nodes and columns with parent references to focus them on the canvas.
    """
    search_repo = SearchRepository(db)
    results = search_repo.search(q)
    return {
        "query": q,
        "results": results
    }
