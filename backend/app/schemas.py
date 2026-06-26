from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime

# --- Column Schemas ---
class ColumnBase(BaseModel):
    name: str
    datatype: str
    nullable_percentage: Optional[float] = None
    distinct_count: Optional[int] = None
    duplicate_count: Optional[int] = None
    min: Optional[str] = None
    max: Optional[str] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    sample_values: Optional[List[Any]] = Field(default_factory=list)
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = Field(default_factory=list)
    custom_attributes: Optional[Dict[str, Any]] = Field(default_factory=dict)

class ColumnCreate(ColumnBase):
    pass

class ColumnUpdate(BaseModel):
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    custom_attributes: Optional[Dict[str, Any]] = None

class ColumnResponse(ColumnBase):
    id: str
    asset_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Asset Schemas ---
class AssetBase(BaseModel):
    name: str
    asset_type: str = "csv"
    description: Optional[str] = None
    owner: Optional[str] = None
    version: int = 1
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    file_size: Optional[int] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = Field(default_factory=list)
    custom_attributes: Optional[Dict[str, Any]] = Field(default_factory=dict)

class AssetCreate(AssetBase):
    columns: List[ColumnCreate] = Field(default_factory=list)

class AssetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    owner: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    custom_attributes: Optional[Dict[str, Any]] = None

class AssetResponse(AssetBase):
    id: str
    created_at: datetime
    updated_at: datetime
    columns: List[ColumnResponse] = []

    class Config:
        from_attributes = True


# --- Relationship (Lineage) Schemas ---
class RelationshipBase(BaseModel):
    source_node_type: str  # 'asset' or 'column'
    source_node_id: str
    destination_node_type: str  # 'asset' or 'column'
    destination_node_id: str
    relationship_type: str  # 'DERIVES_FROM', 'MAPS_TO', 'LOOKUP_FROM', 'COPIED_FROM'
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)

class RelationshipCreate(RelationshipBase):
    pass

class RelationshipUpdate(BaseModel):
    relationship_type: Optional[str] = None
    metadata_json: Optional[Dict[str, Any]] = None

class RelationshipResponse(RelationshipBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Version History Schemas ---
class VersionHistoryResponse(BaseModel):
    id: str
    asset_id: str
    version_number: int
    change_summary: Optional[str] = None
    metadata_snapshot: Dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


# --- Activity Log Schemas ---
class ActivityLogResponse(BaseModel):
    id: str
    activity_type: str
    details: str
    asset_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# --- Search Schemas ---
class SearchResultItem(BaseModel):
    id: str
    name: str
    type: str  # 'asset' or 'column'
    asset_id: Optional[str] = None  # if type is 'column', refers to parent asset id
    asset_name: Optional[str] = None # if type is 'column', name of parent asset
    match_field: str  # name, description, tags, notes, column_name
    match_value: str
    preview: str

class SearchResponse(BaseModel):
    query: str
    results: List[SearchResultItem]


# --- WebSocket Broadcast Schemas ---
class WSBroadcastEvent(BaseModel):
    event_type: str  # 'asset_created', 'asset_updated', 'asset_deleted', 'relationship_created', 'relationship_deleted', 'relationship_updated'
    data: Any

# --- Workspace Sync Schemas ---
class ColumnSyncSchema(BaseModel):
    id: str
    name: str
    datatype: str
    nullable_percentage: Optional[float] = None
    distinct_count: Optional[int] = None
    duplicate_count: Optional[int] = None
    min: Optional[str] = None
    max: Optional[str] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    sample_values: Optional[List[Any]] = Field(default_factory=list)
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = Field(default_factory=list)
    custom_attributes: Optional[Dict[str, Any]] = Field(default_factory=dict)

class AssetSyncSchema(BaseModel):
    id: str
    name: str
    asset_type: str = "csv"
    description: Optional[str] = None
    owner: Optional[str] = None
    version: int = 1
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    file_size: Optional[int] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = Field(default_factory=list)
    custom_attributes: Optional[Dict[str, Any]] = Field(default_factory=dict)
    columns: List[ColumnSyncSchema] = Field(default_factory=list)

class RelationshipSyncSchema(BaseModel):
    id: str
    source_node_type: str
    source_node_id: str
    destination_node_type: str
    destination_node_id: str
    relationship_type: str
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)

class WorkspaceSync(BaseModel):
    assets: List[AssetSyncSchema]
    relationships: List[RelationshipSyncSchema]
