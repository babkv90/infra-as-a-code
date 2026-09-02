"""Orchestration for the knowledge base: ingest / list / delete for the admin UI, and
retrieve_context for the graph. Thin layer over rag/{store,chunking,embed}.py."""

from __future__ import annotations

import base64
import logging

from app.config import settings
from app.rag import store
from app.rag.chunking import UnsupportedDocumentError, chunk_text, extract_text
from app.rag.embed import embed_query, embed_texts

logger = logging.getLogger("agents.rag")


class IngestError(ValueError):
    """A user-fixable ingestion problem (unsupported type, too large, empty text)."""


async def ingest_document(*, filename: str, content_type: str, content_b64: str, uploaded_by: str) -> dict:
    data = base64.b64decode(content_b64)
    if len(data) > settings.rag_max_document_bytes:
        raise IngestError(
            f"{filename} is {len(data) // 1024} KB; the limit is {settings.rag_max_document_bytes // 1024} KB."
        )

    try:
        text = extract_text(filename, content_type, data)
    except UnsupportedDocumentError as exc:
        raise IngestError(str(exc)) from exc

    chunks = chunk_text(text)
    if not chunks:
        raise IngestError(f"No extractable text found in {filename}.")

    await store.bootstrap()
    document_id = await store.insert_document(filename, len(data), content_type or "", uploaded_by)
    try:
        embeddings = await embed_texts(chunks)
        await store.replace_document_chunks(
            document_id, [(i, chunk, emb) for i, (chunk, emb) in enumerate(zip(chunks, embeddings))]
        )
    except Exception as exc:  # noqa: BLE001 — record the failure on the row, then re-raise for the caller
        await store.mark_document_failed(document_id, str(exc))
        logger.exception("ingest failed for document %s (%s)", document_id, filename)
        raise

    logger.info("ingested %s as document %s (%d chunks)", filename, document_id, len(chunks))
    return {"id": document_id, "filename": filename, "chunkCount": len(chunks), "status": "ready"}


async def list_documents() -> list[dict]:
    await store.bootstrap()
    return await store.list_documents()


async def delete_document(document_id: str) -> bool:
    await store.bootstrap()
    return await store.delete_document(document_id)


async def retrieve_context(question: str, *, k: int | None = None) -> list[dict]:
    """Top-k knowledge chunks for a question. Returns [] (never raises) when RAG is disabled or the
    lookup fails — a run must not break because the knowledge base is down."""
    if not store.is_enabled() or not question.strip():
        return []
    try:
        await store.bootstrap()
        query_vector = await embed_query(question)
        return await store.search(query_vector, k or settings.rag_top_k)
    except Exception:  # noqa: BLE001
        logger.exception("retrieve_context failed; continuing without knowledge")
        return []


def format_knowledge_block(chunks: list[dict]) -> str:
    """Render retrieved chunks as a text block for a grounding/DSL prompt. Empty string when there's
    nothing, so callers can unconditionally concatenate."""
    if not chunks:
        return ""
    lines = ["## Reference knowledge (retrieved from the uploaded knowledge base)"]
    for i, chunk in enumerate(chunks, 1):
        src = chunk.get("filename") or "document"
        lines.append(f"\n[{i}] source: {src}\n{chunk['content'].strip()}")
    lines.append(
        "\nCite these as [source: <filename>] when you use them. They are background reference only "
        "— the diagram above is the system under review."
    )
    return "\n".join(lines)
