import sys
import os
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine

def migrate():
    print("Checking/adding columns...")
    tables = ["assets", "relationships", "activity_logs", "import_drafts"]
    
    for table in tables:
        # engine.begin() manages a transaction and automatically rolls back if an exception occurs
        with engine.begin() as conn:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN workspace_id VARCHAR(255) NOT NULL DEFAULT 'Workspace 1'"))
                print(f"Successfully added workspace_id to {table}")
            except Exception as e:
                print(f"Skipping {table}: column may already exist or error occurred: {e}")
                
    print("Migration complete!")

if __name__ == "__main__":
    migrate()
