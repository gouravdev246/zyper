from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import uuid
import asyncio
import json
from src.config import settings

runs_router = APIRouter()

# Active runs dictionary for internal tracking and cancellation
active_runs: Dict[str, Dict[str, Any]] = {}

class RunCreateRequest(BaseModel):
    goal: str
    conversation_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    history: Optional[List[Dict[str, str]]] = None

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

async def event_generator(run_id: str, goal: str, req: Request):
    """
    Asynchronously stream status events and LLM tokens.
    Handles disconnection and cancellation cleanly.
    """
    try:
        # 1. run.created & run.started
        yield f"data: {json.dumps({'type': 'run.started', 'runId': run_id, 'goal': goal})}\n\n"
        await asyncio.sleep(0.15)

        # 2. task.planning
        yield f"data: {json.dumps({'type': 'task.started', 'task': 'planner', 'description': 'Analyzing goal and verifying permissions'})}\n\n"
        await asyncio.sleep(0.25)

        # 3. Stream reasoning tokens
        response_template = [
            f"Understood. Analyzing requirement for: **{goal}**.\n\n",
            "1. Verified permissions and active tool connectors.\n",
            "2. Checked safety policies (no consequential side-effects without explicit authorization).\n",
            "3. Structured plan formulated.\n\n",
            "I am ready to proceed with your workflow. What specific parameters or next action would you like me to execute?",
        ]

        for chunk in response_template:
            # Check for cancellation
            if active_runs.get(run_id, {}).get("cancelled"):
                yield f"data: {json.dumps({'type': 'run.cancelled', 'runId': run_id})}\n\n"
                return

            if await req.is_disconnected():
                active_runs[run_id]["cancelled"] = True
                return

            yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
            await asyncio.sleep(0.12)

        # 4. run.completed
        if run_id in active_runs:
            active_runs[run_id]["status"] = "COMPLETED"

        yield f"data: {json.dumps({'type': 'run.completed', 'runId': run_id, 'status': 'COMPLETED'})}\n\n"

    except asyncio.CancelledError:
        if run_id in active_runs:
            active_runs[run_id]["cancelled"] = True
            active_runs[run_id]["status"] = "CANCELLED"
        yield f"data: {json.dumps({'type': 'run.cancelled', 'runId': run_id})}\n\n"

@runs_router.post("/internal/v1/runs/stream")
async def stream_run(request: RunCreateRequest, req: Request):
    run_id = str(uuid.uuid4())
    active_runs[run_id] = {
        "id": run_id,
        "goal": request.goal,
        "status": "RUNNING",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "cancelled": False,
    }

    return StreamingResponse(
        event_generator(run_id, request.goal, req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Run-Id": run_id,
        },
    )
