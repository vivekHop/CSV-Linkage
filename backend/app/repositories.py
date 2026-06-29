import json
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Dict, Any, Optional, Tuple
from app.models import Asset, ColumnModel, RelationshipModel, VersionHistory, ActivityLog, ImportDraft
from app.websockets import manager
import asyncio

# Helper to serialize an asset to a dictionary for version snapshots
def create_asset_snapshot(asset: Asset) -> Dict[str, Any]:
    return {
        "id": asset.id,
        "name": asset.name,
        "asset_type": asset.asset_type,
        "description": asset.description,
        "owner": asset.owner,
        "version": asset.version,
        "row_count": asset.row_count,
        "column_count": asset.column_count,
        "file_size": asset.file_size,
        "notes": asset.notes,
        "tags": asset.tags,
        "custom_attributes": asset.custom_attributes,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
        "columns": [
            {
                "id": col.id,
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
                "description": col.description,
                "notes": col.notes,
                "tags": col.tags,
                "custom_attributes": col.custom_attributes
            }
            for col in asset.columns
        ]
    }


def cleanup_formula_on_rel_deletion(db: Session, source_col_id: str, dest_col_id: str):
    import re
    # Fetch destination column
    dest_col = db.query(ColumnModel).filter(ColumnModel.id == dest_col_id).first()
    if not dest_col:
        return
        
    # Check if there is a formula in custom_attributes
    custom_attrs = dest_col.custom_attributes or {}
    formula = custom_attrs.get("formula")
    if not formula:
        return
        
    # Fetch source column
    source_col = db.query(ColumnModel).filter(ColumnModel.id == source_col_id).first()
    source_col_name = source_col.name if source_col else None
    
    # Check if this destination column has any OTHER active incoming lineage relationships
    other_incoming_rels = db.query(RelationshipModel).filter(
        RelationshipModel.destination_node_type == "column",
        RelationshipModel.destination_node_id == dest_col_id,
        RelationshipModel.source_node_id != source_col_id
    ).all()
    
    if not other_incoming_rels:
        # No other source left, clear the formula entirely
        new_attrs = dict(custom_attrs)
        new_attrs.pop("formula", None)
        dest_col.custom_attributes = new_attrs
    else:
        # There are other sources left, we clean up this source's column references in the formula
        if source_col_name:
            # Clean f"[{source_col_name}]" or f"[{asset_name}.{source_col_name}]"
            escaped_name = re.escape(source_col_name)
            # Match [source_col_name] or [Anything.source_col_name]
            pattern = rf"\[([^\]]+\.)?{escaped_name}\]"
            cleaned_formula = re.sub(pattern, "", formula)
            
            # Clean up dangling mathematical operators
            cleaned_formula = re.sub(r'\s*[\+\-\*\/]\s*(?=[\+\-\*\/])', '', cleaned_formula) # remove duplicated operators
            cleaned_formula = cleaned_formula.strip()
            # Clean leading/trailing operator
            if cleaned_formula.startswith('+') or cleaned_formula.startswith('-') or cleaned_formula.startswith('*') or cleaned_formula.startswith('/'):
                cleaned_formula = cleaned_formula[1:].strip()
            if cleaned_formula.endswith('+') or cleaned_formula.endswith('-') or cleaned_formula.endswith('*') or cleaned_formula.endswith('/'):
                cleaned_formula = cleaned_formula[:-1].strip()
                
            new_attrs = dict(custom_attrs)
            new_attrs["formula"] = cleaned_formula
            dest_col.custom_attributes = new_attrs
            
    db.add(dest_col)
    db.flush()


class BaseRepository:
    def __init__(self, db: Session):
        self.db = db

    def _trigger_broadcast(self, event_type: str, data: Any):
        """
        Runs WebSocket broadcast asynchronously to avoid blocking the request thread.
        """
        payload = {
            "event_type": event_type,
            "data": data
        }
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(manager.broadcast(payload))
            else:
                loop.run_until_complete(manager.broadcast(payload))
        except Exception:
            # Fallback if no loop is running or available
            pass


