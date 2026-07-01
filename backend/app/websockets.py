from fastapi import WebSocket
from typing import List, Dict, Any
import json
import logging

logger = logging.getLogger("csv_linkage_ws")

class ConnectionManager:
    def __init__(self):
        self.connection_workspaces: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, workspace_id: str):
        await websocket.accept()
        self.connection_workspaces[websocket] = workspace_id
        logger.info(f"New client connected to workspace '{workspace_id}'. Total global connections: {len(self.connection_workspaces)}")
        await self.broadcast_presence_stats()

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.connection_workspaces:
            workspace_id = self.connection_workspaces.pop(websocket)
            logger.info(f"Client disconnected from workspace '{workspace_id}'. Total global connections: {len(self.connection_workspaces)}")
            await self.broadcast_presence_stats()

    async def broadcast_presence_stats(self):
        """
        Broadcasts the current global and per-workspace connection counts to all connected clients.
        """
        global_count = len(self.connection_workspaces)
        workspace_counts = {}
        for ws in self.connection_workspaces.values():
            workspace_counts[ws] = workspace_counts.get(ws, 0) + 1

        payload = {
            "event_type": "presence_stats",
            "data": {
                "global_count": global_count,
                "workspace_counts": workspace_counts
            }
        }
        
        message_str = json.dumps(payload)
        disconnected = []
        for connection in list(self.connection_workspaces.keys()):
            try:
                await connection.send_text(message_str)
            except Exception:
                disconnected.append(connection)

        for connection in disconnected:
            if connection in self.connection_workspaces:
                self.connection_workspaces.pop(connection)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(message)
        except Exception as e:
            logger.error(f"Error sending message to individual client: {e}")

    async def broadcast(self, message: dict):
        """
        Broadcasts a JSON message to all active WebSocket connections in the same workspace.
        Automatically handles and removes disconnected clients.
        """
        # Extract workspace_id to filter who receives the message
        workspace_id = None
        if isinstance(message.get("data"), dict):
            workspace_id = message["data"].get("workspace_id")
        if not workspace_id:
            workspace_id = message.get("workspace_id")

        message_str = json.dumps(message)
        disconnected = []
        
        for connection, ws_workspace in list(self.connection_workspaces.items()):
            # Only broadcast to users in the same workspace if workspace_id is specified
            if workspace_id and ws_workspace != workspace_id:
                continue
            try:
                await connection.send_text(message_str)
            except Exception as e:
                logger.error(f"Error broadcasting to client, marking for removal: {e}")
                disconnected.append(connection)

        for connection in disconnected:
            await self.disconnect(connection)

# Global manager instance
manager = ConnectionManager()
