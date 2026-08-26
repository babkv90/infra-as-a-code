# Entrypoint for the infraflow-agents FastAPI service (run with `uvicorn app.main:app`).
#
# This is the Python half of the multi-agent AI Cloud Agent feature (the other half is the
# Express "IAAS backend"). End-to-end flow, for anyone new to this service:
#   1. Express mints a short-lived machine JWT (agentIdentity.js) and POSTs to /runs/start here
#      (see app/api/routes_runs.py).
#   2. This service verifies that token (app/security.py), then schedules a LangGraph run in the
#      background (app/runner.py) and returns immediately — it never blocks the HTTP request on
#      the actual LLM work.
#   3. The graph (app/graph.py) fetches the diagram/Terraform/validation data it needs from
#      Express (app/gateway.py), fans a question out to the relevant specialist agents
#      (app/agents/*.py), and reports progress + the final answer back to Express via callbacks.
#   4. The browser never talks to this service directly — it only polls Express's own AgentRun
#      document (see IAAS backend/src/controllers/agentController.js).
from fastapi import FastAPI

from app.api.routes_runs import router as runs_router

app = FastAPI(title="infraflow-agents", version="0.1.0")
app.include_router(runs_router)


@app.get("/health")
def health():
    """Liveness probe — confirms the process is up, not that OpenAI/Express are reachable."""
    return {"ok": True, "service": "infraflow-agents"}
