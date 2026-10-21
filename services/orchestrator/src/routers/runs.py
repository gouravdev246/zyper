from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import uuid

runs_router = APIRouter()

class RunCreateRequest(BaseModel):
    goal: str
    conversation_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None

@runs_router.post("/internal/v1/runs")
async def create_run(request: RunCreateRequest):
    run_id = str(uuid.uuid4())
    return {
        "id": run_id,
        "goal": request.goal,
        "status": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@runs_router.get("/internal/v1/runs/{run_id}")
async def get_run(run_id: str):
    return {
        "id": run_id,
        "status": "PENDING",
        "tasks": [],
    }

@runs_router.post("/internal/v1/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    return {
        "id": run_id,
        "status": "CANCELLED",
        "cancelled_at": datetime.now(timezone.utc).isoformat(),
    }
