#!/usr/bin/env bash
# Post-deploy configuration for the infraflow-agents Lambda.
#
# The visual builder creates the function (code zip + IAM role + handler/runtime/memory/timeout) and
# the SQS dead-letter queue, but its Lambda node can't express four things this service needs. This
# script applies exactly those four, idempotently, and nothing else:
#
#   1. Environment variables  (OPENAI_API_KEY, OPENAI_AGENT_MODEL, AGENT_TOOL_SECRET,
#                              EXPRESS_INTERNAL_URL)
#   2. Timeout 120s / memory 1024 MB  (safe even if the builder already set them)
#   3. Async invoke config     (1 retry, 5-min max event age, on-failure -> the SQS DLQ)
#   4. Execution-role inline policy  (CloudWatch Logs write + sqs:SendMessage to the DLQ)
#
# Plus a 14-day CloudWatch Logs retention once the log group exists.
#
# Secrets come from the environment, never flags, so they stay out of shell history:
#   export OPENAI_API_KEY=sk-...
#   export AGENT_TOOL_SECRET=<same value as the production backend's AGENT_TOOL_SECRET>
#   export DATABASE_URL=postgresql://user:pass@host:5432/db   # optional; enables the knowledge base
#
#   services/agents/deploy/configure-production.sh \
#     --function infraflow-agents-prod \
#     --region us-east-1 \
#     --role-name infraflow-agents-exec \
#     --dlq-arn arn:aws:sqs:us-east-1:123456789012:infraflow-agents-dlq \
#     --express-url https://api.example.com/api/v1 \
#     [--model gpt-4o-mini]
#
# DATABASE_URL points at a Postgres 14+ with the `vector` extension (RDS db.t4g.micro is enough).
# Run once against it first:  CREATE EXTENSION IF NOT EXISTS vector;  (the service also attempts
# this on first use, but only if its role may create extensions). If the Lambda reaches RDS over
# the public internet, keep the RDS security group tight and the connection string on sslmode=require.
set -euo pipefail

FUNCTION="" ; REGION="" ; ROLE_NAME="" ; DLQ_ARN="" ; EXPRESS_URL="" ; MODEL="gpt-4o-mini"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --function)    FUNCTION="$2"; shift 2 ;;
    --region)      REGION="$2"; shift 2 ;;
    --role-name)   ROLE_NAME="$2"; shift 2 ;;
    --dlq-arn)     DLQ_ARN="$2"; shift 2 ;;
    --express-url) EXPRESS_URL="$2"; shift 2 ;;
    --model)       MODEL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

missing=()
[[ -n "${FUNCTION}"       ]] || missing+=("--function")
[[ -n "${REGION}"         ]] || missing+=("--region")
[[ -n "${ROLE_NAME}"      ]] || missing+=("--role-name")
[[ -n "${DLQ_ARN}"        ]] || missing+=("--dlq-arn")
[[ -n "${EXPRESS_URL}"    ]] || missing+=("--express-url")
[[ -n "${OPENAI_API_KEY:-}"    ]] || missing+=("env OPENAI_API_KEY")
[[ -n "${AGENT_TOOL_SECRET:-}" ]] || missing+=("env AGENT_TOOL_SECRET")
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required input(s): ${missing[*]}" >&2
  exit 2
fi

AWS=(aws --region "${REGION}")
LOG_GROUP="/aws/lambda/${FUNCTION}"

echo "==> 1/5  Environment variables + timeout/memory on ${FUNCTION}"
# Built as JSON (not the Variables={k=v,...} shorthand) so a secret containing , or = can't corrupt it.
ENV_JSON="$(mktemp)"
python - "$OPENAI_API_KEY" "$MODEL" "$AGENT_TOOL_SECRET" "$EXPRESS_URL" "${DATABASE_URL:-}" > "$ENV_JSON" <<'PY'
import json, sys
key, model, secret, express, database_url = sys.argv[1:6]
vars = {
    "OPENAI_API_KEY": key,
    "OPENAI_AGENT_MODEL": model,
    "AGENT_TOOL_SECRET": secret,
    "EXPRESS_INTERNAL_URL": express,
}
if database_url:
    vars["DATABASE_URL"] = database_url
print(json.dumps({"Variables": vars}))
PY
"${AWS[@]}" lambda update-function-configuration \
  --function-name "${FUNCTION}" \
  --timeout 180 \
  --memory-size 1024 \
  --environment "file://${ENV_JSON}" \
  >/dev/null
rm -f "$ENV_JSON"
"${AWS[@]}" lambda wait function-updated --function-name "${FUNCTION}"
[ -n "${DATABASE_URL:-}" ] && echo "    knowledge base enabled (DATABASE_URL set)" || echo "    knowledge base disabled (no DATABASE_URL)"

echo "==> 2/5  Async invoke config (1 retry, 300s max age, on-failure -> DLQ)"
"${AWS[@]}" lambda put-function-event-invoke-config \
  --function-name "${FUNCTION}" \
  --maximum-retry-attempts 1 \
  --maximum-event-age-in-seconds 300 \
  --destination-config "{\"OnFailure\":{\"Destination\":\"${DLQ_ARN}\"}}" \
  >/dev/null

echo "==> 3/5  Execution-role inline policy on ${ROLE_NAME} (logs + sqs:SendMessage)"
POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:${REGION}:*:log-group:${LOG_GROUP}:*"
    },
    {
      "Sid": "DeadLetterQueue",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "${DLQ_ARN}"
    }
  ]
}
JSON
)
"${AWS[@]}" iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name infraflow-agents-runtime \
  --policy-document "${POLICY}"

echo "==> 4/5  Smoke invoke (expects {\"ok\": false, \"error\": \"invalid_agent_token\"} — no real token)"
OUT_FILE="$(mktemp)"
"${AWS[@]}" lambda invoke \
  --function-name "${FUNCTION}" \
  --invocation-type RequestResponse \
  --payload '{"token":"not-a-real-token","diagramId":"x","message":"ping","history":[]}' \
  --cli-binary-format raw-in-base64-out \
  "${OUT_FILE}" >/dev/null
echo "    response: $(cat "${OUT_FILE}")"
rm -f "${OUT_FILE}"

echo "==> 5/5  CloudWatch Logs retention (14 days), if the log group exists yet"
if "${AWS[@]}" logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" \
     --query "logGroups[?logGroupName=='${LOG_GROUP}'] | length(@)" --output text | grep -q '^1$'; then
  "${AWS[@]}" logs put-retention-policy --log-group-name "${LOG_GROUP}" --retention-in-days 14
  echo "    set to 14 days"
else
  echo "    log group not created yet (first invoke makes it); re-run this step later or:"
  echo "    aws --region ${REGION} logs put-retention-policy --log-group-name ${LOG_GROUP} --retention-in-days 14"
fi

echo
echo "Done. Now set on the production backend and redeploy it:"
echo "  AGENT_INVOKE_MODE=lambda"
echo "  AGENT_LAMBDA_FUNCTION=${FUNCTION}"
echo "  AGENT_LAMBDA_REGION=${REGION}"
echo "  AGENT_TOOL_SECRET=<the same value used above>"
