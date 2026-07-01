import sys
import os
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def migrate():
    with engine.connect() as conn:
        print("Checking/adding columns...")
        # 1. assets table
        try:
            conn.execute(text("ALTER TABLE assets ADD COLUMN workspace_id VARCHAR(255) NOT NULL DEFAULT 'Workspace 1'"))
            print("Added workspace_id to assets")
        except Exception as e:
            print("assets already has workspace_id or error:", e)
            
        # 2. relationships table
        try:
            conn.execute(text("ALTER TABLE relationships ADD COLUMN workspace_id VARCHAR(255) NOT NULL DEFAULT 'Workspace 1'"))
            print("Added workspace_id to relationships")
        except Exception as e:
            print("relationships already has workspace_id or error:", e)
            
        # 3. activity_logs table
        try:
            conn.execute(text("ALTER TABLE activity_logs ADD COLUMN workspace_id VARCHAR(255) NOT NULL DEFAULT 'Workspace 1'"))
            print("Added workspace_id to activity_logs")
        except Exception as e:
            print("activity_logs already has workspace_id or error:", e)
            
        # 4. import_drafts table
        try:
            conn.execute(text("ALTER TABLE import_drafts ADD COLUMN workspace_id VARCHAR(255) NOT NULL DEFAULT 'Workspace 1'"))
            print("Added workspace_id to import_drafts")
        except Exception as e:
            print("import_drafts already has workspace_id or error:", e)
            
        conn.commit()
        print("Migration complete!")

if __name__ == "__main__":
    migrate()