class AssetRepository(BaseRepository):
    def get_by_id(self, asset_id: str) -> Optional[Asset]:
        return self.db.query(Asset).filter(Asset.id == asset_id).first()

    def get_all(self) -> List[Asset]:
        return self.db.query(Asset).order_by(Asset.name).all()

    def create(self, name: str, asset_type: str, row_count: int, column_count: int, file_size: int,
               description: str = "", owner: str = "", notes: str = "", tags: List[str] = None,
               custom_attributes: Dict[str, Any] = None) -> Asset:
        if tags is None:
            tags = ["uploaded"]
        if custom_attributes is None:
            custom_attributes = {}
            
        db_asset = Asset(
            name=name,
            asset_type=asset_type,
            row_count=row_count,
            column_count=column_count,
            file_size=file_size,
            description=description,
            owner=owner,
            notes=notes,
            tags=tags,
            custom_attributes=custom_attributes,
            version=1
        )
        self.db.add(db_asset)
        self.db.commit()
        self.db.refresh(db_asset)
        
        # Save initial version snapshot
        self.create_version_history(db_asset, "Initial Upload")
        
        # Log Activity
        self.log_activity("asset_created", f"Uploaded CSV asset '{name}' with {column_count} columns.", db_asset.id)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("asset_created", {
            "id": db_asset.id,
            "name": db_asset.name,
            "row_count": db_asset.row_count,
            "column_count": db_asset.column_count
        })
        
        return db_asset

    def update(self, asset_id: str, updates: Dict[str, Any]) -> Optional[Asset]:
        db_asset = self.get_by_id(asset_id)
        if not db_asset:
            return None
            
        # Update fields
        for key, value in updates.items():
            if hasattr(db_asset, key):
                setattr(db_asset, key, value)
                
        # Increment version on update
        db_asset.version += 1
        db_asset.updated_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(db_asset)
        
        # Save new version history
        change_summary = f"Updated metadata: {', '.join(updates.keys())}"
        self.create_version_history(db_asset, change_summary)
        
        # Log Activity
        self.log_activity("asset_updated", f"Updated CSV asset metadata for '{db_asset.name}': {change_summary}", db_asset.id)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("asset_updated", {
            "id": db_asset.id,
            "name": db_asset.name,
            "version": db_asset.version,
            "updates": updates
        })
        
        return db_asset

    def delete(self, asset_id: str) -> bool:
        db_asset = self.get_by_id(asset_id)
        if not db_asset:
            return False
            
        asset_name = db_asset.name
        
        # Find and delete any relationship where this asset is source or destination
        asset_rels = self.db.query(RelationshipModel).filter(
            or_(
                and_(RelationshipModel.source_node_type == "asset", RelationshipModel.source_node_id == asset_id),
                and_(RelationshipModel.destination_node_type == "asset", RelationshipModel.destination_node_id == asset_id)
            )
        ).all()
        for rel in asset_rels:
            self.db.delete(rel)
        
        # Also clean up column relationships
        column_ids = [c.id for c in db_asset.columns]
        if column_ids:
            col_rels = self.db.query(RelationshipModel).filter(
                or_(
                    and_(RelationshipModel.source_node_type == "column", RelationshipModel.source_node_id.in_(column_ids)),
                    and_(RelationshipModel.destination_node_type == "column", RelationshipModel.destination_node_id.in_(column_ids))
                )
            ).all()
            for rel in col_rels:
                if rel.source_node_type == "column" and rel.destination_node_type == "column":
                    cleanup_formula_on_rel_deletion(self.db, rel.source_node_id, rel.destination_node_id)
                self.db.delete(rel)

        self.db.delete(db_asset)
        self.db.commit()
        
        # Log Activity
        self.log_activity("asset_deleted", f"Deleted CSV asset '{asset_name}'.", None)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("asset_deleted", {
            "id": asset_id,
            "name": asset_name
        })
        
        return True

    def create_version_history(self, asset: Asset, change_summary: str) -> VersionHistory:
        snapshot = create_asset_snapshot(asset)
        db_version = VersionHistory(
            asset_id=asset.id,
            version_number=asset.version,
            change_summary=change_summary,
            metadata_snapshot=snapshot
        )
        self.db.add(db_version)
        self.db.commit()
        return db_version

    def get_version_history(self, asset_id: str) -> List[VersionHistory]:
        return self.db.query(VersionHistory).filter(VersionHistory.asset_id == asset_id).order_by(VersionHistory.version_number.desc()).all()

    def log_activity(self, activity_type: str, details: str, asset_id: Optional[str] = None):
        activity = ActivityLog(
            activity_type=activity_type,
            details=details,
            asset_id=asset_id
        )
        self.db.add(activity)
        self.db.commit()
        # Broadcast activity to all users
        self._trigger_broadcast("activity_logged", {
            "activity_type": activity_type,
            "details": details,
            "created_at": activity.created_at.isoformat() if activity.created_at else None
        })


