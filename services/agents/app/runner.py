"""Runs a graph invocation as a background asyncio task and reports progress back to Express as
it happens — Express is the single source of truth the browser polls; this module never talks to
the browser directly. See infraflow-multi-agent-plan.pdf's RunBudget (§1.4) for MAX_WALL_SECONDS.
"""

import asyncio

from app.gateway import post_run_complete, post_run_step
from app.graph import SPECIALIST_NODES, build_graph
from app.state import RunState

MAX_WALL_SECONDS = 60

_graph = build_graph()
_background_tasks: set[asyncio.Task] = set()


def execute_run(run_id: str, bearer_token: str, diagram_id: str, question: str, history: list[dict]) -> None:
    """Fire-and-forget: schedules the run and returns immediately. Keeps a strong reference to the
    task in a module-level set (discarded on completion) so it can't be garbage-collected mid-run —
    a well-known asyncio footgun for tasks nothing else awaits.

    This is the uvicorn/long-running-container path (app/main.py -> routes_runs.start_run). The
    Lambda path uses execute_run_sync() instead — see its docstring for why.
    """
    task = asyncio.create_task(_run(run_id, bearer_token, diagram_id, question, history))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def execute_run_sync(run_id: str, bearer_token: str, diagram_id: str, question: str, history: list[dict]) -> None:
    """Await the whole run to completion. For the Lambda entrypoint (app/lambda_handler.py): Lambda
    freezes the execution environment the instant the handler returns, so a fire-and-forget
    create_task like execute_run() uses would simply never run. _run() already owns the wall-clock
    budget (MAX_WALL_SECONDS) and always posts a terminal status back to Express, so this only has
    to wait for it — any exception here means _run itself couldn't even report, and is left to
    propagate to Lambda's async-invoke retry + dead-letter queue.
    """
    await _run(run_id, bearer_token, diagram_id, question, history)


async def _run(run_id: str, bearer_token: str, diagram_id: str, question: str, history: list[dict]) -> None:
    initial_state: RunState = {
        "run_id": run_id,
        "diagram_id": diagram_id,
        "question": question,
        "history": history,
        "bearer_token": bearer_token,
        "results": [],
        "findings": [],
        "route": [],
    }
    try:
        await asyncio.wait_for(_stream_and_report(run_id, bearer_token, initial_state), timeout=MAX_WALL_SECONDS)
    except asyncio.TimeoutError:
        await post_run_complete(
            run_id, bearer_token,
            "This run took longer than expected and was stopped partway through — try a narrower question.",
            {"error": "budget_exceeded"}, status="failed",
        )
    except Exception as exc:  # noqa: BLE001 — always resolve the run, never leave it stuck 'running'
        await post_run_complete(run_id, bearer_token, f"The agent run failed: {exc}", {"error": "run_failed"}, status="failed")


async def _stream_and_report(run_id: str, bearer_token: str, initial_state: RunState) -> None:
    """Drives the compiled graph node-by-node via astream(..., stream_mode="updates"), translating
    each node's completion into one post_run_step callback so the browser's AgentRunTimeline can
    show routing/specialist progress live instead of just a spinner until the final answer."""
    final_content = ""
    final_metadata: dict = {}

    async for update in _graph.astream(initial_state, stream_mode="updates"):
        # `update` maps the node name that just finished -> the partial state dict it returned
        # (see the *_node functions in app/graph.py); translate that into a step event Express
        # can store and the frontend can render.
        for node_name, delta in update.items():
            if node_name == "ground":
                await post_run_step(run_id, bearer_token, {"type": "grounding.ready"})
            elif node_name == "supervisor":
                await post_run_step(run_id, bearer_token, {
                    "type": "route.decided",
                    "route": delta.get("route", []),
                    "reason": delta.get("route_reason", ""),
                })
            elif node_name in SPECIALIST_NODES:
                for result in delta.get("results", []):
                    await post_run_step(run_id, bearer_token, {
                        "type": "agent.finished",
                        "agent": result.agent,
                        "summary": (result.content or "")[:180],
                        "findingsCount": len(result.findings),
                    })
            elif node_name == "synthesize":
                final_content = delta.get("final_content", "")
                final_metadata = {"findings": [f.model_dump() for f in delta.get("final_findings", [])]}
            elif node_name == "changeplan":
                plan = delta.get("change_plan")
                await post_run_step(run_id, bearer_token, {
                    "type": "changeplan.ready",
                    "itemCount": len(plan.items) if plan else 0,
                })
                final_metadata["changePlan"] = plan.model_dump(by_alias=True) if plan else None

    await post_run_complete(run_id, bearer_token, final_content, final_metadata)
