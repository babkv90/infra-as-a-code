import asyncio
import json
import logging

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)

from app.config import settings

logger = logging.getLogger("agents.llm")

# Transient OpenAI failures — a 429, a 5xx, a dropped connection, a timeout — are the single most
# common cause of a run failing in practice, and they usually clear within a second or two. Retry
# a few times with exponential backoff before giving up; anything else (a 400, an auth error, a
# bad request) is not retryable and propagates immediately.
_RETRYABLE_OPENAI_ERRORS = (RateLimitError, APITimeoutError, APIConnectionError, InternalServerError)
_LLM_MAX_ATTEMPTS = 3
_LLM_BACKOFF_BASE_SECONDS = 0.75

# Shared JSON output contract every specialist's system prompt ends with — one call produces both
# the chat-readable answer and the structured, evidence-carrying findings the evidence gate checks.
FINDING_JSON_INSTRUCTIONS = """
Respond with a single JSON object, no other text, shaped exactly like this:
{
  "content": "<your concise chat-readable answer to the question, 1-4 sentences>",
  "findings": [
    {
      "severity": "info" | "warning" | "error",
      "title": "<short title>",
      "detail": "<one sentence>",
      "evidence": [{"kind": "node" | "terraform_block", "ref": "<the node id WITHOUT brackets, e.g. tpl-starter-ec2 not [tpl-starter-ec2]; or a real type.name Terraform address>"}]
    }
  ]
}
"findings" may be an empty list if you have nothing specific to flag. Every finding MUST have at
least one evidence entry. "ref" is the bare id/address only — strip the surrounding [brackets] the
diagram block uses to mark node ids, never include them. Never cite a node id or Terraform address
you didn't see in the diagram block below.
"""

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def has_real_api_key() -> bool:
    """False for an unset key or the placeholder committed in .env.example — used to fail fast
    with a clear error instead of letting the OpenAI SDK raise its own less obvious one."""
    return bool(settings.openai_api_key) and not settings.openai_api_key.startswith("sk-replace")


async def call_llm(system_prompt: str, user_content: str, history: list[dict] | None = None, json_mode: bool = False, model: str | None = None) -> str:
    """Thin wrapper over one Chat Completions call: builds the messages array (system prompt +
    prior turns + this turn's content) and returns the raw text/JSON-string response. Every
    specialist and the router go through this rather than calling the OpenAI SDK directly."""
    if not has_real_api_key():
        raise RuntimeError("OPENAI_API_KEY is not configured (services/agents/.env)")

    messages = [{"role": "system", "content": system_prompt}]
    for turn in history or []:
        if turn.get("role") in ("user", "assistant"):
            messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": user_content})

    request_kwargs = {
        "model": model or settings.openai_agent_model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"} if json_mode else {"type": "text"},
    }

    last_error: Exception | None = None
    for attempt in range(_LLM_MAX_ATTEMPTS):
        try:
            completion = await _get_client().chat.completions.create(**request_kwargs)
            return completion.choices[0].message.content or ""
        except _RETRYABLE_OPENAI_ERRORS as exc:
            last_error = exc
            if attempt < _LLM_MAX_ATTEMPTS - 1:
                delay = _LLM_BACKOFF_BASE_SECONDS * (2**attempt)
                logger.warning(
                    "OpenAI call failed (%s), retrying in %.1fs [attempt %d/%d]",
                    type(exc).__name__, delay, attempt + 1, _LLM_MAX_ATTEMPTS,
                )
                await asyncio.sleep(delay)

    raise last_error  # type: ignore[misc]  # unreachable with last_error None — the loop either returns or sets it


async def call_llm_json(system_prompt: str, user_content: str) -> dict:
    """call_llm in JSON mode with the parse step folded in — malformed JSON becomes an empty
    dict rather than an exception, so callers (e.g. supervisor.route) just check for missing keys."""
    raw = await call_llm(system_prompt, user_content, json_mode=True)
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


async def run_specialist(agent_name, system_prompt: str, question: str, dsl: str, history: list[dict], extra_context: str = ""):
    """Shared body for every specialist: one JSON-mode LLM call producing {content, findings},
    with a graceful fallback SpecialistResult on any failure so one specialist's error can't sink
    the whole parallel fan-out.
    """
    from app.state import Finding, SpecialistResult  # local import avoids a circular import at module load

    extra_block = f"\n\n{extra_context}" if extra_context else ""
    user_content = f"<diagram>\n{dsl}\n</diagram>{extra_block}\n\nQuestion: {question}"
    try:
        raw = await call_llm(system_prompt + FINDING_JSON_INSTRUCTIONS, user_content, history=history, json_mode=True)
        parsed = json.loads(raw)
        findings = [Finding(agent=agent_name, **f) for f in parsed.get("findings", [])]
        return SpecialistResult(agent=agent_name, content=parsed.get("content", ""), findings=findings)
    except Exception as exc:  # noqa: BLE001 — one specialist's failure must not sink the whole run
        return SpecialistResult(agent=agent_name, content=f"The {agent_name} agent hit an error: {exc}", findings=[])
