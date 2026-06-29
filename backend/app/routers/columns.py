from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import ColumnResponse, ColumnUpdate
from app.repositories import ColumnRepository

from app.websockets import manager

router = APIRouter(prefix="/columns", tags=["Columns"])

@router.get("/{column_id}", response_model=ColumnResponse)
def get_column(column_id: str, db: Session = Depends(get_db)):
    """
    Retrieves detailed metadata and profiling statistics for a specific column.
    """
    column = ColumnRepository(db).get_by_id(column_id)
    if not column:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Column with ID '{column_id}' not found."
        )
    return column

@router.put("/{column_id}", response_model=ColumnResponse)
async def update_column(column_id: str, column_update: ColumnUpdate, db: Session = Depends(get_db)):
    """
    Updates the business metadata (description, notes, tags, custom attributes) of a column.
    """
    column_repo = ColumnRepository(db)
    updates = column_update.model_dump(exclude_unset=True)
    
    updated_column = column_repo.update(column_id, updates)
    if not updated_column:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Column with ID '{column_id}' not found."
        )
    
    # Broadcast column update event
    await manager.broadcast({"event_type": "column_updated", "data": {"id": column_id}})
    
    return updated_column

@router.delete("/{column_id}")
async def delete_column(column_id: str, db: Session = Depends(get_db)):
    """
    Deletes a column, its metadata, and all active lineage relationships connected to it.
    """
    success = ColumnRepository(db).delete(column_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Column with ID '{column_id}' not found."
        )
    return {"status": "success", "message": f"Column '{column_id}' successfully deleted."}
