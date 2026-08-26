"""Shared state shapes for the M1 multi-agent graph — mirrors
infraflow-multi-agent-plan.pdf §1.4, scoped to what M1 actually needs (no ChangePlan/approval
yet, those are M2)."""

from typing import Annotated, Literal, TypedDict
from operator import add

from pydantic import BaseModel

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


class RunState(TypedDict, total=False):
    run_id: str
    diagram_id: str
    aws_account_id: str | None
    question: str
    history: list[dict]
    bearer_token: str
    grounding: dict  # serialized GroundingBundle-ish dict, see gateway.py
    dsl: str
    route: list[AgentName]
    route_reason: str
    results: Annotated[list[SpecialistResult], add]
    findings: Annotated[list[Finding], add]
    final_findings: list[Finding]  # evidence-gate output, written once by synthesize — no reducer
    final_content: str
