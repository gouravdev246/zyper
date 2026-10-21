from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/internal/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "zyper-orchestrator"

def test_create_and_cancel_run():
    # 1. Create run
    create_res = client.post("/internal/v1/runs", json={"goal": "Summarize my inbox"})
    assert create_res.status_code == 200
    run_id = create_res.json()["id"]
    assert create_res.json()["status"] == "PENDING"

    # 2. Cancel run
    cancel_res = client.post(f"/internal/v1/runs/{run_id}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "CANCELLED"

def test_stream_run_endpoint():
    response = client.post("/internal/v1/runs/stream", json={"goal": "Test streaming goal"})
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    text = response.text
    assert "run.started" in text
    assert "token" in text
    assert "run.completed" in text
