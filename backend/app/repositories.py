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


def compute_snapshot_diff(old_snap: Dict[str, Any], new_snap: Dict[str, Any]) -> List[Dict[str, Any]]:
    changes = []
    
    # Fields to check directly
    direct_fields = ["name", "description", "owner", "notes", "tags"]
    for field in direct_fields:
        old_val = old_snap.get(field)
        new_val = new_snap.get(field)
        if old_val != new_val:
            # If tags, format nicely as string representation
            if field == "tags":
                old_val = ", ".join(old_val) if isinstance(old_val, list) else str(old_val)
                new_val = ", ".join(new_val) if isinstance(new_val, list) else str(new_val)
            changes.append({
                "field": f"Asset {field}",
                "old": old_val if old_val is not None else "",
                "new": new_val if new_val is not None else ""
            })
            
    # Check columns
    old_cols = {c["id"]: c for c in old_snap.get("columns", [])}
    new_cols = {c["id"]: c for c in new_snap.get("columns", [])}
    
    # Deleted columns
    for cid, c in old_cols.items():
        if cid not in new_cols:
            changes.append({
                "field": f"Column '{c['name']}' deleted",
                "old": f"Column {c['name']} ({c['datatype']})",
                "new": ""
            })
            
    # Added columns
    for cid, c in new_cols.items():
        if cid not in old_cols:
            changes.append({
                "field": f"Column '{c['name']}' added",
                "old": "",
                "new": f"Column {c['name']} ({c['datatype']})"
            })
            
    # Modified columns
    for cid, c in new_cols.items():
        if cid in old_cols:
            old_c = old_cols[cid]
            col_fields = ["name", "datatype", "description", "notes"]
            col_changes = []
            for cf in col_fields:
                if old_c.get(cf) != c.get(cf):
                    col_changes.append(f"{cf} ({old_c.get(cf)} -> {c.get(cf)})")
            
            # check tags
            old_tags = old_c.get("tags")
            new_tags = c.get("tags")
            if old_tags != new_tags:
                col_changes.append(f"tags ({old_tags} -> {new_tags})")
                
            if col_changes:
                changes.append({
                    "field": f"Column '{c['name']}' updated",
                    "old": f"Properties: {', '.join(col_changes)}",
                    "new": "Updated metadata"
                })
                
    return changes


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
    
    # Fetch source asset name
    source_asset = db.query(Asset).filter(Asset.id == source_col.asset_id).first() if source_col else None
    source_asset_name = source_asset.name if source_asset else None
    
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
        if source_col_name and source_asset_name:
            import re
            # Get possible table names
            possible_tables = [source_asset_name]
            
            # Parse sheet and book names
            match = re.match(r"^(.+?)\s*\[([^\]]+)\]$", source_asset_name)
            if match:
                book_name = match.group(1).strip()
                sheet_name = match.group(2).strip()
                book_name_no_ext = re.sub(r"\.(xlsx|xls|ods|csv|tsv)$", "", book_name, flags=re.IGNORECASE)
                
                possible_tables.append(f"{book_name}.{sheet_name}")
                possible_tables.append(f"{book_name_no_ext}.{sheet_name}")
                possible_tables.append(sheet_name)
            
            cleaned_formula = formula
            escaped_col = re.escape(source_col_name)
            
            for t in possible_tables:
                escaped_table = re.escape(t)
                # Match [table][col]
                pattern_double = rf"\[\s*{escaped_table}\s*\]\s*\[\s*{escaped_col}\s*\]"
                cleaned_formula = re.sub(pattern_double, "", cleaned_formula, flags=re.IGNORECASE)
                # Match [table.col]
                pattern_single = rf"\[\s*{escaped_table}\.{escaped_col}\s*\]"
                cleaned_formula = re.sub(pattern_single, "", cleaned_formula, flags=re.IGNORECASE)
                
            # Also fallback to matching just the column name if it was single bracketed without table name
            pattern_col_only = rf"\[\s*{escaped_col}\s*\]"
            cleaned_formula = re.sub(pattern_col_only, "", cleaned_formula, flags=re.IGNORECASE)
            
            # Clean up dangling mathematical operators
            cleaned_formula = re.sub(r'\s*[\+\-\*\/%]\s*(?=[\+\-\*\/%])', '', cleaned_formula) # remove duplicated operators
            cleaned_formula = cleaned_formula.strip()
            # Clean leading/trailing operator
            if cleaned_formula.startswith('+') or cleaned_formula.startswith('-') or cleaned_formula.startswith('*') or cleaned_formula.startswith('/') or cleaned_formula.startswith('%'):
                cleaned_formula = cleaned_formula[1:].strip()
            if cleaned_formula.endswith('+') or cleaned_formula.endswith('-') or cleaned_formula.endswith('*') or cleaned_formula.endswith('/') or cleaned_formula.endswith('%'):
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

    def get_all(self, workspace_id: str) -> List[Asset]:
        return self.db.query(Asset).filter(Asset.workspace_id == workspace_id).order_by(Asset.name).all()

    def create(self, workspace_id: str, name: str, asset_type: str, row_count: int, column_count: int, file_size: int,
               description: str = "", owner: str = "", notes: str = "", tags: List[str] = None,
               custom_attributes: Dict[str, Any] = None, commit: bool = True) -> Asset:
        if tags is None:
            tags = ["uploaded"]
        if custom_attributes is None:
            custom_attributes = {}
            
        db_asset = Asset(
            workspace_id=workspace_id,
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
        self.db.flush()
        
        # Save initial version snapshot
        self.create_version_history(db_asset, "Initial Upload", commit=False)
        
        # Log Activity
        self.log_activity(workspace_id, "asset_created", f"Uploaded CSV asset '{name}' with {column_count} columns.", db_asset.id, commit=False)
        
        if commit:
            self.db.commit()
            self.db.refresh(db_asset)
        
        # Broadcast via WebSockets
        self._trigger_broadcast("asset_created", {
            "workspace_id": workspace_id,
            "id": db_asset.id,
            "name": db_asset.name,
            "row_count": db_asset.row_count,
            "column_count": db_asset.column_count
        })
        
        return db_asset

    def update(self, asset_id: str, updates: Dict[str, Any], commit: bool = True) -> Optional[Asset]:
        db_asset = self.get_by_id(asset_id)
        if not db_asset:
            return None

        # Filter to only the metadata fields we care about tracking
        TRACKED_FIELDS = {"name", "description", "owner", "notes", "tags", "custom_attributes"}
        metadata_updates = {k: v for k, v in updates.items() if k in TRACKED_FIELDS}

        # Capture old values BEFORE mutation using JSON round-trip.
        # copy.deepcopy keeps SQLAlchemy's mutable tracking wrappers, so the
        # "old" copy reflects mutations too. json.loads(json.dumps()) gives us
        # a plain Python dict that is fully detached from the ORM object.
        import json as _json
        def _snap(val):
            try:
                return _json.loads(_json.dumps(val, default=str))
            except Exception:
                return val
        old_values: Dict[str, Any] = {
            f: _snap(getattr(db_asset, f, None)) for f in TRACKED_FIELDS
        }

        # Update fields
        for key, value in updates.items():
            if hasattr(db_asset, key):
                setattr(db_asset, key, value)

        db_asset.updated_at = datetime.utcnow()
        self.db.flush()

        # Compute diff from captured old values vs freshly-set new values
        if metadata_updates:
            diff_changes = []
            for field in TRACKED_FIELDS:
                old_val = old_values.get(field)
                new_val = getattr(db_asset, field, None)

                # Normalize for comparison
                if field == "tags":
                    old_cmp = sorted(old_val or [])
                    new_cmp = sorted(new_val or [])
                elif field == "custom_attributes":
                    # Skip position changes — only track business attribute changes
                    old_biz = {k: v for k, v in (old_val or {}).items() if k != "position"}
                    new_biz = {k: v for k, v in (new_val or {}).items() if k != "position"}
                    old_cmp = old_biz
                    new_cmp = new_biz
                else:
                    old_cmp = old_val or ""
                    new_cmp = new_val or ""

                if old_cmp != new_cmp:
                    if field == "tags":
                        old_display = ", ".join(old_val or [])
                        new_display = ", ".join(new_val or [])
                    elif field == "custom_attributes":
                        old_display = str(old_biz)
                        new_display = str(new_biz)
                    else:
                        old_display = str(old_val or "")
                        new_display = str(new_val or "")

                    diff_changes.append({
                        "field": f"Asset {field}",
                        "old": old_display,
                        "new": new_display
                    })

            if diff_changes:
                # Increment version only when there's a real change
                db_asset.version += 1
                db_asset.updated_at = datetime.utcnow()
                self.db.flush()

                changed_field_labels = [c["field"] for c in diff_changes]
                change_summary = f"Updated: {', '.join(changed_field_labels)}"

                db_version = VersionHistory(
                    asset_id=db_asset.id,
                    version_number=db_asset.version,
                    change_summary=change_summary,
                    metadata_snapshot={
                        "version": db_asset.version,
                        "is_diff": True,
                        "changes": diff_changes
                    }
                )
                self.db.add(db_version)

                # Build a human-readable activity detail from the diff
                detail_parts = []
                for ch in diff_changes:
                    field = ch["field"]
                    old_v = ch["old"] or "(empty)"
                    new_v = ch["new"] or "(empty)"
                    detail_parts.append(f"{field}: \"{old_v}\" → \"{new_v}\"")
                activity_detail = f"Updated '{db_asset.name}': " + "; ".join(detail_parts)
                self.log_activity(db_asset.workspace_id, "asset_updated", activity_detail, db_asset.id, commit=False)

        if commit:
            self.db.commit()
            self.db.refresh(db_asset)

        # Broadcast via WebSockets
        self._trigger_broadcast("asset_updated", {
            "workspace_id": db_asset.workspace_id,
            "id": db_asset.id,
            "name": db_asset.name,
            "version": db_asset.version,
            "updates": updates
        })

        return db_asset

    def delete(self, asset_id: str, commit: bool = True) -> bool:
        db_asset = self.get_by_id(asset_id)
        if not db_asset:
            return False
            
        asset_name = db_asset.name
        workspace_id = db_asset.workspace_id
        
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
        self.db.flush()
        
        # Log Activity
        self.log_activity(workspace_id, "asset_deleted", f"Deleted CSV asset '{asset_name}'.", None, commit=False)
        
        if commit:
            self.db.commit()
        
        # Broadcast via WebSockets
        self._trigger_broadcast("asset_deleted", {
            "workspace_id": workspace_id,
            "id": asset_id,
            "name": asset_name
        })
        
        return True

    def create_version_history(self, asset: Asset, change_summary: str, commit: bool = True) -> VersionHistory:
        snapshot = create_asset_snapshot(asset)
        db_version = VersionHistory(
            asset_id=asset.id,
            version_number=asset.version,
            change_summary=change_summary,
            metadata_snapshot={
                "version": asset.version,
                "name": asset.name,
                "owner": asset.owner,
                "description": asset.description,
                "notes": asset.notes,
                "tags": asset.tags,
                "is_diff": False,
                "changes": []
            }
        )
        self.db.add(db_version)
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        return db_version

    def get_version_history(self, asset_id: str) -> List[VersionHistory]:
        return self.db.query(VersionHistory).filter(VersionHistory.asset_id == asset_id).order_by(VersionHistory.version_number.desc()).all()

    def log_activity(self, workspace_id: str, activity_type: str, details: str, asset_id: Optional[str] = None, commit: bool = True):
        activity = ActivityLog(
            workspace_id=workspace_id,
            activity_type=activity_type,
            details=details,
            asset_id=asset_id
        )
        self.db.add(activity)
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        # Broadcast activity to all users
        self._trigger_broadcast("activity_logged", {
            "workspace_id": workspace_id,
            "activity_type": activity_type,
            "details": details,
            "created_at": activity.created_at.isoformat() if activity.created_at else None
        })


class ColumnRepository(BaseRepository):
    def get_by_id(self, column_id: str) -> Optional[ColumnModel]:
        return self.db.query(ColumnModel).filter(ColumnModel.id == column_id).first()

    def get_by_asset_id(self, asset_id: str) -> List[ColumnModel]:
        # Order by created_at to preserve original column sequence from the imported sheet
        return self.db.query(ColumnModel).filter(ColumnModel.asset_id == asset_id).order_by(ColumnModel.created_at).all()

    def create(self, asset_id: str, column_data: Dict[str, Any], commit: bool = True) -> ColumnModel:
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
        if commit:
            self.db.commit()
            self.db.refresh(db_col)
        else:
            self.db.flush()
        return db_col

    def update(self, column_id: str, updates: Dict[str, Any], commit: bool = True) -> Optional[ColumnModel]:
        db_col = self.get_by_id(column_id)
        if not db_col:
            return None

        TRACKED_COL_FIELDS = {"description", "notes", "tags", "custom_attributes"}
        metadata_updates = {k: v for k, v in updates.items() if k in TRACKED_COL_FIELDS}

        # Capture old values for diff
        old_values = {k: getattr(db_col, k, None) for k in metadata_updates}

        for key, value in updates.items():
            if hasattr(db_col, key):
                setattr(db_col, key, value)

        db_col.updated_at = datetime.utcnow()
        self.db.flush()

        # Build diff details for column
        if metadata_updates:
            detail_parts = []
            for field, old_val in old_values.items():
                new_val = getattr(db_col, field, None)
                if old_val != new_val:
                    if field == "tags":
                        o = ", ".join(old_val) if isinstance(old_val, list) else str(old_val or "")
                        n = ", ".join(new_val) if isinstance(new_val, list) else str(new_val or "")
                        detail_parts.append(f"tags: [{o}] → [{n}]")
                    elif field == "custom_attributes":
                        # Only flag formula changes specifically
                        old_formula = (old_val or {}).get("formula", "")
                        new_formula = (new_val or {}).get("formula", "")
                        if old_formula != new_formula:
                            detail_parts.append(f"formula: \"{old_formula or '(none)'}\" → \"{new_formula or '(none)'}\")")
                    else:
                        o = str(old_val or "(empty)")
                        n = str(new_val or "(empty)")
                        detail_parts.append(f"{field}: \"{o}\" → \"{n}\"")

            if detail_parts:
                activity_detail = f"Updated column '{db_col.asset.name}.{db_col.name}': " + "; ".join(detail_parts)
                self.log_activity(db_col.asset.workspace_id, "column_updated", activity_detail, db_col.asset_id, commit=False)

        if commit:
            self.db.commit()
            self.db.refresh(db_col)

        # Broadcast via WebSockets
        self._trigger_broadcast("column_updated", {
            "workspace_id": db_col.asset.workspace_id,
            "id": db_col.id,
            "asset_id": db_col.asset_id,
            "name": db_col.name,
            "updates": updates
        })

        return db_col

    def delete(self, column_id: str, commit: bool = True) -> bool:
        db_col = self.get_by_id(column_id)
        if not db_col:
            return False
            
        column_name = db_col.name
        asset_name = db_col.asset.name
        asset_id = db_col.asset_id
        workspace_id = db_col.asset.workspace_id
        
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
        self.db.flush()
        
        # Trigger Asset version update
        asset_repo = AssetRepository(self.db)
        asset = asset_repo.get_by_id(asset_id)
        if asset:
            # Update column count
            new_col_count = max(0, (asset.column_count or len(asset.columns)) - 1)
            asset_repo.update(asset_id, {"column_count": new_col_count}, commit=False)

        # Log Activity
        self.log_activity(workspace_id, "column_deleted", f"Deleted column '{column_name}' from CSV asset '{asset_name}'.", asset_id, commit=False)
        
        if commit:
            self.db.commit()
            
        # Broadcast via WebSockets
        self._trigger_broadcast("column_deleted", {
            "workspace_id": workspace_id,
            "id": column_id,
            "asset_id": asset_id,
            "name": column_name
        })
        
        return True

    def log_activity(self, workspace_id: str, activity_type: str, details: str, asset_id: Optional[str] = None, commit: bool = True):
        activity = ActivityLog(
            workspace_id=workspace_id,
            activity_type=activity_type,
            details=details,
            asset_id=asset_id
        )
        self.db.add(activity)
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        self._trigger_broadcast("activity_logged", {
            "workspace_id": workspace_id,
            "activity_type": activity_type,
            "details": details,
            "created_at": activity.created_at.isoformat() if activity.created_at else None
        })


class RelationshipRepository(BaseRepository):
    def get_by_id(self, rel_id: str) -> Optional[RelationshipModel]:
        return self.db.query(RelationshipModel).filter(RelationshipModel.id == rel_id).first()

    def get_all(self, workspace_id: str) -> List[RelationshipModel]:
        return self.db.query(RelationshipModel).filter(RelationshipModel.workspace_id == workspace_id).all()

    def create(self, workspace_id: str, source_node_type: str, source_node_id: str,
               destination_node_type: str, destination_node_id: str,
               relationship_type: str, metadata_json: Dict[str, Any] = None, commit: bool = True) -> RelationshipModel:
        if metadata_json is None:
            metadata_json = {}
            
        db_rel = RelationshipModel(
            workspace_id=workspace_id,
            source_node_type=source_node_type,
            source_node_id=source_node_id,
            destination_node_type=destination_node_type,
            destination_node_id=destination_node_id,
            relationship_type=relationship_type,
            metadata_json=metadata_json
        )
        
        # Check for duplicate connection first to avoid duplicate nodes
        existing = self.db.query(RelationshipModel).filter(
            RelationshipModel.workspace_id == workspace_id,
            RelationshipModel.source_node_type == source_node_type,
            RelationshipModel.source_node_id == source_node_id,
            RelationshipModel.destination_node_type == destination_node_type,
            RelationshipModel.destination_node_id == destination_node_id,
            RelationshipModel.relationship_type == relationship_type
        ).first()
        
        if existing:
            return existing
            
        self.db.add(db_rel)
        self.db.flush()

        # Resolve human-readable names for activity log
        def resolve_node_label(node_type: str, node_id: str) -> str:
            if node_type == "asset":
                a = self.db.query(Asset).filter(Asset.id == node_id).first()
                return f"Table '{a.name}'" if a else f"Table [{node_id[:8]}]"
            else:
                col = self.db.query(ColumnModel).filter(ColumnModel.id == node_id).first()
                if col:
                    asset = self.db.query(Asset).filter(Asset.id == col.asset_id).first()
                    return f"'{asset.name}.{col.name}'" if asset else f"Column '{col.name}'"
                return f"Column [{node_id[:8]}]"

        src_label = resolve_node_label(source_node_type, source_node_id)
        dst_label = resolve_node_label(destination_node_type, destination_node_id)
        details = f"Created {relationship_type} lineage: {src_label} → {dst_label}"
        self.log_activity(workspace_id, "relationship_created", details, None, commit=False)

        if commit:
            self.db.commit()
            self.db.refresh(db_rel)

        # Broadcast via WebSockets
        self._trigger_broadcast("relationship_created", {
            "workspace_id": workspace_id,
            "id": db_rel.id,
            "source_node_type": db_rel.source_node_type,
            "source_node_id": db_rel.source_node_id,
            "destination_node_type": db_rel.destination_node_type,
            "destination_node_id": db_rel.destination_node_id,
            "relationship_type": db_rel.relationship_type,
            "metadata_json": db_rel.metadata_json
        })

        return db_rel

    def update(self, rel_id: str, updates: Dict[str, Any], commit: bool = True) -> Optional[RelationshipModel]:
        db_rel = self.get_by_id(rel_id)
        if not db_rel:
            return None
            
        for key, value in updates.items():
            if key == "metadata_json" and isinstance(value, dict):
                db_rel.metadata_json = {**(db_rel.metadata_json or {}), **value}
            elif hasattr(db_rel, key):
                setattr(db_rel, key, value)
                
        db_rel.updated_at = datetime.utcnow()
        if commit:
            self.db.commit()
            self.db.refresh(db_rel)
        else:
            self.db.flush()
        
        # Broadcast via WebSockets
        self._trigger_broadcast("relationship_updated", {
            "workspace_id": db_rel.workspace_id,
            "id": db_rel.id,
            "source_node_id": db_rel.source_node_id,
            "destination_node_id": db_rel.destination_node_id,
            "relationship_type": db_rel.relationship_type,
            "metadata_json": db_rel.metadata_json
        })
        
        return db_rel

    def delete(self, rel_id: str, commit: bool = True) -> bool:
        db_rel = self.get_by_id(rel_id)
        if not db_rel:
            return False

        workspace_id = db_rel.workspace_id
        source_id = db_rel.source_node_id
        dest_id = db_rel.destination_node_id
        source_type = db_rel.source_node_type
        dest_type = db_rel.destination_node_type
        rel_type = db_rel.relationship_type

        # Resolve human-readable names for activity log BEFORE deletion
        def resolve_node_label(node_type: str, node_id: str) -> str:
            if node_type == "asset":
                a = self.db.query(Asset).filter(Asset.id == node_id).first()
                return f"Table '{a.name}'" if a else f"Table [{node_id[:8]}]"
            else:
                col = self.db.query(ColumnModel).filter(ColumnModel.id == node_id).first()
                if col:
                    asset = self.db.query(Asset).filter(Asset.id == col.asset_id).first()
                    return f"'{asset.name}.{col.name}'" if asset else f"Column '{col.name}'"
                return f"Column [{node_id[:8]}]"

        src_label = resolve_node_label(source_type, source_id)
        dst_label = resolve_node_label(dest_type, dest_id)

        # Clean up formula if it's a column-to-column lineage
        if source_type == "column" and dest_type == "column":
            cleanup_formula_on_rel_deletion(self.db, source_id, dest_id)

        self.db.delete(db_rel)
        self.db.flush()

        # Log Activity with human-readable names
        details = f"Removed {rel_type} lineage: {src_label} → {dst_label}"
        self.log_activity(workspace_id, "relationship_deleted", details, None, commit=False)

        if commit:
            self.db.commit()

        # Broadcast via WebSockets
        self._trigger_broadcast("relationship_deleted", {
            "workspace_id": workspace_id,
            "id": rel_id,
            "source_node_id": source_id,
            "destination_node_id": dest_id
        })

        return True

    def log_activity(self, workspace_id: str, activity_type: str, details: str, asset_id: Optional[str] = None, commit: bool = True):
        activity = ActivityLog(
            workspace_id=workspace_id,
            activity_type=activity_type,
            details=details,
            asset_id=asset_id
        )
        self.db.add(activity)
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        self._trigger_broadcast("activity_logged", {
            "workspace_id": workspace_id,
            "activity_type": activity_type,
            "details": details,
            "created_at": activity.created_at.isoformat() if activity.created_at else None
        })


class SearchRepository(BaseRepository):
    def search(self, workspace_id: str, query_str: str) -> List[Dict[str, Any]]:
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
            Asset.workspace_id == workspace_id,
            or_(
                Asset.name.ilike(search_term),
                Asset.description.ilike(search_term),
                Asset.notes.ilike(search_term),
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
            Asset.workspace_id == workspace_id,
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
    def get_recent(self, workspace_id: str, limit: int = 50) -> List[ActivityLog]:
        return self.db.query(ActivityLog).filter(ActivityLog.workspace_id == workspace_id).order_by(ActivityLog.created_at.desc()).limit(limit).all()


class ImportDraftRepository(BaseRepository):
    def get_all(self, workspace_id: str) -> List[ImportDraft]:
        return self.db.query(ImportDraft).filter(ImportDraft.workspace_id == workspace_id).order_by(ImportDraft.created_at.desc()).all()

    def get_by_id(self, draft_id: str) -> Optional[ImportDraft]:
        return self.db.query(ImportDraft).filter(ImportDraft.id == draft_id).first()

    def create(self, workspace_id: str, name: str, draft_json: Dict[str, Any]) -> ImportDraft:
        db_draft = ImportDraft(workspace_id=workspace_id, name=name, draft_json=draft_json)
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
