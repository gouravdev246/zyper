from fastapi import APIRouter
from datetime import datetime, timezone
import time

health_router = APIRouter()
START_TIME = time.time()

@health_router.get("/internal/v1/health")
async def health_check():
    return {
        "status": "ok",
        "service": "zyper-orchestrator",
        "version": "0.1.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime": time.time() - START_TIME,
    }
