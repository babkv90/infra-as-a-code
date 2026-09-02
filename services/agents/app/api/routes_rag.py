"""HTTP surface for the knowledge base — the local-dev / long-lived-container equivalent of the
lambda_handler.py `op: "rag.*"` branch. Express calls these with a machine JWT carrying the
`rag:admin` scope; in production it invokes the Lambda synchronously instead.
"""

import base64

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.rag.service import IngestError, delete_document, ingest_document, list_documents
from app.rag.store import RagDisabledError
from app.security import AgentIdentity, verify_agent_token

router = APIRouter(prefix="/rag")

RAG_SCOPE = "rag:admin"


def _require_rag_admin(identity: AgentIdentity = Depends(verify_agent_token)) -> AgentIdentity:
    if RAG_SCOPE not in identity.scopes:
        raise HTTPException(status_code=403, detail=f"Agent token missing required scope: {RAG_SCOPE}")
    return identity


@router.get("/documents")
async def rag_list_documents(_: AgentIdentity = Depends(_require_rag_admin)):
    try:
        return {"documents": await list_documents()}
    except RagDisabledError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/documents")
async def rag_ingest_document(file: UploadFile, identity: AgentIdentity = Depends(_require_rag_admin)):
    data = await file.read()
    try:
        document = await ingest_document(
            filename=file.filename or "upload",
            content_type=file.content_type or "",
            content_b64=base64.b64encode(data).decode("ascii"),
            uploaded_by=identity.acting_user_id,
        )
        return {"document": document}
    except RagDisabledError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IngestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/documents/{document_id}")
async def rag_delete_document(document_id: str, _: AgentIdentity = Depends(_require_rag_admin)):
    try:
        return {"deleted": await delete_document(document_id)}
    except RagDisabledError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