class ColumnRepository(BaseRepository):
    def get_by_id(self, column_id: str) -> Optional[ColumnModel]:
        return self.db.query(ColumnModel).filter(ColumnModel.id == column_id).first()

    def get_by_asset_id(self, asset_id: str) -> List[ColumnModel]:
        return self.db.query(ColumnModel).filter(ColumnModel.asset_id == asset_id).order_by(ColumnModel.name).all()

    def create(self, asset_id: str, column_data: Dict[str, Any]) -> ColumnModel:
        db_col = ColumnModel(
            asset_id=asset_id,
            name=column_data["name"],
            datatype=column_data["datatype"],
            nullable_percentage=column_data.get("nullable_percentage"),
            distinct_count=column_data.get("distinct_count"),
            duplicate_count=column_data.get("duplicate_count"),
            min=column_data.get("min"),
            max=column_data.get("max"),
            mean=column_data.get("mean"),
            median=column_data.get("median"),
            sample_values=column_data.get("sample_values", []),
            description=column_data.get("description", ""),
            notes=column_data.get("notes", ""),
            tags=column_data.get("tags", []),
            custom_attributes=column_data.get("custom_attributes", {})
        )
        self.db.add(db_col)
        self.db.commit()
        self.db.refresh(db_col)
        return db_col

    def update(self, column_id: str, updates: Dict[str, Any]) -> Optional[ColumnModel]:
        db_col = self.get_by_id(column_id)
        if not db_col:
            return None
            
        for key, value in updates.items():
            if hasattr(db_col, key):
                setattr(db_col, key, value)
                
        db_col.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(db_col)
        
        # Trigger Asset version update (when column metadata changes, it changes the asset)
        asset_repo = AssetRepository(self.db)
        asset_repo.update(db_col.asset_id, {"updated_at": datetime.utcnow()})
        
        # Log Activity
        self.log_activity("column_updated", f"Updated column metadata for '{db_col.asset.name}.{db_col.name}'", db_col.asset_id)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("column_updated", {
            "id": db_col.id,
            "asset_id": db_col.asset_id,
            "name": db_col.name,
            "updates": updates
        })
        
        return db_col

    def delete(self, column_id: str) -> bool:
        db_col = self.get_by_id(column_id)
        if not db_col:
            return False
            
        column_name = db_col.name
        asset_name = db_col.asset.name
        asset_id = db_col.asset_id
        
        # Delete related relationships first
        col_rels = self.db.query(RelationshipModel).filter(
            or_(
                and_(RelationshipModel.source_node_type == "column", RelationshipModel.source_node_id == column_id),
                and_(RelationshipModel.destination_node_type == "column", RelationshipModel.destination_node_id == column_id)
            )
        ).all()
        for rel in col_rels:
            if rel.source_node_type == "column" and rel.destination_node_type == "column":
                cleanup_formula_on_rel_deletion(self.db, rel.source_node_id, rel.destination_node_id)
            self.db.delete(rel)
        
        self.db.delete(db_col)
        self.db.commit()
        
        # Trigger Asset version update
        asset_repo = AssetRepository(self.db)
        asset = asset_repo.get_by_id(asset_id)
        if asset:
            # Update column count
            new_col_count = max(0, (asset.column_count or len(asset.columns)) - 1)
            asset_repo.update(asset_id, {"column_count": new_col_count})

        # Log Activity
        self.log_activity("column_deleted", f"Deleted column '{column_name}' from CSV asset '{asset_name}'.", asset_id)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("column_deleted", {
            "id": column_id,
            "asset_id": asset_id,
            "name": column_name
        })
        
        return True

    def log_activity(self, activity_type: str, details: str, asset_id: Optional[str] = None):
        activity = ActivityLog(
            activity_type=activity_type,
            details=details,
            asset_id=asset_id
        )
        self.db.add(activity)
        self.db.commit()
        self._trigger_broadcast("activity_logged", {
            "activity_type": activity_type,
            "details": details,
            "created_at": activity.created_at.isoformat() if activity.created_at else None
        })


