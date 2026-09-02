from fastapi import HTTPException, Request
from jose import JWTError, jwt

from app.config import settings


class AgentTokenError(Exception):
    """Raised by decode_agent_token for a missing / malformed / expired / wrong-audience token.

    Framework-agnostic on purpose: the FastAPI dependency (verify_agent_token) turns this into a
    401, and the Lambda handler (app/lambda_handler.py) turns it into a logged reject — neither
    path should have to know about the other's error type.
    """


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


def decode_agent_token(token: str) -> AgentIdentity:
    """Verify a raw machine JWT against the shared AGENT_TOOL_SECRET and return its decoded
    identity. The single implementation both entrypoints share — the FastAPI request path
    (verify_agent_token) and the Lambda invoke path (app/lambda_handler.py). Raises
    AgentTokenError on anything wrong with the token."""
    if not token:
        raise AgentTokenError("Agent authentication required")

    try:
        payload = jwt.decode(token, settings.agent_tool_secret, algorithms=["HS256"], audience="agent-tools")
    except JWTError as exc:
        raise AgentTokenError("Invalid or expired agent token") from exc

    return AgentIdentity(
        token=token,
        workspace_id=payload.get("workspace", ""),
        run_id=payload.get("run", ""),
        acting_user_id=payload.get("act", ""),
        scopes=payload.get("scope", []),
    )


def verify_agent_token(request: Request) -> AgentIdentity:
    """FastAPI dependency (see `Depends(verify_agent_token)` in app/api/routes_runs.py): pulls the
    Bearer token off the request and hands it to decode_agent_token, translating any
    AgentTokenError into the 401 the HTTP contract expects."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Agent authentication required")

    try:
        return decode_agent_token(auth_header[len("Bearer ") :])
    except AgentTokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
