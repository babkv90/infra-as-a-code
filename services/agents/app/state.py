"""Shared state shapes for the multi-agent graph — mirrors infraflow-multi-agent-plan.pdf §1.4.
M1 added the specialist fan-out (results/findings). M2 (this pass) adds ChangePlan generation —
a read-only, human-reviewed proposal, not an apply path. Human-in-the-loop approval/interrupt()
is still not built; see app/graph.py's docstring."""

from typing import Annotated, Literal, TypedDict
from operator import add

from pydantic import BaseModel, Field

AgentName = Literal["architect", "terraform", "cost", "security"]


class Evidence(BaseModel):
    """Every claim must point at something that actually exists in the grounding bundle."""

    kind: Literal["node", "terraform_block"]
    ref: str  # a node id, or a `type.name` Terraform resource address


class Finding(BaseModel):
    agent: AgentName
    severity: Literal["info", "warning", "error"]
    title: str
    detail: str
    evidence: list[Evidence] = []


class SpecialistResult(BaseModel):
    agent: AgentName
    content: str
    findings: list[Finding] = []


ChangeOp = Literal["add_node", "update_node", "remove_node", "add_edge", "update_edge", "remove_edge"]


class ChangeItem(BaseModel):
    """One proposed edit. `target` is the node/edge id being changed or removed; `service_id` is
    required for add_node and must be one of the closed vocabulary in aws_services.json. `data` is
    a partial field patch (config keys for nodes, {source,target,...} for edges). Never applied
    automatically — see app/changeplan.py's mechanical gate."""

    op: ChangeOp
    target: str | None = None
    # serialized as "serviceId" over the wire — every other API field in this app is camelCase
    # (diagramId, findingsCount, activeRegion, ...), so this one follows suit via model_dump(by_alias=True)
    service_id: str | None = Field(default=None, serialization_alias="serviceId")
    data: dict = {}
    rationale: str
    evidence: list[Evidence] = []


class ChangePlan(BaseModel):
    summary: str
    items: list[ChangeItem] = []


class RunState(TypedDict, total=False):
    run_id: str
    diagram_id: str
    aws_account_id: str | None
    question: str
    history: list[dict]
    bearer_token: str
    grounding: dict  # serialized GroundingBundle-ish dict, see gateway.py
    dsl: str
    knowledge: list[dict]  # top-k knowledge-base chunks retrieved for this question (app/rag/); [] when RAG is off
    route: list[AgentName]
    route_reason: str
    results: Annotated[list[SpecialistResult], add]
    findings: Annotated[list[Finding], add]
    final_findings: list[Finding]  # evidence-gate output, written once by synthesize — no reducer
    final_content: str
    change_plan: ChangePlan | None  # written once by changeplan_node — no reducer
