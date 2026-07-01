import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Asset(Base):
    __tablename__ = "assets"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    workspace_id = Column(String(255), nullable=False, default="Workspace 1")
    name = Column(String(255), nullable=False)
    asset_type = Column(String(50), nullable=False, default="csv")
    description = Column(Text, nullable=True)
    owner = Column(String(255), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    
    # File metrics (not actual business data, only file metadata)
    row_count = Column(Integer, nullable=True)
    column_count = Column(Integer, nullable=True)
    file_size = Column(Integer, nullable=True) # in bytes
    
    # Business Metadata
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True, default=list) # List of strings
    custom_attributes = Column(JSON, nullable=True, default=dict) # Key-value pairs
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    columns = relationship("ColumnModel", back_populates="asset", cascade="all, delete-orphan")
    version_histories = relationship("VersionHistory", back_populates="asset", cascade="all, delete-orphan")

class ColumnModel(Base):
    """
    Named ColumnModel to avoid conflicts with sqlalchemy.Column
    """
    __tablename__ = "columns"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    asset_id = Column(String(36), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    datatype = Column(String(100), nullable=False)
    
    # Profiling Statistics
    nullable_percentage = Column(Float, nullable=True)
    distinct_count = Column(Integer, nullable=True)
    duplicate_count = Column(Integer, nullable=True)
    min = Column(String(255), nullable=True)
    max = Column(String(255), nullable=True)
    mean = Column(Float, nullable=True)
    median = Column(Float, nullable=True)
    sample_values = Column(JSON, nullable=True, default=list) # List of strings/numbers/etc.
    
    description = Column(Text, nullable=True)
    
    # Business Metadata for columns
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True, default=list)
    custom_attributes = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    asset = relationship("Asset", back_populates="columns")

class RelationshipModel(Base):
    """
    Generic Relationship Table representing Lineage
    """
    __tablename__ = "relationships"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    workspace_id = Column(String(255), nullable=False, default="Workspace 1")
    
    # Source node info
    source_node_type = Column(String(50), nullable=False) # 'asset' or 'column'
    source_node_id = Column(String(36), nullable=False)
    
    # Destination node info
    destination_node_type = Column(String(50), nullable=False) # 'asset' or 'column'
    destination_node_id = Column(String(36), nullable=False)
    
    # Relationship type: DERIVES_FROM, MAPS_TO, LOOKUP_FROM, COPIED_FROM
    relationship_type = Column(String(50), nullable=False)
    
    # Generic metadata JSON
    metadata_json = Column(JSON, nullable=True, default=dict)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class VersionHistory(Base):
    """
    Tracks historical metadata snapshots of Assets
    """
    __tablename__ = "version_histories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    asset_id = Column(String(36), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    change_summary = Column(String(255), nullable=True)
    metadata_snapshot = Column(JSON, nullable=False) # Complete dump of the asset metadata at that version
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    asset = relationship("Asset", back_populates="version_histories")

class ActivityLog(Base):
    """
    Recent activities for collaboration visibility
    """
    __tablename__ = "activity_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    workspace_id = Column(String(255), nullable=False, default="Workspace 1")
    activity_type = Column(String(50), nullable=False) # e.g. 'asset_created', 'asset_updated', 'relationship_created', 'relationship_deleted'
    details = Column(Text, nullable=False)
    asset_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class ImportDraft(Base):
    """
    Persisted import draft state for Excel uploads
    """
    __tablename__ = "import_drafts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    workspace_id = Column(String(255), nullable=False, default="Workspace 1")
    name = Column(String(255), nullable=False)
    draft_json = Column(JSON, nullable=False) # { "assets": [...], "relationships": [...] }
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
