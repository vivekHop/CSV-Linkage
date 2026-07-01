from fastapi import APIRouter, Depends, Query, Header, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import SearchResponse
from app.repositories import SearchRepository

router = APIRouter(prefix="/search", tags=["Search"])

@router.get("", response_model=SearchResponse)
def search_metadata(
    q: str = Query(..., min_length=1),
    x_workspace_id: str = Header("Workspace 1"),
    db: Session = Depends(get_db)
):
    """
    Searches assets and columns by name, description, tags, business notes, and owners.
    Returns matching nodes and columns with parent references to focus them on the canvas.
    """
    search_repo = SearchRepository(db)
    results = search_repo.search(x_workspace_id, q)
    return {
        "query": q,
        "results": results
    }
