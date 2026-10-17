"""Drives app/planfix/agent.py's loop with a scripted model and an in-memory stand-in for Express —
no API key or network needed. Covers pause/resume around a plan, the finish gate's rejection
path, and the step budget."""

import asyncio
import json
from types import SimpleNamespace

from app.planfix.agent import PlanFixSession, plan_result_payload
from app.planfix.hcl import extract_block, list_addresses

TERRAFORM = """provider "aws" {
  region = "ap-south-1"
}

resource "aws_db_instance" "orders_db" {
  engine = "postgres"
  tags = { Name = "a{b}" }
}

data "aws_ami" "al2023" {
  most_recent = true
}
"""


def base_state(**overrides):
    state = {
        "diagramName": "Shop",
        "activeRegion": "ap-south-1",
        "revision": 0,
        "nodes": [{"id": "db-1", "type": "awsService", "data": {"serviceId": "rds", "label": "Orders DB", "config": {"engine": "postgres"}}}],
        "edges": [],
        "terraform": TERRAFORM,
        "staticIssues": [],
        "planRuns": [],
        "appliedChangeCount": 0,
        "limits": {"maxPlanRuns": 5, "maxChangeItems": 40, "maxAgentTurns": 40},
        "agent": {"messages": [], "pendingToolCallId": None, "turns": 0},
    }
    state.update(overrides)
    return state


class FakeGateway:
    def __init__(self, finish_accepts=True):
        self.calls = []
        self.finish_accepts = finish_accepts

    async def post_run_step(self, run_id, token, event):
        self.calls.append(("step", event))

    async def fix_get_state(self, run_id, token):
        return base_state()

    async def fix_apply_changes(self, run_id, token, items):
        self.calls.append(("changes", items))
        return {"applied": [{"index": 0, "op": items[0]["op"], "target": items[0].get("target")}], "rejected": [], "revision": 1, "terraform": TERRAFORM, "staticIssues": []}

    async def fix_request_plan(self, run_id, token, messages, tool_call_id, turns):
        self.calls.append(("plan", {"messages": list(messages), "tool_call_id": tool_call_id, "turns": turns}))
        return {"suspended": True, "planIndex": 0}

    async def fix_finish(self, run_id, token, outcome, summary, messages, turns):
        self.calls.append(("finish", {"outcome": outcome, "summary": summary}))
        if outcome == "passed" and not self.finish_accepts:
            return {"accepted": False, "reason": "latest plan did not pass"}
        return {"accepted": True}


def scripted_llm(script):
    """Each script entry is (content, [(tool_name, args_dict), ...]). Records what the model saw."""
    seen = []
    counter = iter(range(1000))

    async def llm(messages, tools, model):
        seen.append([dict(m) for m in messages])
        content, calls = script.pop(0)
        return SimpleNamespace(
            content=content,
            tool_calls=[
                SimpleNamespace(id=f"call_{next(counter)}", function=SimpleNamespace(name=name, arguments=json.dumps(args)))
                for name, args in calls
            ],
        )

    llm.seen = seen
    return llm


def run(session):
    return asyncio.run(session.run())


def test_first_invocation_edits_then_pauses_on_plan():
    gateway = FakeGateway()
    llm = scripted_llm([
        ("Engine version is missing; setting it.", [("apply_changes", {"items": [{"op": "update_node", "target": "db-1", "data": {"config": {"engine_version": "16"}}, "rationale": "x"}]})]),
        ("Planning now.", [("run_terraform_plan", {})]),
    ])
    session = PlanFixSession("run-1", "tok", base_state(), gateway=gateway, llm=llm)

    assert run(session) == "suspended"
    kinds = [kind for kind, _ in gateway.calls]
    assert kinds == ["step", "changes", "step", "plan"]
    plan_call = gateway.calls[-1][1]
    # The persisted transcript ends with the assistant's plan tool call, awaiting its result.
    assert plan_call["messages"][-1]["tool_calls"][0]["id"] == plan_call["tool_call_id"]
    assert plan_call["turns"] == 2
    # The kickoff message carried the full draft, including every config key.
    assert "engine=postgres" in llm.seen[0][1]["content"]


