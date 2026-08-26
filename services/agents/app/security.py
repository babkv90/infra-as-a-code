from fastapi import HTTPException, Request
from jose import JWTError, jwt

from app.config import settings


class AgentIdentity:
    """The verified claims of the machine JWT Express minted for this run (agentIdentity.js).

    This service never mints tokens itself — it only verifies the one it was handed and forwards
    it, unchanged, on every callback into Express's /internal/agent-tools/* gateway. That's what
    lets requireAgentScope.js on the Express side be the single place scope is enforced.
    """

    def __init__(self, token: str, workspace_id: str, run_id: str, acting_user_id: str, scopes: list[str]):
        self.token = token
        self.workspace_id = workspace_id
        self.run_id = run_id
        self.acting_user_id = acting_user_id
        self.scopes = scopes


def verify_agent_token(request: Request) -> AgentIdentity:
    """FastAPI dependency (see `Depends(verify_agent_token)` in app/api/routes_runs.py): pulls the
    Bearer token off the request, verifies it against the shared AGENT_TOOL_SECRET, and returns
    the decoded identity. Raises 401 on a missing/invalid/expired token."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Agent authentication required")

    token = auth_header[len("Bearer ") :]
    try:
        payload = jwt.decode(token, settings.agent_tool_secret, algorithms=["HS256"], audience="agent-tools")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired agent token") from exc

    return AgentIdentity(
        token=token,
        workspace_id=payload.get("workspace", ""),
        run_id=payload.get("run", ""),
        acting_user_id=payload.get("act", ""),
        scopes=payload.get("scope", []),
    )
