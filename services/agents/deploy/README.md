# Deploying infraflow-agents to production (AWS Lambda, zip)

The agent service runs in production as a **single zip Lambda** invoked **asynchronously** by the
Express backend (`AGENT_INVOKE_MODE=lambda`). One invocation runs the whole LangGraph graph to
completion — [`app/lambda_handler.py`](../app/lambda_handler.py) — and the run reports itself back to
Express through the same `/internal/agent-tools/*` callbacks the local HTTP path uses.

Why this shape: at portfolio traffic (a few dozen runs a month) it sits inside the Lambda free tier
— **~$0/month** — scales to zero, and each run is its own isolated execution environment, so a
failure can only ever affect the one run. See the conversation that produced this for the full
trade-off analysis.

---

## Knowledge base (RAG) — optional but needed for the superadmin Knowledge Base UI

The agent retrieves from a **Postgres + pgvector** corpus that a super admin uploads to. This is a
**separate cost** — Atlas Vector Search would have been ~$0, pgvector needs a real database:

| Option | ~Monthly |
|---|---|
| RDS Postgres `db.t4g.micro`, publicly accessible, SG-locked, `sslmode=require` | ~$13 |
| Aurora Serverless v2 (min 0.5 ACU) | ~$43 |
| + Lambda in a VPC to reach RDS privately → NAT gateway for OpenAI egress | +~$32 |

Cheapest sane path: **`db.t4g.micro`, public, tight security group, SSL**. Then:

```
# once, against the new database:
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

The service creates its own tables + HNSW index on first use. Set `DATABASE_URL` in step 2 (below);
leave it empty and the knowledge base is simply disabled — runs and the rest of the deploy are
unaffected. Lambda timeout is raised to 180s by `configure-production.sh` to cover embedding a
large PDF on ingest.

---

## 0. Build the zip

```
services/agents/deploy/build.sh
```

Produces `services/agents/deploy/build/agent-lambda.zip` (~15–25 MB): the `app/` package plus every
`requirements.txt` dependency, built with Linux wheels. Uses Docker (`public.ecr.aws/sam/build-python3.12`)
if present, otherwise `pip --platform manylinux2014_x86_64`.

> It's one fat zip, not a function zip + a dependency layer, because the visual builder's Lambda node
> only exposes `filename` — it can't attach a layer. Functionally identical.

---

## 1. Build the infra in the visual builder

Create three nodes on the canvas, then Deploy. All values are literal unless noted.

### Node A — IAM role  (palette: IAM)

| Field | Value |
|---|---|
| `name` | `infraflow-agents-exec` |
| `assume_role_policy` | `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}` |

### Node B — SQS queue  (palette: SQS) — the dead-letter queue

| Field | Value |
|---|---|
| `name` | `infraflow-agents-dlq` |
| `fifo_queue` | `false` |
| `message_retention_seconds` | `1209600` |
| `visibility_timeout_seconds` | `60` |

### Node C — Lambda function  (palette: Lambda)

| Field | Value |
|---|---|
| `function_name` | `infraflow-agents-prod` |
| `filename` (Deployment zip path) | upload `deploy/build/agent-lambda.zip` |
| `handler` | `app.lambda_handler.handler` |
| `runtime` | `python3.12` |
| `memory_size` | `1024` |
| `timeout` | `120` |
| `role_arn` | resolved by the edge to Node A (see below) |
| `source_code_hash` | leave blank |

### Edges

- **C → A** (Lambda → IAM role): resolves the Lambda's `role_arn`, and lets the builder fill Node
  A's `assume_role_policy` for the Lambda service (`edgeResolvable` in the resource registry).
- **C → B** (Lambda → SQS): optional, for a readable diagram. The on-failure wiring itself is applied
  in step 2 — the Lambda node has no `dead_letter_config`/destination field to express it.

Do **not** connect the Lambda to any subnet/VPC node — it needs plain outbound internet to reach
OpenAI and the Express API, which a non-VPC Lambda has by default (no NAT gateway, no cost).

Then **Deploy**. From the deployment outputs note: the Lambda **name** and **ARN**, the IAM role
**name**, and the SQS queue **ARN**.

---

## 2. Apply the four things the builder's Lambda node can't express

Env vars, timeout/memory belt-and-suspenders, async retry + on-failure→DLQ, and the execution
role's runtime permissions (Logs + `sqs:SendMessage`). All idempotent.

```
export OPENAI_API_KEY=sk-...
export AGENT_TOOL_SECRET=<the SAME value the production backend uses for AGENT_TOOL_SECRET>
export DATABASE_URL='postgresql://user:pass@host:5432/db?sslmode=require'   # omit to disable RAG

services/agents/deploy/configure-production.sh \
  --function     infraflow-agents-prod \
  --region       us-east-1 \
  --role-name    infraflow-agents-exec \
  --dlq-arn      arn:aws:sqs:us-east-1:<acct>:infraflow-agents-dlq \
  --express-url  https://<your-backend-api-gateway>/api/v1 \
  --model        gpt-4o-mini
```

If you set `DATABASE_URL`, also add `secretsmanager`/RDS network access as needed and, if the RDS
isn't publicly reachable, `--vpc-config` on the function (subnets + a security group that can reach
5432) plus a NAT path for OpenAI — see the RAG cost table above.

The script ends with a smoke invoke that should print
`{"ok": false, "error": "invalid_agent_token"}` — that's success (it rejected a fake token, meaning
code + env loaded fine).

---

## 3. Let the backend invoke it, and switch it on

The backend's own AWS identity (`INFRAFLOW_APP_AWS_*` user, or its execution role) needs
`lambda:InvokeFunction` on the agent function:

```
aws lambda add-permission \
  --function-name infraflow-agents-prod \
  --region us-east-1 \
  --statement-id infraflow-backend-invoke \
  --action lambda:InvokeFunction \
  --principal <backend-iam-user-or-role-ARN>
```
(or attach an IAM policy allowing `lambda:InvokeFunction` on the function ARN to that identity.)

Then set on the **backend** and redeploy it:

```
AGENT_INVOKE_MODE=lambda
AGENT_LAMBDA_FUNCTION=infraflow-agents-prod
AGENT_LAMBDA_REGION=us-east-1
AGENT_TOOL_SECRET=<same value used in step 2>
```

`AGENT_API_URL` is now ignored. Leaving `AGENT_INVOKE_MODE` unset (or `http`) keeps the old
behaviour for local dev.

---

## 4. Verify end to end

1. Open the dashboard, open a diagram, ask the agent a question.
2. `aws logs tail /aws/lambda/infraflow-agents-prod --region us-east-1 --follow` — you should see
   `Starting agent run <id>` … `Agent run <id> finished`.
3. The answer appears in the chat (Express received the `runs/<id>/complete` callback).
4. Anything that hard-fails past one retry lands in `infraflow-agents-dlq` — check its
   `ApproximateNumberOfMessages` occasionally.

## Rollback

Set `AGENT_INVOKE_MODE=http` on the backend (and point `AGENT_API_URL` at a running container/host),
redeploy the backend. The Lambda can stay deployed; nothing calls it.
