import asyncio

import httpx

from app.config import settings

GATEWAY_TIMEOUT_SECONDS = 30.0


class GroundingBundle:
    """Everything an agent needs about one diagram, fetched in a single batched call.

    Mirrors infraflow-multi-agent-plan.pdf §1.5's GroundingBundle. `.raw` is kept so the whole
    thing round-trips cleanly through LangGraph state (a plain dict) without a second fetch.
    """

    def __init__(self, data: dict):
        self.raw: dict = data
        self.diagram_id: str = data.get("diagramId", "")
        self.diagram_name: str = data.get("diagramName", "")
        self.nodes: list[dict] = data.get("nodes", [])
        self.edges: list[dict] = data.get("edges", [])
        self.active_region: str = data.get("activeRegion", "")
        self.digest: str = data.get("digest", "")
        self.terraform: str = data.get("terraform", "")
        self.validation: list[dict] = data.get("validation", [])
        self.plan: dict = data.get("plan", {})
        self.aws_insights: dict | None = data.get("awsInsights")


def _base_url() -> str:
    return settings.express_internal_url.rstrip("/")


async def fetch_grounding(diagram_id: str, bearer_token: str, include: list[str] | None = None) -> GroundingBundle:
    """Calls Express's POST /internal/agent-tools/grounding — the single batched fetch a run makes
    per turn (see internalAgentToolsController.js's getGrounding). `include` is currently only used
    to opt into `awsInsights`, which Express itself re-checks against the token's own scopes."""
    async with httpx.AsyncClient(timeout=GATEWAY_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{_base_url()}/internal/agent-tools/grounding",
            json={"diagramId": diagram_id, "include": include or []},
            headers={"Authorization": f"Bearer {bearer_token}"},
        )
        response.raise_for_status()
        return GroundingBundle(response.json().get("data", {}))


async def post_run_step(run_id: str, bearer_token: str, event: dict) -> None:
    """Reports one progress event (grounding.ready / route.decided / agent.finished — see
    app/runner.py) to Express's postRunStep. Best-effort: swallows failures, see the comment below."""
    async with httpx.AsyncClient(timeout=GATEWAY_TIMEOUT_SECONDS) as client:
        try:
            response = await client.post(
                f"{_base_url()}/internal/agent-tools/runs/{run_id}/steps",
                json={"event": event},
                headers={"Authorization": f"Bearer {bearer_token}"},
            )
            response.raise_for_status()
        except httpx.HTTPError:
            pass  # a missed progress update must never abort the run itself — the timeline just
            # skips a row; the terminal post_run_complete call below is the one that must not be lost


# The run's single terminal callback — if this is lost, the browser polls a run stuck at
# 'running' forever with no way to recover, so (unlike post_run_step) this retries rather than
# swallowing a failure. Express's own postRunComplete now uses an atomic findOneAndUpdate
# specifically so this call can never lose a race with the last specialist's step post, but retry
# here too as a second line of defense against any other transient failure (e.g. a brief Express
# restart).
async def post_run_complete(run_id: str, bearer_token: str, content: str, metadata: dict, status: str = "completed") -> None:
    payload = {"status": status, "content": content, "metadata": metadata}
    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=GATEWAY_TIMEOUT_SECONDS) as client:
        for attempt in range(3):
            try:
                response = await client.post(
                    f"{_base_url()}/internal/agent-tools/runs/{run_id}/complete",
                    json=payload,
                    headers={"Authorization": f"Bearer {bearer_token}"},
                )
                response.raise_for_status()
                return
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))

    # All retries exhausted — nothing left to do but log; there's no one left to tell that the run
    # is stuck, since this callback IS the mechanism for telling Express the run is done.
    print(f"[agents] post_run_complete failed after retries for run {run_id}: {last_error}")
