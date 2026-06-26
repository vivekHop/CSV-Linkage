from fastapi import WebSocket
from typing import List
import json
import logging

logger = logging.getLogger("csv_linkage_ws")

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Active connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(message)
        except Exception as e:
            logger.error(f"Error sending message to individual client: {e}")

    async def broadcast(self, message: dict):
        """
        Broadcasts a JSON message to all active WebSocket connections.
        Automatically handles and removes disconnected clients.
        """
        message_str = json.dumps(message)
        disconnected = []
        
        for connection in self.active_connections:
            try:
                await connection.send_text(message_str)
            except Exception as e:
                logger.error(f"Error broadcasting to client, marking for removal: {e}")
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection)

# Global manager instance
manager = ConnectionManager()
