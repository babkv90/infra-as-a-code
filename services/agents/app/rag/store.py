"""Postgres + pgvector storage for the knowledge base.

One lazily-created asyncpg pool per process (reused across warm Lambda invocations). The schema is
created on first use — `bootstrap()` is idempotent — so a fresh database needs no migration step
beyond `CREATE EXTENSION vector`, which bootstrap also attempts (it needs a role allowed to create
extensions; RDS's master user is).
"""

from __future__ import annotations

import asyncio

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()
_bootstrapped = False


class RagDisabledError(RuntimeError):
    """Raised when a RAG operation is attempted with no settings.database_url configured."""


def is_enabled() -> bool:
    return bool(settings.database_url)


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if not is_enabled():
        raise RagDisabledError("DATABASE_URL is not configured on the agent service — the knowledge base is disabled.")
    if _pool is None:
        async with _pool_lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=4, command_timeout=30)
    return _pool


def _vector_literal(vec: list[float]) -> str:
    # pgvector accepts a text form like '[0.1,0.2,...]'; cast with ::vector at the call site.
    return "[" + ",".join(f"{float(x):.8f}" for x in vec) + "]"


async def bootstrap() -> None:
    global _bootstrapped
    if _bootstrapped:
        return
    pool = await _get_pool()
    dim = int(settings.rag_embed_dim)
    async with pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rag_documents (
                id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                filename     text NOT NULL,
                byte_size    integer NOT NULL DEFAULT 0,
                content_type text NOT NULL DEFAULT '',
                chunk_count  integer NOT NULL DEFAULT 0,
                status       text NOT NULL DEFAULT 'ready',
                error        text,
                uploaded_by  text NOT NULL DEFAULT '',
                created_at   timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS rag_chunks (
                id          bigserial PRIMARY KEY,
                document_id uuid NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
                chunk_index integer NOT NULL,
                content     text NOT NULL,
                embedding   vector({dim}) NOT NULL,
                created_at  timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON rag_chunks USING hnsw (embedding vector_cosine_ops)"
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS rag_chunks_document_id_idx ON rag_chunks (document_id)")
    _bootstrapped = True


async def insert_document(filename: str, byte_size: int, content_type: str, uploaded_by: str) -> str:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO rag_documents (filename, byte_size, content_type, uploaded_by, status)
            VALUES ($1, $2, $3, $4, 'processing')
            RETURNING id
            """,
            filename, byte_size, content_type, uploaded_by,
        )
    return str(row["id"])


async def replace_document_chunks(document_id: str, chunks: list[tuple[int, str, list[float]]]) -> None:
    """Deletes any existing chunks for the document and inserts the new set in one transaction, so a
    re-ingest of the same document id can't leave a half-written mix."""
    pool = await _get_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM rag_chunks WHERE document_id = $1", document_id)
        await conn.executemany(
            "INSERT INTO rag_chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4::vector)",
            [(document_id, idx, content, _vector_literal(emb)) for idx, content, emb in chunks],
        )
        await conn.execute(
            "UPDATE rag_documents SET chunk_count = $2, status = 'ready', error = NULL WHERE id = $1",
            document_id, len(chunks),
        )


async def mark_document_failed(document_id: str, message: str) -> None:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE rag_documents SET status = 'failed', error = $2 WHERE id = $1",
            document_id, message[:2000],
        )


async def list_documents() -> list[dict]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, filename, byte_size, content_type, chunk_count, status, error, uploaded_by, created_at
            FROM rag_documents
            ORDER BY created_at DESC
            """
        )
    return [
        {
            "id": str(r["id"]),
            "filename": r["filename"],
            "byteSize": r["byte_size"],
            "contentType": r["content_type"],
            "chunkCount": r["chunk_count"],
            "status": r["status"],
            "error": r["error"],
            "uploadedBy": r["uploaded_by"],
            "createdAt": r["created_at"].isoformat(),
        }
        for r in rows
    ]


async def delete_document(document_id: str) -> bool:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM rag_documents WHERE id = $1", document_id)
    # asyncpg returns e.g. "DELETE 1"
    return result.rsplit(" ", 1)[-1] != "0"


async def search(query_embedding: list[float], k: int) -> list[dict]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.content,
                   d.filename,
                   1 - (c.embedding <=> $1::vector) AS score
            FROM rag_chunks c
            JOIN rag_documents d ON d.id = c.document_id
            WHERE d.status = 'ready'
            ORDER BY c.embedding <=> $1::vector
            LIMIT $2
            """,
            _vector_literal(query_embedding), k,
        )
    return [{"content": r["content"], "filename": r["filename"], "score": float(r["score"])} for r in rows]


async def close_pool() -> None:
    global _pool, _bootstrapped
    if _pool is not None:
        await _pool.close()
        _pool = None
        _bootstrapped = False
