# CSV Linkage — Collaborative CSV Metadata & Lineage Platform

CSV Linkage is a production-ready, real-time collaborative workspace designed for data analysts and business teams working with CSV files. The platform allows users to upload CSVs, automatically extract profiling statistics, annotate metadata, visually draw lineages (relationships) on an infinite canvas, and collaborate in real-time.

**Crucially, the platform NEVER stores actual business data from CSVs.** Only metadata, profiling statistics, business annotations, and relationship connections are persisted.

---

## Architecture Overview

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL (SQLite fallback for dev), Pandas (in-memory profiling), WebSockets (real-time collaboration).
- **Frontend**: React, TypeScript, React Flow (interactive canvas), Tailwind CSS, React Query.
- **Collaboration**: Real-time cursor presence (Figma-style), node dragging, and metadata sync via WebSockets with a Last-Write-Wins conflict resolution strategy.
- **Lineage Model**: Generic relationship engine supporting four lineage links (`DERIVES_FROM`, `MAPS_TO`, `LOOKUP_FROM`, `COPIED_FROM`) across Columns and Assets.

---

## Tech Stack & Directory Structure

```text
CSV Lineage/
├── backend/                # FastAPI Application
│   ├── alembic/            # Alembic DB Migrations
│   ├── app/                # Main Application Code
│   │   ├── routers/        # API Endpoints (Assets, Columns, Lineage, Search)
│   │   ├── repositories/   # DB Repository pattern implementation
│   │   ├── config.py       # Configuration & Environment Variables
│   │   ├── database.py     # SQLAlchemy Connection Setup
│   │   ├── models.py       # SQLAlchemy Database Schema
│   │   ├── profiler.py     # Pandas In-Memory CSV profiling metrics
│   │   ├── schemas.py      # Pydantic serialization models
│   │   └── websockets.py   # WebSocket Broadcast Connection Manager
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               # React Vite Application
│   ├── src/
│   │   ├── components/     # UI Components (Canvas Nodes, Sidebars, bottom panel)
│   │   ├── api.ts          # REST Client helpers
│   │   ├── types.ts        # TypeScript Interfaces
│   │   ├── App.tsx         # Main Workspace dashboard
│   │   └── index.css       # Tailwind & React Flow canvas styling overrides
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
├── docker-compose.yml      # Orchestration (Postgres + Meilisearch + Backend)
├── .env.example            # Environment variables blueprint
└── README.md
```

---

## Running with Docker (Recommended for PostgreSQL)

The easiest way to spin up the entire production-like environment (including PostgreSQL and Meilisearch) is using Docker Compose:

1. Clone or navigate to the workspace directory.
2. Run the following command:
   ```bash
   docker-compose up --build
   ```
3. Once running:
   - Backend APIs: [http://localhost:8000](http://localhost:8000)
   - Swagger Documentation: [http://localhost:8000/docs](http://localhost:8000/docs)
   - Meilisearch: [http://localhost:7700](http://localhost:7700)

*Note: You can run the frontend locally (see below) or package it as a Docker service.*

---

## Running Locally (SQLite Development Fallback)

You can run the application directly on your local system without Docker. By default, it will fall back to a local SQLite database (`csv_linkage.db`), meaning zero external dependencies are required.

### 1. Backend Setup

Ensure you have Python 3.11+ installed:

```bash
# Navigate to backend folder
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run backend
uvicorn app.main:app --reload --port 8000
```

The database tables will be created automatically on start.

### 2. Frontend Setup

Ensure you have Node.js v18+ installed:

```bash
# Navigate to frontend folder
cd frontend

# Install dependencies
npm install --legacy-peer-deps

# Start Vite Development Server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Live Features Walkthrough

### Module 1: In-Memory CSV Upload
Upload CSV files. The backend reads the file byte stream in-memory, computes metrics (row count, distinct counts, nullable percentages, sample values), and discards the CSV immediately. **No business data is saved to disk.**

### Module 2 & 4: Lineage Canvas & Editor
Every CSV becomes a node. You can drag connections from:
- Column → Column
- Column → Asset (Header)
- Asset → Column
- Asset → Asset

When a connection is drawn, a floating dropdown prompts you to choose the relationship type:
- `DERIVES_FROM`
- `MAPS_TO`
- `LOOKUP_FROM`
- `COPIED_FROM`

### Module 5: Figma-Style Real-time Sync
Open two browser windows. As you drag nodes, edit descriptions, upload files, or draw connection lines, you will see mouse cursors moving and workspace updates propagating instantly across both screens.
