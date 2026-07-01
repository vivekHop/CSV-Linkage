import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import Workspace

db = SessionLocal()
try:
    workspaces = db.query(Workspace).all()
    print("Found workspaces:", len(workspaces))
    for ws in workspaces:
        print(ws.id, ws.name, ws.created_at, ws.updated_at)
except Exception as e:
    import traceback
    traceback.print_exc()
finally:
    db.close()
