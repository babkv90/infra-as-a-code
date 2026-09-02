"""OpenAI embeddings for the knowledge base — same client, retry policy, and key check the
specialist LLM calls use (app/agents/base.py)."""

from __future__ import annotations

import asyncio
import logging

from app.agents.base import _LLM_BACKOFF_BASE_SECONDS, _LLM_MAX_ATTEMPTS, _RETRYABLE_OPENAI_ERRORS, _get_client, has_real_api_key
from app.config import settings

logger = logging.getLogger("agents.rag.embed")

_EMBED_BATCH = 96  # OpenAI accepts up to 2048 inputs/call; keep batches small so one retry is cheap


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of strings, preserving order. Batched, with the same exponential-backoff retry
    on transient OpenAI errors as call_llm."""
    if not has_real_api_key():
        raise RuntimeError("OPENAI_API_KEY is not configured (services/agents/.env)")
    if not texts:
        return []

    out: list[list[float]] = []
    for start in range(0, len(texts), _EMBED_BATCH):
        batch = texts[start:start + _EMBED_BATCH]
        out.extend(await _embed_one_batch(batch))
    return out


async def embed_query(text: str) -> list[float]:
    vectors = await embed_texts([text])
    return vectors[0]


async def _embed_one_batch(batch: list[str]) -> list[list[float]]:
    last_error: Exception | None = None
    for attempt in range(_LLM_MAX_ATTEMPTS):
        try:
            response = await _get_client().embeddings.create(model=settings.rag_embed_model, input=batch)
            return [item.embedding for item in response.data]
        except _RETRYABLE_OPENAI_ERRORS as exc:
            last_error = exc
            if attempt < _LLM_MAX_ATTEMPTS - 1:
                delay = _LLM_BACKOFF_BASE_SECONDS * (2**attempt)
                logger.warning("embedding batch failed (%s), retrying in %.1fs", type(exc).__name__, delay)
                await asyncio.sleep(delay)
    raise last_error  # type: ignore[misc]
