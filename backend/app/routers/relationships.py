from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.schemas import RelationshipResponse, RelationshipCreate, RelationshipUpdate
from app.repositories import RelationshipRepository

from app.websockets import manager

from app.routers.assets import resolve_workspace_id

router = APIRouter(prefix="/relationships", tags=["Relationships"])

@router.post("", response_model=RelationshipResponse, status_code=status.HTTP_201_CREATED)
async def create_relationship(
    relationship: RelationshipCreate,
    x_workspace_id: str = Header("Workspace 1"),
    db: Session = Depends(get_db)
):
    """
    Creates a new lineage relationship (edge) between two assets, an asset and a column, or two columns.
    Supported relationship types: DERIVES_FROM, MAPS_TO, LOOKUP_FROM, COPIED_FROM.
    """
    if relationship.source_node_type not in ("asset", "column"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_node_type must be either 'asset' or 'column'"
        )
    if relationship.destination_node_type not in ("asset", "column"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="destination_node_type must be either 'asset' or 'column'"
        )
    if relationship.relationship_type not in ("DERIVES_FROM", "MAPS_TO", "LOOKUP_FROM", "COPIED_FROM"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid relationship_type. Supported: 'DERIVES_FROM', 'MAPS_TO', 'LOOKUP_FROM', 'COPIED_FROM'"
        )

    x_workspace_id = resolve_workspace_id(x_workspace_id, db)
    rel_repo = RelationshipRepository(db)
    created_rel = rel_repo.create(
        workspace_id=x_workspace_id,
        source_node_type=relationship.source_node_type,
        source_node_id=relationship.source_node_id,
        destination_node_type=relationship.destination_node_type,
        destination_node_id=relationship.destination_node_id,
        relationship_type=relationship.relationship_type,
        metadata_json=relationship.metadata_json
    )
    
    # Broadcast relationship creation event
    await manager.broadcast({"event_type": "relationship_created", "data": {"id": created_rel.id, "workspace_id": x_workspace_id}})
    
    return created_rel

@router.get("", response_model=List[RelationshipResponse])
def list_relationships(
    x_workspace_id: str = Header("Workspace 1"),
    db: Session = Depends(get_db)
):
    """
    Retrieves all lineage relationships.
    """
    x_workspace_id = resolve_workspace_id(x_workspace_id, db)
    return RelationshipRepository(db).get_all(x_workspace_id)

@router.put("/{rel_id}", response_model=RelationshipResponse)
async def update_relationship(rel_id: str, relationship_update: RelationshipUpdate, db: Session = Depends(get_db)):
    """
    Updates the relationship type or metadata (e.g. business note or custom properties) of a lineage edge.
    """
    rel_repo = RelationshipRepository(db)
    updates = relationship_update.model_dump(exclude_unset=True)
    
    updated_rel = rel_repo.update(rel_id, updates)
    if not updated_rel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Relationship with ID '{rel_id}' not found."
        )
        
    # Broadcast relationship update event
    await manager.broadcast({"event_type": "relationship_updated", "data": {"id": rel_id, "workspace_id": updated_rel.workspace_id}})
    
    return updated_rel

@router.delete("/{rel_id}")
async def delete_relationship(rel_id: str, db: Session = Depends(get_db)):
    """
    Deletes a lineage relationship (edge) from the database.
    """
    rel_repo = RelationshipRepository(db)
    rel = rel_repo.get_by_id(rel_id)
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Relationship with ID '{rel_id}' not found."
        )
    workspace_id = rel.workspace_id
    success = rel_repo.delete(rel_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Relationship with ID '{rel_id}' not found."
        )
        
    # Broadcast relationship deletion event
    await manager.broadcast({"event_type": "relationship_deleted", "data": {"id": rel_id, "workspace_id": workspace_id}})
    
    return {"status": "success", "message": f"Relationship '{rel_id}' successfully deleted."}
