from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from datetime import datetime
from app.database import get_db
from app.schemas import AssetResponse, AssetUpdate, VersionHistoryResponse, AssetCreate, WorkspaceSync
from app.models import Asset, ColumnModel, RelationshipModel
from app.repositories import AssetRepository, ColumnRepository
from app.profiler import profile_file

from app.websockets import manager

router = APIRouter(prefix="/assets", tags=["Assets"])

@router.post("/upload", response_model=List[AssetResponse], status_code=status.HTTP_201_CREATED)
async def upload_spreadsheet_files(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    """
    Uploads and profiles one or more spreadsheets (CSV, Excel, TSV, ODS).
    If a file contains multiple sheets (like Excel), profiles and creates a separate table for each sheet.
    The raw data is processed in-memory and discarded; only the metadata is stored.
    """
    asset_repo = AssetRepository(db)
    column_repo = ColumnRepository(db)
    created_assets = []

    allowed_extensions = (".csv", ".tsv", ".txt", ".xlsx", ".xls", ".xlsm", ".ods")

    for file in files:
        if not file.filename.lower().endswith(allowed_extensions):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File '{file.filename}' is not a supported spreadsheet format."
            )
        
        try:
            # Read file bytes in-memory
            file_bytes = await file.read()
            
            # Profile the spreadsheet file (returns a list of sheet profiles)
            profiled_sheets = profile_file(file_bytes, file.filename)
            
            for asset_data, columns_data in profiled_sheets:
                # Save Asset
                asset = asset_repo.create(
                    name=asset_data["name"],
                    asset_type=asset_data["asset_type"],
                    row_count=asset_data["row_count"],
                    column_count=asset_data["column_count"],
                    file_size=asset_data["file_size"],
                    description=asset_data["description"],
                    owner=asset_data["owner"],
                    notes=asset_data["notes"],
                    tags=asset_data["tags"],
                    custom_attributes=asset_data["custom_attributes"]
                )
                
                # Save Columns
                for col_data in columns_data:
                    column_repo.create(asset.id, col_data)
                    
                # Fetch complete asset with columns populated
                db_asset = asset_repo.get_by_id(asset.id)
                created_assets.append(db_asset)
            
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to profile and import '{file.filename}': {str(e)}"
            )
            
    # Broadcast upload events
    for asset in created_assets:
        await manager.broadcast({"event_type": "asset_created", "data": {"id": asset.id}})

    return created_assets

@router.post("", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(asset: AssetCreate, db: Session = Depends(get_db)):
    """
    Creates a new asset and its columns directly from a metadata payload.
    Used for canvas duplicating, copy-pasting, and grouping.
    """
    asset_repo = AssetRepository(db)
    column_repo = ColumnRepository(db)
    
    created_asset = asset_repo.create(
        name=asset.name,
        asset_type=asset.asset_type,
        row_count=asset.row_count,
        column_count=asset.column_count,
        file_size=asset.file_size,
        description=asset.description or "",
        owner=asset.owner or "",
        notes=asset.notes or "",
        tags=asset.tags or [],
        custom_attributes=asset.custom_attributes or {}
    )
    
    for col in asset.columns:
        column_repo.create(created_asset.id, {
            "name": col.name,
            "datatype": col.datatype,
            "nullable_percentage": col.nullable_percentage,
            "distinct_count": col.distinct_count,
            "duplicate_count": col.duplicate_count,
            "min": col.min,
            "max": col.max,
            "mean": col.mean,
            "median": col.median,
            "sample_values": col.sample_values,
            "description": col.description or "",
            "notes": col.notes or "",
            "tags": col.tags or [],
            "custom_attributes": col.custom_attributes or {}
        })
        
    db_asset = asset_repo.get_by_id(created_asset.id)
    await manager.broadcast({"event_type": "asset_created", "data": {"id": db_asset.id}})
    return db_asset

@router.get("", response_model=List[AssetResponse])
def list_assets(db: Session = Depends(get_db)):
    """
    Retrieves all metadata assets (CSV files).
    """
    return AssetRepository(db).get_all()

@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: str, db: Session = Depends(get_db)):
    """
    Retrieves detailed metadata for a specific asset.
    """
    asset = AssetRepository(db).get_by_id(asset_id)
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset with ID '{asset_id}' not found."
        )
    return asset

