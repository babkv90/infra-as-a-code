"""AWS Lambda entrypoint for the infraflow-agents service.

The invoke payload carries an `op` that selects the operation:

  op "run" (default) — Express invokes this ASYNCHRONOUSLY (InvocationType='Event') once per user
  message. Lambda freezes the execution environment the moment the handler returns, so the graph is
  awaited to completion here rather than backgrounded like the uvicorn path does. runner._run()
  enforces MAX_WALL_SECONDS and always reports a terminal status back to Express itself; only an
  error escaping asyncio.run() propagates, which is what Lambda's async retry + DLQ are for.
    payload: {"token", "diagramId", "message", "history"}

  op "rag.ingest" / "rag.list" / "rag.delete" — Express invokes this SYNCHRONOUSLY
  (InvocationType='RequestResponse') from the superadmin Knowledge Base UI. Requires the "rag:admin"
  scope on the machine JWT. Payloads:
    rag.ingest: {"token", "filename", "contentType", "contentB64"}
    rag.list:   {"token"}
    rag.delete: {"token", "documentId"}
"""

import asyncio
import logging

from app.rag.service import IngestError, delete_document, ingest_document, list_documents
from app.rag.store import RagDisabledError
from app.runner import execute_run_sync
from app.security import AgentTokenError, decode_agent_token

logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger("agents.lambda")

RUN_SCOPE = "diagram:read"
RAG_SCOPE = "rag:admin"


def handler(event, context):  # noqa: ARG001 — context is part of the Lambda contract, unused here
    payload = event or {}
    op = payload.get("op") or "run"

    try:
        identity = decode_agent_token(payload.get("token", ""))
    except AgentTokenError as exc:
        logger.error("Rejected %s: %s", op, exc)
        return {"ok": False, "error": "invalid_agent_token"}

    if op == "run":
        return _handle_run(identity, payload)
    if op in ("rag.ingest", "rag.list", "rag.delete"):
        return _handle_rag(op, identity, payload)

    logger.error("Rejected unknown op %r", op)
    return {"ok": False, "error": "unknown_op"}


def _handle_run(identity, payload):
    if RUN_SCOPE not in identity.scopes:
        logger.error("Rejected run %s: token missing %r", identity.run_id, RUN_SCOPE)
        return {"ok": False, "error": "missing_scope"}
    diagram_id = payload.get("diagramId", "")
    if not diagram_id:
        logger.error("Rejected run %s: no diagramId", identity.run_id)
        return {"ok": False, "error": "missing_diagram"}

    logger.info("Starting agent run %s (workspace=%s)", identity.run_id, identity.workspace_id)
    asyncio.run(execute_run_sync(identity.run_id, payload["token"], diagram_id, payload.get("message", ""), payload.get("history") or []))
    logger.info("Agent run %s finished", identity.run_id)
    return {"ok": True, "runId": identity.run_id}


def _handle_rag(op, identity, payload):
    if RAG_SCOPE not in identity.scopes:
        logger.error("Rejected %s: token missing %r", op, RAG_SCOPE)
        return {"ok": False, "error": "missing_scope"}

    try:
        if op == "rag.ingest":
            result = asyncio.run(
                ingest_document(
                    filename=payload.get("filename", "upload"),
                    content_type=payload.get("contentType", ""),
                    content_b64=payload.get("contentB64", ""),
                    uploaded_by=identity.acting_user_id,
                )
            )
            return {"ok": True, "document": result}
        if op == "rag.list":
            return {"ok": True, "documents": asyncio.run(list_documents())}
        if op == "rag.delete":
            deleted = asyncio.run(delete_document(payload.get("documentId", "")))
            return {"ok": True, "deleted": deleted}
    except RagDisabledError as exc:
        return {"ok": False, "error": "rag_disabled", "message": str(exc)}
    except IngestError as exc:
        return {"ok": False, "error": "ingest_rejected", "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 — surface a clean message, log the detail
        logger.exception("%s failed", op)
        return {"ok": False, "error": "rag_failed", "message": str(exc)}