class RelationshipRepository(BaseRepository):
    def get_by_id(self, rel_id: str) -> Optional[RelationshipModel]:
        return self.db.query(RelationshipModel).filter(RelationshipModel.id == rel_id).first()

    def get_all(self) -> List[RelationshipModel]:
        return self.db.query(RelationshipModel).all()

    def create(self, source_node_type: str, source_node_id: str,
               destination_node_type: str, destination_node_id: str,
               relationship_type: str, metadata_json: Dict[str, Any] = None) -> RelationshipModel:
        if metadata_json is None:
            metadata_json = {}
            
        db_rel = RelationshipModel(
            source_node_type=source_node_type,
            source_node_id=source_node_id,
            destination_node_type=destination_node_type,
            destination_node_id=destination_node_id,
            relationship_type=relationship_type,
            metadata_json=metadata_json
        )
        
        # Check for duplicate connection first to avoid duplicate nodes
        existing = self.db.query(RelationshipModel).filter(
            RelationshipModel.source_node_type == source_node_type,
            RelationshipModel.source_node_id == source_node_id,
            RelationshipModel.destination_node_type == destination_node_type,
            RelationshipModel.destination_node_id == destination_node_id,
            RelationshipModel.relationship_type == relationship_type
        ).first()
        
        if existing:
            return existing
            
        self.db.add(db_rel)
        self.db.commit()
        self.db.refresh(db_rel)
        
        # Log Activity
        details = f"Created lineage edge: {source_node_type} ({source_node_id}) {relationship_type} {destination_node_type} ({destination_node_id})"
        self.log_activity("relationship_created", details, None)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("relationship_created", {
            "id": db_rel.id,
            "source_node_type": db_rel.source_node_type,
            "source_node_id": db_rel.source_node_id,
            "destination_node_type": db_rel.destination_node_type,
            "destination_node_id": db_rel.destination_node_id,
            "relationship_type": db_rel.relationship_type,
            "metadata_json": db_rel.metadata_json
        })
        
        return db_rel

    def update(self, rel_id: str, updates: Dict[str, Any]) -> Optional[RelationshipModel]:
        db_rel = self.get_by_id(rel_id)
        if not db_rel:
            return None
            
        for key, value in updates.items():
            if key == "metadata_json" and isinstance(value, dict):
                db_rel.metadata_json = {**(db_rel.metadata_json or {}), **value}
            elif hasattr(db_rel, key):
                setattr(db_rel, key, value)
                
        db_rel.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(db_rel)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("relationship_updated", {
            "id": db_rel.id,
            "source_node_id": db_rel.source_node_id,
            "destination_node_id": db_rel.destination_node_id,
            "relationship_type": db_rel.relationship_type,
            "metadata_json": db_rel.metadata_json
        })
        
        return db_rel

    def delete(self, rel_id: str) -> bool:
        db_rel = self.get_by_id(rel_id)
        if not db_rel:
            return False
            
        source_id = db_rel.source_node_id
        dest_id = db_rel.destination_node_id
        rel_type = db_rel.relationship_type
        
        # Clean up formula if it's a column-to-column lineage
        if db_rel.source_node_type == "column" and db_rel.destination_node_type == "column":
            cleanup_formula_on_rel_deletion(self.db, source_id, dest_id)
            
        self.db.delete(db_rel)
        self.db.commit()
        
        # Log Activity
        self.log_activity("relationship_deleted", f"Removed lineage edge: {source_id} -> {dest_id} ({rel_type})", None)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("relationship_deleted", {
            "id": rel_id,
            "source_node_id": source_id,
            "destination_node_id": dest_id
        })
        
        return True

    def log_activity(self, activity_type: str, details: str, asset_id: Optional[str] = None):
        activity = ActivityLog(
            activity_type=activity_type,
            details=details,
            asset_id=asset_id
        )
        self.db.add(activity)
        self.db.commit()
        self._trigger_broadcast("activity_logged", {
            "activity_type": activity_type,
            "details": details,
            "created_at": activity.created_at.isoformat() if activity.created_at else None
        })


