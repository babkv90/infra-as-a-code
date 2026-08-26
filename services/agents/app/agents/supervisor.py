from app.agents.base import call_llm_json

SYSTEM_PROMPT = """You are the routing supervisor for infraflow's multi-agent AWS assistant. Given
a user's question and a one-line summary of their diagram, decide which specialist agents should
answer it. Available agents:
- "architect": overall structure, topology, whether the design makes sense
- "terraform": generated Terraform HCL correctness, missing fields, bindings
- "cost": spend, waste, rightsizing, billing
- "security": security risk, public exposure, encryption, IAM-adjacent diagram config

Respond with a JSON object only: {"route": ["architect", ...], "reason": "<one sentence>"}.
Pick every agent whose domain the question actually touches — a broad question like "review this
architecture" should route to multiple agents. A narrow question should route to just one. Always
include at least one agent.
"""

VALID_AGENTS = {"architect", "terraform", "cost", "security"}


async def route(question: str, diagram_summary: str) -> tuple[list[str], str]:
    """Called by graph.py's supervisor_node. Asks the LLM which specialists apply, filters the
    response down to known agent names (never trust the model to only name valid ones), and falls
    back to routing to "architect" alone on any failure or empty/invalid response — a run must
    always have at least one specialist to fan out to."""
    try:
        parsed = await call_llm_json(SYSTEM_PROMPT, f"Diagram summary: {diagram_summary}\n\nQuestion: {question}")
        route_list = [a for a in parsed.get("route", []) if a in VALID_AGENTS]
        reason = parsed.get("reason", "")
        if route_list:
            return route_list, reason
    except Exception:  # noqa: BLE001 — routing failure must never sink the run
        pass
    return ["architect"], "Fallback: defaulted to the architect agent."
