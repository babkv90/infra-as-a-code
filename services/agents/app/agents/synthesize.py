from app.agents.base import call_llm
from app.state import SpecialistResult

SYSTEM_PROMPT = """You combine multiple specialist agents' answers into one coherent, concise chat
reply for the user. Keep every concrete fact (node ids, dollar figures, Terraform addresses) each
specialist gave you — don't soften or generalize them away. Don't repeat the question back. Write
1-2 short paragraphs, plain prose, no headers.
"""


async def synthesize(question: str, results: list[SpecialistResult]) -> str:
    """Called by graph.py's synthesize_node. Skips the extra LLM call entirely when only one
    specialist ran (nothing to merge), and falls back to the raw concatenated specialist answers
    if the merge call itself fails — the user should never see an empty reply because of this step."""
    if not results:
        return "I wasn't able to get an answer from any agent for that question."

    if len(results) == 1:
        return results[0].content

    combined = "\n\n".join(f"[{r.agent}]: {r.content}" for r in results if r.content)
    if not combined:
        return "I wasn't able to get an answer from any agent for that question."

    try:
        return await call_llm(SYSTEM_PROMPT, f"Question: {question}\n\nSpecialist answers:\n{combined}")
    except Exception:  # noqa: BLE001 — fall back to the raw combined text rather than erroring the run
        return combined
