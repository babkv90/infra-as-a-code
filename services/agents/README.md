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

## Deploying to production

Runs as an async-invoked zip Lambda — build script, visual-builder node recipe, and post-deploy
steps in [`deploy/README.md`](deploy/README.md). The Express side switches over with
`AGENT_INVOKE_MODE=lambda` (see `IAAS backend/.env.example`).

## Regenerating the AWS service schema

`app/tools/schemas/aws_services.json` is generated from the frontend's `src/data/awsServices.ts`
— never hand-edit it. Regenerate from the project root with `npm run gen:agent-schemas`.