@router.put("/{asset_id}", response_model=AssetResponse)
async def update_asset(asset_id: str, asset_update: AssetUpdate, db: Session = Depends(get_db)):
    """
    Updates the business metadata (name, description, owner, notes, tags, custom attributes) for an asset.
    Increments the version counter and stores a snapshot in version history.
    """
    asset_repo = AssetRepository(db)
    # Filter out None values to perform partial updates
    updates = asset_update.model_dump(exclude_unset=True)
    
    updated_asset = asset_repo.update(asset_id, updates)
    if not updated_asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset with ID '{asset_id}' not found."
        )
    
    # Broadcast asset update event
    await manager.broadcast({"event_type": "asset_updated", "data": {"id": asset_id}})
    
    return updated_asset

@router.delete("/{asset_id}")
async def delete_asset(asset_id: str, db: Session = Depends(get_db)):
    """
    Deletes an asset, its columns, its version history, and all active lineage relationships connected to it.
    """
    success = AssetRepository(db).delete(asset_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset with ID '{asset_id}' not found."
        )
    
    # Broadcast asset deletion event
    await manager.broadcast({"event_type": "asset_deleted", "data": {"id": asset_id}})
    
    return {"status": "success", "message": f"Asset '{asset_id}' successfully deleted."}

@router.get("/{asset_id}/history", response_model=List[VersionHistoryResponse])
def get_asset_history(asset_id: str, db: Session = Depends(get_db)):
    """
    Retrieves the version history and change logs for a specific asset.
    """
    asset_repo = AssetRepository(db)
    asset = asset_repo.get_by_id(asset_id)
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset with ID '{asset_id}' not found."
        )
    return asset_repo.get_version_history(asset_id)

@router.post("/sync")
async def sync_workspace(payload: WorkspaceSync, db: Session = Depends(get_db)):
    """
    Overwrites the current workspace state (assets, columns, relationships) in a single transaction.
    Used for instant session-wide Undo/Redo.
    """
    try:
        # Delete existing data in reverse order of foreign key dependencies
        db.query(RelationshipModel).delete()
        db.query(ColumnModel).delete()
        db.query(Asset).delete()
        db.commit()

        # Insert assets and columns
        for a in payload.assets:
            db_asset = Asset(
                id=a.id,
                name=a.name,
                asset_type=a.asset_type,
                description=a.description or "",
                owner=a.owner or "",
                version=a.version,
                row_count=a.row_count,
                column_count=a.column_count,
                file_size=a.file_size,
                notes=a.notes or "",
                tags=a.tags or [],
                custom_attributes=a.custom_attributes or {},
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(db_asset)
            db.commit() # commit so columns are referenceable

            for c in a.columns:
                db_col = ColumnModel(
                    id=c.id,
                    asset_id=db_asset.id,
                    name=c.name,
                    datatype=c.datatype,
                    nullable_percentage=c.nullable_percentage,
                    distinct_count=c.distinct_count,
                    duplicate_count=c.duplicate_count,
                    min=c.min,
                    max=c.max,
                    mean=c.mean,
                    median=c.median,
                    sample_values=c.sample_values or [],
                    description=c.description or "",
                    notes=c.notes or "",
                    tags=c.tags or [],
                    custom_attributes=c.custom_attributes or {},
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(db_col)
            db.commit()

        # Insert relationships
        for r in payload.relationships:
            db_rel = RelationshipModel(
                id=r.id,
                source_node_type=r.source_node_type,
                source_node_id=r.source_node_id,
                destination_node_type=r.destination_node_type,
                destination_node_id=r.destination_node_id,
                relationship_type=r.relationship_type,
                metadata_json=r.metadata_json or {},
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(db_rel)
        db.commit()

        # Broadcast sync event
        await manager.broadcast({"event_type": "workspace_synced", "data": {}})
        return {"status": "success", "message": "Workspace synced successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Workspace sync failed: {str(e)}"
        )
