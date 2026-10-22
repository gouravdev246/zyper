from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import uuid
import asyncio
import json
from src.config import settings
from src.services.llm import stream_chat_and_tools

runs_router = APIRouter()

# Active runs dictionary for internal tracking and cancellation
active_runs: Dict[str, Dict[str, Any]] = {}

class RunCreateRequest(BaseModel):
    goal: str
    conversation_id: Optional[str] = None
    run_id: Optional[str] = None
    model: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    history: Optional[List[Dict[str, Any]]] = None
    tools: Optional[List[Dict[str, Any]]] = None

@runs_router.post("/internal/v1/runs")
async def create_run(request: RunCreateRequest):
    run_id = str(uuid.uuid4())
    run_record = {
        "id": run_id,
        "goal": request.goal,
        "status": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "cancelled": False,
    }
    active_runs[run_id] = run_record
    return run_record

@runs_router.get("/internal/v1/runs/{run_id}")
async def get_run(run_id: str):
    if run_id in active_runs:
        return active_runs[run_id]
    return {
        "id": run_id,
        "status": "PENDING",
        "tasks": [],
    }

@runs_router.post("/internal/v1/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    if run_id in active_runs:
        active_runs[run_id]["cancelled"] = True
        active_runs[run_id]["status"] = "CANCELLED"
    return {
        "id": run_id,
        "status": "CANCELLED",
        "cancelled_at": datetime.now(timezone.utc).isoformat(),
    }

@runs_router.post("/internal/v1/runs/stream")
async def stream_run(request: RunCreateRequest, req: Request):
    run_id = request.run_id or str(uuid.uuid4())
    active_runs[run_id] = {
        "id": run_id,
        "goal": request.goal,
        "status": "RUNNING",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "cancelled": False,
    }

    return StreamingResponse(
        stream_chat_and_tools(
            run_id=run_id,
            goal=request.goal,
            history=request.history,
            req=req,
            active_runs=active_runs,
            model=request.model,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Run-Id": run_id,
        },
    )
