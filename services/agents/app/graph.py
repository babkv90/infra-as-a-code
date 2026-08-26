"""The M1 LangGraph shape: ground -> supervisor -> Send[routed specialists] (parallel) ->
synthesize -> END. See infraflow-multi-agent-plan.pdf §1.3; Redis/checkpointer/interrupt() are
M2 concerns (human-approval pause/resume) and aren't needed for this in-memory, no-pause graph.
"""

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.agents import architect, cost, security, supervisor, synthesize, terraform
from app.dsl import build_dsl
from app.evidence import apply_evidence_gate
from app.gateway import GroundingBundle, fetch_grounding
from app.state import RunState

SPECIALIST_NODES = ["architect", "terraform", "cost", "security"]


# Each *_node function below is one node in the LangGraph state machine. A node takes the current
# RunState and returns a partial dict of fields to merge into it (see app/state.py's Annotated
# reducers for how "results"/"findings" accumulate across the parallel specialist nodes rather
# than overwrite each other).

async def ground_node(state: RunState) -> dict:
    """Entry node: fetches the diagram/Terraform/validation bundle from Express in one call and
    projects it into the compact text DSL every downstream LLM prompt is built from."""
    bundle = await fetch_grounding(state["diagram_id"], state["bearer_token"], include=["awsInsights"])
    return {"grounding": bundle.raw, "dsl": build_dsl(bundle)}


async def supervisor_node(state: RunState) -> dict:
    """Asks the router LLM call which specialists this question needs, given a one-line summary
    of the diagram (not the full DSL — routing doesn't need per-node detail)."""
    bundle = GroundingBundle(state["grounding"])
    errors = sum(1 for v in bundle.validation if v.get("severity") == "error")
    warnings = sum(1 for v in bundle.validation if v.get("severity") == "warning")
    summary = f"{len(bundle.nodes)} resources, region={bundle.active_region}, {errors} error(s)/{warnings} warning(s)"
    route, reason = await supervisor.route(state["question"], summary)
    return {"route": route, "route_reason": reason}


def fan_out_router(state: RunState) -> list[Send]:
    """Conditional edge out of supervisor_node: turns the chosen agent names into LangGraph
    Send() objects so each routed specialist runs as its own parallel branch of the graph."""
    return [Send(agent, state) for agent in state["route"]]


async def architect_node(state: RunState) -> dict:
    result = await architect.run(state["question"], state["dsl"], state["history"])
    return {"results": [result], "findings": result.findings}


async def terraform_node(state: RunState) -> dict:
    result = await terraform.run(state["question"], state["dsl"], state["history"])
    return {"results": [result], "findings": result.findings}


async def security_node(state: RunState) -> dict:
    result = await security.run(state["question"], state["dsl"], state["history"])
    return {"results": [result], "findings": result.findings}


async def cost_node(state: RunState) -> dict:
    # Only the cost specialist needs aws_insights (billing data), so it's the only node that pulls
    # it back out of the grounding bundle rather than every specialist carrying it.
    bundle = GroundingBundle(state["grounding"])
    result = await cost.run(state["question"], state["dsl"], state["history"], bundle.aws_insights)
    return {"results": [result], "findings": result.findings}


async def synthesize_node(state: RunState) -> dict:
    """Fan-in node: every routed specialist's edge points here. Drops any finding whose evidence
    doesn't check out (app/evidence.py), then asks an LLM to merge the surviving specialist
    answers into one chat reply."""
    bundle = GroundingBundle(state["grounding"])
    final_findings = apply_evidence_gate(state.get("findings", []), bundle)
    content = await synthesize.synthesize(state["question"], state.get("results", []))
    return {"final_findings": final_findings, "final_content": content}


def build_graph():
    """Wires the nodes above into the ground -> supervisor -> Send[specialists] -> synthesize ->
    END shape and compiles it. Called once at import time in app/runner.py; the compiled graph is
    reused for every run rather than rebuilt per-request."""
    builder = StateGraph(RunState)
    builder.add_node("ground", ground_node)
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("architect", architect_node)
    builder.add_node("terraform", terraform_node)
    builder.add_node("cost", cost_node)
    builder.add_node("security", security_node)
    builder.add_node("synthesize", synthesize_node)

    builder.add_edge(START, "ground")
    builder.add_edge("ground", "supervisor")
    builder.add_conditional_edges("supervisor", fan_out_router, SPECIALIST_NODES)
    for node in SPECIALIST_NODES:
        builder.add_edge(node, "synthesize")
    builder.add_edge("synthesize", END)

    return builder.compile()
