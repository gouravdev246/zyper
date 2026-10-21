from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.routers.health import health_router
from src.routers.runs import runs_router
from src.config import settings

app = FastAPI(
    title="Zyper AI Orchestration Service",
    description="Internal orchestration, planning, and LangGraph workflow runtime for Personal AI Operator",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(runs_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=settings.PORT, reload=True)
