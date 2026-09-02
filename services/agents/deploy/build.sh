#!/usr/bin/env bash
# Builds the deployment zip for the infraflow-agents Lambda.
#
# Output: services/agents/deploy/build/agent-lambda.zip  — the app/ package plus every runtime
# dependency from requirements.txt, with Linux (manylinux) wheels so native packages (pydantic-core,
# cryptography) load on Lambda's Amazon Linux runtime.
#
# It is a single fat zip, not a function zip + a separate dependency layer: the visual builder's
# Lambda node (src/data/awsServices.ts) only exposes `filename` — it can't attach a layer — and this
# artifact is meant to be uploaded through that node. Functionally identical, just one bigger file.
# (~15-25 MB zipped, well under the 50 MB direct-upload limit and the 250 MB unzipped limit.)
#
# Usage:
#   services/agents/deploy/build.sh                 # uses Docker if available, else pip --platform
#   AGENT_BUILD_NO_DOCKER=1 services/agents/deploy/build.sh   # force the pip --platform path
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${SERVICE_DIR}/deploy/build"
STAGE_DIR="${BUILD_DIR}/stage"
ZIP_PATH="${BUILD_DIR}/agent-lambda.zip"
PY_VERSION="3.12"
PLATFORM="manylinux2014_x86_64"   # matches a Lambda function whose Architecture is x86_64

echo "==> Cleaning ${BUILD_DIR}"
rm -rf "${BUILD_DIR}"
mkdir -p "${STAGE_DIR}"

# requirements.txt carries pytest as a dev-only line — strip it (and blank/comment lines) so it
# never lands in the deployment package.
RUNTIME_REQS="${BUILD_DIR}/requirements-runtime.txt"
grep -vE '^\s*(#|$)' "${SERVICE_DIR}/requirements.txt" | grep -viE '^\s*pytest\b' > "${RUNTIME_REQS}"

if [[ -z "${AGENT_BUILD_NO_DOCKER:-}" ]] && command -v docker >/dev/null 2>&1; then
  echo "==> Installing dependencies with the AWS SAM build image (Docker)"
  docker run --rm \
    -v "${SERVICE_DIR}:/src:ro" \
    -v "${STAGE_DIR}:/out" \
    --entrypoint /bin/sh \
    "public.ecr.aws/sam/build-python${PY_VERSION}:latest" \
    -c "pip install --no-cache-dir -r /src/deploy/build/requirements-runtime.txt -t /out"
else
  echo "==> Installing dependencies with pip --platform ${PLATFORM} (no Docker)"
  python -m pip install --no-cache-dir \
    --platform "${PLATFORM}" \
    --python-version "${PY_VERSION}" \
    --implementation cp \
    --only-binary=:all: \
    --target "${STAGE_DIR}" \
    -r "${RUNTIME_REQS}"
fi

echo "==> Adding the app/ package"
cp -R "${SERVICE_DIR}/app" "${STAGE_DIR}/app"

echo "==> Pruning bytecode / test / metadata cruft"
find "${STAGE_DIR}" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "${STAGE_DIR}" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true
find "${STAGE_DIR}" -type d -name '*.dist-info' -prune -exec rm -rf {} + 2>/dev/null || true
find "${STAGE_DIR}" -type f -name '*.pyc' -delete 2>/dev/null || true

echo "==> Zipping -> ${ZIP_PATH}"
( cd "${STAGE_DIR}" && zip -q -r -X "${ZIP_PATH}" . )

SIZE="$(du -h "${ZIP_PATH}" | cut -f1)"
echo
echo "Built ${ZIP_PATH} (${SIZE})"
echo "Handler:  app.lambda_handler.handler"
echo "Runtime:  python${PY_VERSION}"
echo
echo "Next: upload this zip through the visual builder's Lambda node, then run"
echo "      services/agents/deploy/configure-production.sh — see deploy/README.md."
