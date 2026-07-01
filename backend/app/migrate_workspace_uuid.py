import sys
import os
import uuid
from datetime import datetime
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def migrate():
    # 1. Drop and Create table workspaces
    with engine.begin() as conn:
        print("Dropping workspaces table if it exists...")
        conn.execute(text("DROP TABLE IF EXISTS workspaces CASCADE"))
        
        print("Creating workspaces table...")
        conn.execute(text("""
            CREATE TABLE workspaces (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL
            )
        """))

    # 2. Add workspaces data
    now_str = datetime.utcnow()
    default_workspaces = [
        {"id": str(uuid.uuid4()), "name": "Workspace 1", "created_at": now_str, "updated_at": now_str},
        {"id": str(uuid.uuid4()), "name": "Workspace 2", "created_at": now_str, "updated_at": now_str},
        {"id": str(uuid.uuid4()), "name": "Workspace 3", "created_at": now_str, "updated_at": now_str}
    ]

    workspace_mapping = {}

    with engine.begin() as conn:
        print("Checking/Inserting default workspaces...")
        for dw in default_workspaces:
            # Check if name already exists
            res = conn.execute(text("SELECT id FROM workspaces WHERE name = :name"), {"name": dw["name"]}).fetchone()
            if res:
                workspace_mapping[dw["name"]] = res[0]
                print(f"Workspace '{dw['name']}' already exists with ID: {res[0]}")
            else:
                conn.execute(text("""
                    INSERT INTO workspaces (id, name, created_at, updated_at) 
                    VALUES (:id, :name, :created_at, :updated_at)
                """), dw)
                workspace_mapping[dw["name"]] = dw["id"]
                print(f"Created workspace '{dw['name']}' with ID: {dw['id']}")

    # 3. Update existing records in other tables to use the workspace UUID
    tables = ["assets", "relationships", "activity_logs", "import_drafts"]
    for table in tables:
        with engine.begin() as conn:
            print(f"Migrating table {table} to use workspace UUIDs...")
            res = conn.execute(text(f"SELECT DISTINCT workspace_id FROM {table}")).fetchall()
            for row in res:
                old_ws = row[0]
                if not old_ws:
                    continue
                # If old_ws is already a valid UUID (length 36, contains 4 hyphens), skip
                if len(old_ws) == 36 and old_ws.count("-") == 4:
                    print(f"Value '{old_ws}' in {table} already looks like a UUID. Skipping.")
                    continue
                
                # Retrieve or create a workspace entry for this name
                if old_ws in workspace_mapping:
                    new_uuid = workspace_mapping[old_ws]
                else:
                    db_res = conn.execute(text("SELECT id FROM workspaces WHERE name = :name"), {"name": old_ws}).fetchone()
                    if db_res:
                        new_uuid = db_res[0]
                    else:
                        new_uuid = str(uuid.uuid4())
                        conn.execute(text("""
                            INSERT INTO workspaces (id, name, created_at, updated_at) 
                            VALUES (:id, :name, :created_at, :updated_at)
                        """), {"id": new_uuid, "name": old_ws, "created_at": now_str, "updated_at": now_str})
                        print(f"Dynamically created missing workspace '{old_ws}' with ID: {new_uuid}")
                    workspace_mapping[old_ws] = new_uuid
                
                # Perform the update
                conn.execute(text(f"UPDATE {table} SET workspace_id = :new_uuid WHERE workspace_id = :old_ws"), {
                    "new_uuid": new_uuid,
                    "old_ws": old_ws
                })
                print(f"Mapped '{old_ws}' -> '{new_uuid}' in table {table}")

    print("Migration complete!")

if __name__ == "__main__":
    migrate()
