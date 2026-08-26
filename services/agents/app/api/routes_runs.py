# The one HTTP surface this service exposes to Express (besides /health in app/main.py):
# POST /runs/start. Express calls this once per user message; everything after that is
# asynchronous background work reported back via app/gateway.py's callbacks.
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.runner import execute_run
from app.security import AgentIdentity, verify_agent_token

router = APIRouter()


class StartRunRequest(BaseModel):
    diagramId: str | None = None
    message: str  # the user's chat message / question
    history: list[dict] = []  # prior {role, content} turns in this conversation, for LLM context


@router.post("/runs/start")
async def start_run(body: StartRunRequest, identity: AgentIdentity = Depends(verify_agent_token)):
    if "diagram:read" not in identity.scopes:
        raise HTTPException(status_code=403, detail="Agent token missing required scope: diagram:read")

    if not body.diagramId:
        raise HTTPException(status_code=422, detail="diagramId is required — no diagram to ground this run on")

    # Fire-and-forget: schedules the LangGraph run and returns immediately. Progress and the final
    # answer are reported back to Express via callbacks (see app/runner.py, app/gateway.py) — the
    # browser polls Express's own stored AgentRun, never this service directly.
    execute_run(identity.run_id, identity.token, body.diagramId, body.message, body.history)

    return {"runId": identity.run_id, "status": "running"}