class SearchRepository(BaseRepository):
    def search(self, query_str: str) -> List[Dict[str, Any]]:
        """
        Searches Assets and Columns tables for name, description, tags, notes, business notes, etc.
        Returns unified search results that map back to React Flow canvas nodes.
        """
        if not query_str or len(query_str.strip()) == 0:
            return []
            
        search_term = f"%{query_str}%"
        results = []
        
        # 1. Search Assets (CSV Files)
        assets = self.db.query(Asset).filter(
            or_(
                Asset.name.ilike(search_term),
                Asset.description.ilike(search_term),
                Asset.notes.ilike(search_term),
                # Note: tags column is JSON, SQLite requires a casting or string match, Postgres uses it differently.
                # To be fully compatible with both, we do a text match on casting or just check name/description/notes first, 
                # or string-compare JSON values for sqlite.
                Asset.owner.ilike(search_term)
            )
        ).all()
        
        for asset in assets:
            match_field = "name"
            match_value = asset.name
            preview = asset.description or ""
            
            if query_str.lower() in (asset.description or "").lower():
                match_field = "description"
                match_value = asset.description
            elif query_str.lower() in (asset.notes or "").lower():
                match_field = "business notes"
                match_value = asset.notes
                
            results.append({
                "id": asset.id,
                "name": asset.name,
                "type": "asset",
                "asset_id": asset.id,
                "asset_name": asset.name,
                "match_field": match_field,
                "match_value": match_value[:100] + "..." if len(match_value) > 100 else match_value,
                "preview": preview[:150] + "..." if len(preview) > 150 else preview
            })
            
        # 2. Search Columns
        columns = self.db.query(ColumnModel).join(Asset).filter(
            or_(
                ColumnModel.name.ilike(search_term),
                ColumnModel.description.ilike(search_term),
                ColumnModel.notes.ilike(search_term),
                ColumnModel.datatype.ilike(search_term)
            )
        ).all()
        
        for col in columns:
            match_field = "column name"
            match_value = col.name
            preview = col.description or f"Data type: {col.datatype}"
            
            if query_str.lower() in (col.description or "").lower():
                match_field = "column description"
                match_value = col.description
            elif query_str.lower() in (col.notes or "").lower():
                match_field = "column business notes"
                match_value = col.notes
                
            results.append({
                "id": col.id,
                "name": col.name,
                "type": "column",
                "asset_id": col.asset_id,
                "asset_name": col.asset.name if col.asset else "Unknown CSV",
                "match_field": match_field,
                "match_value": match_value[:100] + "..." if len(match_value) > 100 else match_value,
                "preview": preview[:150] + "..." if len(preview) > 150 else preview
            })
            
        return results


class ActivityLogRepository(BaseRepository):
    def get_recent(self, limit: int = 50) -> List[ActivityLog]:
        return self.db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit).all()


class ImportDraftRepository(BaseRepository):
    def get_all(self) -> List[ImportDraft]:
        return self.db.query(ImportDraft).order_by(ImportDraft.created_at.desc()).all()

    def get_by_id(self, draft_id: str) -> Optional[ImportDraft]:
        return self.db.query(ImportDraft).filter(ImportDraft.id == draft_id).first()

    def create(self, name: str, draft_json: Dict[str, Any]) -> ImportDraft:
        db_draft = ImportDraft(name=name, draft_json=draft_json)
        self.db.add(db_draft)
        self.db.commit()
        self.db.refresh(db_draft)
        return db_draft

    def update(self, draft_id: str, updates: Dict[str, Any]) -> Optional[ImportDraft]:
        db_draft = self.get_by_id(draft_id)
        if not db_draft:
            return None
        if "name" in updates:
            db_draft.name = updates["name"]
        if "draft_json" in updates:
            db_draft.draft_json = updates["draft_json"]
        db_draft.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(db_draft)
        return db_draft

    def delete(self, draft_id: str) -> bool:
        db_draft = self.get_by_id(draft_id)
        if not db_draft:
            return False
        self.db.delete(db_draft)
        self.db.commit()
        return True
