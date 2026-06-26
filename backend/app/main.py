import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.routers import assets, columns, relationships, search, activities
from app.websockets import manager
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("csv_linkage_main")

# Auto-create tables on startup (convenient for local dev/testing)
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables initialized successfully.")
except Exception as e:
    logger.error(f"Error initializing database tables: {e}")

app = FastAPI(
    title="CSV Linkage",
    description="Collaborative CSV Metadata & Lineage Platform Backend",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, restrict this. For local MVP dev, * is perfect.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(assets.router, prefix=settings.API_V1_STR)
app.include_router(columns.router, prefix=settings.API_V1_STR)
app.include_router(relationships.router, prefix=settings.API_V1_STR)
app.include_router(search.router, prefix=settings.API_V1_STR)
app.include_router(activities.router, prefix=settings.API_V1_STR)

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "app_name": "CSV Linkage",
        "docs_url": "/docs"
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time collaborative events and presence (Figma-style).
    All connected users immediately receive events broadcasted here.
    """
    await manager.connect(websocket)
    try:
        while True:
            # Wait for any message from the client
            data = await websocket.receive_text()
            try:
                # If clients send messages (e.g. collaborative cursor positions, node drag status),
                # broadcast them directly to all other clients.
                message = json.loads(data)
                # Broadcast back to all clients
                await manager.broadcast(message)
            except json.JSONDecodeError:
                # If not json, broadcast as raw text
                await manager.broadcast({"event_type": "raw_message", "data": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
