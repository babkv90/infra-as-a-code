import json

from openai import AsyncOpenAI

from app.config import settings

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

    completion = await _get_client().chat.completions.create(
        model=model or settings.openai_agent_model,
        messages=messages,
        temperature=0.2,
        response_format={"type": "json_object"} if json_mode else {"type": "text"},
    )
    return completion.choices[0].message.content or ""


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
