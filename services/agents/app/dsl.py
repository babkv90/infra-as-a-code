"""Projects a GroundingBundle into the compact line-oriented DSL from
infraflow-multi-agent-plan.pdf §2.2(b) — strips visual/layout state, keeps node ids in [brackets]
so citing them correctly is the path of least resistance for the model. M0 skips the semantic
view-filtering step (§2.2a, buildVisibleGraph) — there's only one agent so far and no context
budget pressure yet; that arrives in M1 when multiple specialists share a context budget.
"""

from app.gateway import GroundingBundle

MAX_CONFIG_ENTRIES_PER_NODE = 6


def build_dsl(bundle: GroundingBundle) -> str:
    lines = [f"# diagram: {bundle.diagram_name or bundle.diagram_id} region={bundle.active_region} digest={bundle.digest[:12]}"]

    service_nodes = [n for n in bundle.nodes if n.get("type") != "groupBox" and n.get("data", {}).get("serviceId")]
    for node in service_nodes:
        data = node.get("data", {})
        config = data.get("config") or {}
        config_str = " ".join(f"{k}={v}" for k, v in list(config.items())[:MAX_CONFIG_ENTRIES_PER_NODE] if v not in (None, ""))
        label = data.get("label") or data.get("serviceName") or node.get("id")
        lines.append(f'[{node.get("id")}] {data.get("serviceId")} "{label}" {config_str}'.rstrip())

    if bundle.edges:
        lines.append("")
        node_labels = {n.get("id"): (n.get("data", {}).get("label") or n.get("id")) for n in bundle.nodes}
        for edge in bundle.edges:
            edge_data = edge.get("data", {})
            category = edge_data.get("connectionType", "data")
            protocol = edge_data.get("protocol") or edge_data.get("label") or ""
            src = edge.get("source")
            dst = edge.get("target")
            suffix = f" ({protocol})" if protocol else ""
            lines.append(f"{src} --{category}--> {dst}{suffix}")

    if bundle.validation:
        errors = sum(1 for v in bundle.validation if v.get("severity") == "error")
        warnings = sum(1 for v in bundle.validation if v.get("severity") == "warning")
        lines.append("")
        lines.append(f"!! validation: {errors} error(s), {warnings} warning(s)")
        for issue in bundle.validation:
            node_ref = f'[{issue["nodeId"]}] ' if issue.get("nodeId") else ""
            lines.append(f'{node_ref}{issue.get("severity")}: {issue.get("message")}')
    else:
        lines.append("")
        lines.append("!! validation: 0 errors, 0 warnings")

    return "\n".join(lines)
