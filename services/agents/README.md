# infraflow-agents

The Python/FastAPI multi-agent service from `infraflow-multi-agent-plan.pdf`. M0 scope: one
Architect agent, no LangGraph/Redis yet (those arrive in M1). Holds the reasoning; holds **no**
AWS credentials, no Terraform binary, no MongoDB driver — every capability is a call back into
Express's `/internal/agent-tools/*` gateway, authenticated with the machine JWT Express mints per
run. See `tests/test_no_cloud_sdk.py`, which enforces this as a test rather than a comment.

## Setup

```
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
# then edit .env: set OPENAI_API_KEY, and set AGENT_TOOL_SECRET to match
# `IAAS backend/.env`'s AGENT_TOOL_SECRET exactly.
```

## Run

```
.venv\Scripts\uvicorn app.main:app --port 8001 --reload
```

`GET http://127.0.0.1:8001/health` should return `{"ok": true, ...}`.

## Test

```
.venv\Scripts\pytest
```

## Two kinds of run

- **chat** (`app/graph.py`): a fixed LangGraph workflow — route, fan out to specialists, synthesize,
  propose a ChangePlan. One invocation per user message.
- **plan_fix** (`app/planfix/`): "make it pass terraform plan" — an open-ended tool-calling loop
  where the model decides every step: edit a draft copy of the diagram, read generated HCL, run a
  real `terraform plan`, repeat, finish. A run spans several invocations: when the agent asks for a
  plan, its conversation is saved in Express and the invocation ends; Express runs the plan
  (locally, or via `.github/workflows/terraform-plan.yml` on the Lambda executor) and starts a new
  invocation with the result. Every guardrail — no deleting resources, no invented secrets, the
  plan/edit budgets, "passed" only after a passing plan on the current draft — is enforced in
  `IAAS backend/src/services/agentPlanFix.js`, not in the prompt. Nothing reaches the real diagram
  until a user clicks Apply.

## Deploying to production

Runs as an async-invoked zip Lambda — build script, visual-builder node recipe, and post-deploy
steps in [`deploy/README.md`](deploy/README.md). The Express side switches over with
`AGENT_INVOKE_MODE=lambda` (see `IAAS backend/.env.example`).

## Regenerating the AWS service schema

`app/tools/schemas/aws_services.json` is generated from the frontend's `src/data/awsServices.ts`
— never hand-edit it. Regenerate from the project root with `npm run gen:agent-schemas`.
