"""The evidence gate from infraflow-multi-agent-plan.pdf §1.6(b): a Finding survives only if every
piece of evidence it cites points at something that actually exists in the grounding bundle given
to that run — never something the model invented.
"""

import re

from app.gateway import GroundingBundle
from app.state import Finding

# Mirrors terraformValidation.ts's own block-detection regex exactly (src/utils/terraformValidation.ts,
# validateGeneratedTerraform's duplicate-block check) — same semantics, ported for consistency rather
# than reinvented.
BLOCK_RE = re.compile(r'^\s*(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{')


def declared_resource_addresses(terraform: str) -> set[str]:
    """Extracts every `type.name` address declared in the generated Terraform, so evidence citing
    a terraform_block can be checked against what's real without a full HCL parser."""
    addresses = set()
    for line in terraform.splitlines():
        match = BLOCK_RE.match(line)
        if match:
            addresses.add(f"{match.group(2)}.{match.group(3)}")
    return addresses


def _normalize_ref(ref: str) -> str:
    # Defensive, not just prompt discipline (plan §1.6's whole point): models don't reliably
    # follow "no brackets" instructions, so strip the diagram DSL's own [node-id] marker syntax
    # here rather than silently rejecting an otherwise-correct citation.
    return ref.strip().strip("[]").strip()


def verify_evidence(finding: Finding, bundle: GroundingBundle) -> bool:
    """A finding survives only if it has at least one evidence entry AND every entry it cites
    resolves to a real node id or Terraform address in this run's own grounding bundle."""
    if not finding.evidence:
        return False

    node_ids = {n.get("id") for n in bundle.nodes}
    tf_addresses = declared_resource_addresses(bundle.terraform)

    for ev in finding.evidence:
        ref = _normalize_ref(ev.ref)
        if ev.kind == "node" and ref not in node_ids:
            return False
        if ev.kind == "terraform_block" and ref not in tf_addresses:
            return False

    return True


def apply_evidence_gate(findings: list[Finding], bundle: GroundingBundle) -> list[Finding]:
    """Called once by graph.py's synthesize_node on every finding collected from every specialist —
    the last line of defense against a model hallucinating a resource or Terraform block."""
    return [f for f in findings if verify_evidence(f, bundle)]
