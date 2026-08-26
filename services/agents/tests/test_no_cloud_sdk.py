"""Turns infraflow-multi-agent-plan.pdf §0's architectural intention ("the agent service holds the
reasoning, the Node backend holds the keys") into a build-breaking invariant instead of a comment
someone can forget. Run via `pytest` locally; wiring this into CI is a natural follow-up once a
workflow exists that touches this service (none does yet — see the M0 plan's Context section).
"""

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN_PATTERN = re.compile(r"\b(boto3|pymongo|motor|aws[-_]sdk)\b", re.IGNORECASE)


def _scan(paths):
    hits = []
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="ignore")
        if FORBIDDEN_PATTERN.search(text):
            hits.append(str(path))
    return hits


def test_no_cloud_or_db_sdk_in_app():
    app_files = list((SERVICE_ROOT / "app").rglob("*.py"))
    hits = _scan(app_files)
    assert not hits, f"Forbidden cloud/DB SDK reference found in: {hits}"


def test_no_cloud_or_db_sdk_in_requirements():
    requirements = SERVICE_ROOT / "requirements.txt"
    hits = _scan([requirements])
    assert not hits, f"Forbidden cloud/DB SDK dependency found in: {hits}"
