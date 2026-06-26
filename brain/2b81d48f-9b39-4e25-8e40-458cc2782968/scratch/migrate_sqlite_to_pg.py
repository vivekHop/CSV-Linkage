import os
import sys
from os.path import dirname, abspath, join

# Add backend to sys.path
backend_path = abspath(join(dirname(__file__), '../../../backend'))
sys.path.insert(0, backend_path)

from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Asset, ColumnModel, RelationshipModel, VersionHistory, ActivityLog

# Database URLs
sqlite_url = "sqlite:///c:/Users/viv20/codingByVS/CSV Lineage/backend/csv_linkage.db"
postgres_url = os.getenv("DATABASE_URL")

if not postgres_url:
    print("PostgreSQL DATABASE_URL not found!")
    sys.exit(1)

# Establish Engines
engine_sqlite = create_engine(sqlite_url)
SessionSqlite = sessionmaker(bind=engine_sqlite)
session_sqlite = SessionSqlite()

engine_pg = create_engine(postgres_url)
SessionPg = sessionmaker(bind=engine_pg)
session_pg = SessionPg()

print("Reading SQLite data...")
assets = session_sqlite.query(Asset).all()
all_columns = session_sqlite.query(ColumnModel).all()
all_relationships = session_sqlite.query(RelationshipModel).all()
all_versions = session_sqlite.query(VersionHistory).all()
activities = session_sqlite.query(ActivityLog).all()

# Filter out orphans to satisfy PostgreSQL foreign key constraints
asset_ids = {a.id for a in assets}
columns = [c for c in all_columns if c.asset_id in asset_ids]
versions = [v for v in all_versions if v.asset_id in asset_ids]

orphan_columns_count = len(all_columns) - len(columns)
orphan_versions_count = len(all_versions) - len(versions)

print(f"Loaded from SQLite:\n- Assets: {len(assets)}\n- Columns: {len(columns)} (Filtered {orphan_columns_count} orphans)\n- Relationships: {len(all_relationships)}\n- Versions: {len(versions)} (Filtered {orphan_versions_count} orphans)\n- Activities: {len(activities)}")

print("Clearing target PostgreSQL database...")
session_pg.query(VersionHistory).delete()
session_pg.query(ColumnModel).delete()
session_pg.query(Asset).delete()
session_pg.query(RelationshipModel).delete()
session_pg.query(ActivityLog).delete()
session_pg.commit()

print("Copying data to PostgreSQL...")
for item in assets:
    new_item = Asset(
        id=item.id,
        name=item.name,
        asset_type=item.asset_type,
        description=item.description,
        owner=item.owner,
        version=item.version,
        row_count=item.row_count,
        column_count=item.column_count,
        file_size=item.file_size,
        notes=item.notes,
        tags=item.tags,
        custom_attributes=item.custom_attributes,
        created_at=item.created_at,
        updated_at=item.updated_at
    )
    session_pg.add(new_item)

for item in columns:
    new_item = ColumnModel(
        id=item.id,
        asset_id=item.asset_id,
        name=item.name,
        datatype=item.datatype,
        nullable_percentage=item.nullable_percentage,
        distinct_count=item.distinct_count,
        duplicate_count=item.duplicate_count,
        min=item.min,
        max=item.max,
        mean=item.mean,
        median=item.median,
        sample_values=item.sample_values,
        description=item.description,
        notes=item.notes,
        tags=item.tags,
        custom_attributes=item.custom_attributes,
        created_at=item.created_at,
        updated_at=item.updated_at
    )
    session_pg.add(new_item)

for item in all_relationships:
    new_item = RelationshipModel(
        id=item.id,
        source_node_type=item.source_node_type,
        source_node_id=item.source_node_id,
        destination_node_type=item.destination_node_type,
        destination_node_id=item.destination_node_id,
        relationship_type=item.relationship_type,
        metadata_json=item.metadata_json,
        created_at=item.created_at,
        updated_at=item.updated_at
    )
    session_pg.add(new_item)

for item in versions:
    new_item = VersionHistory(
        id=item.id,
        asset_id=item.asset_id,
        version_number=item.version_number,
        change_summary=item.change_summary,
        metadata_snapshot=item.metadata_snapshot,
        created_at=item.created_at
    )
    session_pg.add(new_item)

for item in activities:
    new_item = ActivityLog(
        id=item.id,
        activity_type=item.activity_type,
        details=item.details,
        asset_id=item.asset_id,
        created_at=item.created_at
    )
    session_pg.add(new_item)

try:
    session_pg.commit()
    print("Migration successful! All data copied from SQLite to PostgreSQL.")
except Exception as e:
    session_pg.rollback()
    print("Migration failed during commit!")
    raise e
finally:
    session_sqlite.close()
    session_pg.close()
