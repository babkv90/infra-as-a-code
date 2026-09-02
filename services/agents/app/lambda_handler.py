"""AWS Lambda entrypoint for the infraflow-agents service.

Express (utils/agentBridge.js, with AGENT_INVOKE_MODE=lambda) invokes this function
asynchronously — InvocationType='Event' — once per user message, with this JSON payload:

    {
      "token":     "<machine JWT minted by agentIdentity.js>",
      "diagramId": "<diagram id to ground the run on>",
      "message":   "<the user's chat message / question>",
      "history":   [{"role": "...", "content": "..."}, ...]
    }

The run_id, workspace, acting user and scopes all live inside that JWT (same claims the uvicorn
path reads via app/security.verify_agent_token) — the payload never restates them.

Why the graph is awaited here rather than backgrounded like the uvicorn path does:
Lambda freezes the execution environment the moment the handler returns, so runner.execute_run()'s
fire-and-forget asyncio task would never finish. runner._run() already enforces MAX_WALL_SECONDS
and always reports a terminal status back to Express itself, so a slow or failing graph resolves
itself. Only an error escaping asyncio.run() below (an OOM, a broken deploy) propagates — and that
is exactly what should hit Lambda's async retry and, past that, the dead-letter queue.
"""

import asyncio
import logging

from app.runner import execute_run_sync
from app.security import AgentTokenError, decode_agent_token

logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger("agents.lambda")

REQUIRED_SCOPE = "diagram:read"


def handler(event, context):  # noqa: ARG001 — context is part of the Lambda contract, unused here
    payload = event or {}
    token = payload.get("token", "")
    diagram_id = payload.get("diagramId", "")
    message = payload.get("message", "")
    history = payload.get("history") or []

    try:
        identity = decode_agent_token(token)
    except AgentTokenError as exc:
        # A bad or expired token will never become valid on retry — log and stop, don't raise into
        # the async-invoke retry / DLQ path.
        logger.error("Rejected agent run: %s", exc)
        return {"ok": False, "error": "invalid_agent_token"}

    if REQUIRED_SCOPE not in identity.scopes:
        logger.error("Rejected agent run %s: token missing required scope %r", identity.run_id, REQUIRED_SCOPE)
        return {"ok": False, "error": "missing_scope"}

    if not diagram_id:
        logger.error("Rejected agent run %s: no diagramId in payload", identity.run_id)
        return {"ok": False, "error": "missing_diagram"}

    logger.info("Starting agent run %s (workspace=%s)", identity.run_id, identity.workspace_id)
    asyncio.run(execute_run_sync(identity.run_id, token, diagram_id, message, history))
    logger.info("Agent run %s finished", identity.run_id)
    return {"ok": True, "runId": identity.run_id}
