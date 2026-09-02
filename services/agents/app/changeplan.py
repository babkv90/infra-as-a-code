"""The ChangePlan gate — same mechanical, not-prompt-based philosophy as app/evidence.py's finding
gate: a proposed edit survives only if the thing it targets (or, for a new node, the service type
it proposes) actually exists in this run's own grounding bundle or the closed AWS-resource
vocabulary. This is what keeps ChangePlan generation from being pure prompt trust — the model can
propose whatever it wants, only real targets and real service ids make it into what the user sees.
"""

from app.gateway import GroundingBundle
from app.state import ChangeItem, ChangePlan
from app.tools.aws_catalog import valid_service_ids


def verify_change_item(item: ChangeItem, bundle: GroundingBundle) -> bool:
    node_ids = {n.get("id") for n in bundle.nodes}

    if item.op == "add_node":
        return item.service_id in valid_service_ids()
    if item.op in ("update_node", "remove_node"):
        return item.target in node_ids
    if item.op == "add_edge":
        source, target = item.data.get("source"), item.data.get("target")
        return source in node_ids and target in node_ids
    if item.op in ("update_edge", "remove_edge"):
        edge_ids = {e.get("id") for e in bundle.edges}
        return item.target in edge_ids

    return False


def apply_change_plan_gate(plan: ChangePlan, bundle: GroundingBundle) -> ChangePlan:
    """Called once by graph.py's changeplan_node on every item the model proposed — drops anything
    citing a node/edge id or service_id that isn't real, same as apply_evidence_gate does for
    findings."""
    return ChangePlan(summary=plan.summary, items=[i for i in plan.items if verify_change_item(i, bundle)])