def test_resume_feeds_plan_result_then_finishes():
    paused = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "kickoff"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call_9", "type": "function", "function": {"name": "run_terraform_plan", "arguments": "{}"}}]},
    ]
    state = base_state(
        revision=1,
        planRuns=[{"index": 0, "revision": 1, "status": "passed", "diagnostics": [], "changeSummary": {"add": 3, "change": 0, "remove": 0}}],
        agent={"messages": paused, "pendingToolCallId": "call_9", "turns": 2},
    )
    gateway = FakeGateway()
    llm = scripted_llm([("Plan passes.", [("finish", {"outcome": "passed", "summary": "Set engine_version on db-1."})])])

    assert run(PlanFixSession("run-1", "tok", state, gateway=gateway, llm=llm)) == "finished"
    tool_reply = llm.seen[0][-1]
    assert tool_reply["role"] == "tool" and tool_reply["tool_call_id"] == "call_9"
    assert json.loads(tool_reply["content"])["status"] == "passed"
    assert gateway.calls[-1] == ("finish", {"outcome": "passed", "summary": "Set engine_version on db-1."})


def test_rejected_finish_is_returned_to_the_agent():
    gateway = FakeGateway(finish_accepts=False)
    llm = scripted_llm([
        ("Done.", [("finish", {"outcome": "passed", "summary": "claimed"})]),
        ("I can't claim that.", [("finish", {"outcome": "gave_up", "summary": "needs a plan"})]),
    ])

    assert run(PlanFixSession("run-1", "tok", base_state(), gateway=gateway, llm=llm)) == "finished"
    rejection = llm.seen[1][-1]
    assert rejection["role"] == "tool" and "latest plan did not pass" in rejection["content"]


def test_model_without_tool_call_is_nudged():
    gateway = FakeGateway()
    llm = scripted_llm([
        ("Thinking out loud.", []),
        ("", [("finish", {"outcome": "gave_up", "summary": "x"})]),
    ])

    run(PlanFixSession("run-1", "tok", base_state(), gateway=gateway, llm=llm))
    assert llm.seen[1][-1]["role"] == "user"


def test_turn_budget_forces_gave_up():
    state = base_state(limits={"maxPlanRuns": 5, "maxChangeItems": 40, "maxAgentTurns": 2})
    gateway = FakeGateway()
    llm = scripted_llm([("", [("view_draft", {})]), ("", [("view_draft", {})])])

    assert run(PlanFixSession("run-1", "tok", state, gateway=gateway, llm=llm)) == "finished"
    assert gateway.calls[-1][1]["outcome"] == "gave_up"


def test_get_terraform_block_and_unknown_address():
    gateway = FakeGateway()
    llm = scripted_llm([
        ("", [("get_terraform_block", {"address": "aws_db_instance.orders_db"})]),
        ("", [("get_terraform_block", {"address": "aws_s3_bucket.nope"})]),
        ("", [("finish", {"outcome": "gave_up", "summary": "x"})]),
    ])
    run(PlanFixSession("run-1", "tok", base_state(), gateway=gateway, llm=llm))

    found = json.loads(llm.seen[1][-1]["content"])
    assert found["hcl"].startswith('resource "aws_db_instance" "orders_db"') and found["hcl"].endswith("}")
    missing = json.loads(llm.seen[2][-1]["content"])
    assert "aws_db_instance.orders_db" in missing["addresses"]


def test_hcl_helpers_handle_braces_in_strings_and_data_blocks():
    assert list_addresses(TERRAFORM) == ["aws_db_instance.orders_db", "data.aws_ami.al2023"]
    block = extract_block(TERRAFORM, "aws_db_instance.orders_db")
    assert block.count("\n") == 3  # the "a{b}" string must not unbalance the brace count
    assert extract_block(TERRAFORM, "data.aws_ami.al2023").startswith('data "aws_ami"')


def test_plan_error_payload_tells_the_agent_it_is_not_a_config_problem():
    state = base_state(planRuns=[{"index": 0, "revision": 0, "status": "error", "error": "terraform binary missing"}])
    payload = plan_result_payload(state)
    assert payload["status"] == "error" and "not the configuration" in payload["note"]
