"""Unit tests for app/changeplan.py's mechanical gate — no API key or network needed, mirrors
test_no_cloud_sdk.py's plain-pytest style (the only other test file in this service)."""

from app.changeplan import apply_change_plan_gate, verify_change_item
from app.gateway import GroundingBundle
from app.state import ChangeItem, ChangePlan

BUNDLE = GroundingBundle({
    "nodes": [{"id": "node-1"}, {"id": "node-2"}],
    "edges": [{"id": "edge-1"}],
    "terraform": "",
})


def test_add_node_requires_real_service_id():
    assert verify_change_item(ChangeItem(op="add_node", service_id="ec2", rationale="x"), BUNDLE)
    assert not verify_change_item(ChangeItem(op="add_node", service_id="made-up-service", rationale="x"), BUNDLE)


def test_update_and_remove_node_require_real_target():
    assert verify_change_item(ChangeItem(op="update_node", target="node-1", rationale="x"), BUNDLE)
    assert verify_change_item(ChangeItem(op="remove_node", target="node-2", rationale="x"), BUNDLE)
    assert not verify_change_item(ChangeItem(op="remove_node", target="node-does-not-exist", rationale="x"), BUNDLE)


def test_add_edge_requires_both_endpoints_real():
    ok = ChangeItem(op="add_edge", data={"source": "node-1", "target": "node-2"}, rationale="x")
    bad = ChangeItem(op="add_edge", data={"source": "node-1", "target": "ghost-node"}, rationale="x")
    assert verify_change_item(ok, BUNDLE)
    assert not verify_change_item(bad, BUNDLE)


def test_update_and_remove_edge_require_real_target():
    assert verify_change_item(ChangeItem(op="update_edge", target="edge-1", rationale="x"), BUNDLE)
    assert not verify_change_item(ChangeItem(op="remove_edge", target="edge-does-not-exist", rationale="x"), BUNDLE)


def test_gate_drops_only_invalid_items():
    plan = ChangePlan(
        summary="two proposals",
        items=[
            ChangeItem(op="update_node", target="node-1", rationale="real"),
            ChangeItem(op="update_node", target="ghost-node", rationale="hallucinated"),
        ],
    )
    gated = apply_change_plan_gate(plan, BUNDLE)
    assert len(gated.items) == 1
    assert gated.items[0].target == "node-1"
    assert gated.summary == "two proposals"
