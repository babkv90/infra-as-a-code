# AI Agent — Knowledge Transfer Guide

How to read the AI agent code from start to finish, with a focus on the "make it pass terraform
plan" (plan-fix) agent loop. Written against commit `86458d2`. Line anchors may drift, but the
function names won't.

---

## 0. The mental model

There are three processes. Each owns one thing, and nothing else:

| Process | Owns | Never does |
|---|---|---|
| **React** (`src/`) | Buttons and polling | Never talks to the Python service |
| **Express** (`IAAS backend/`) | All state (Mongo), AWS credentials, running `terraform`, **every guardrail** | Never decides what to fix |
| **Python agent** (`services/agents/`) | The LLM's reasoning and its loop | No AWS SDK, no database, no terraform binary. It holds a short-lived token and calls Express for everything |

There are **two kinds of agent run**. Read them in this order, because the second builds on the first:

1. **`chat`**: a *fixed* LangGraph workflow. The code decides the steps.
2. **`plan_fix`**: an *open-ended tool-calling loop*. The model decides the steps; Express enforces the rules.

---

## 1. Reading order

### Phase A — Orientation (15 min)

1. [services/agents/README.md](../services/agents/README.md): the "Two kinds of run" section is the whole design in two paragraphs.
2. [services/agents/app/main.py](../services/agents/app/main.py): the header comment walks through the 4-step flow.
3. [IAAS backend/src/models/AgentRun.js](../IAAS%20backend/src/models/AgentRun.js): **the most important data structure.** One Mongo document per run. Look at `kind`, `status`, `steps`, and `fix` (the plan-fix state that survives between invocations).

### Phase B — How a run starts and how auth works (30 min)

Follow one request across the service boundary:

4. [IAAS backend/src/routes/agentRoutes.js](../IAAS%20backend/src/routes/agentRoutes.js): the user-facing routes, behind `requireAuth`.
5. [IAAS backend/src/routes/internalAgentTools.js](../IAAS%20backend/src/routes/internalAgentTools.js): the routes the **Python service** calls back into. Each route requires a scope.
6. [IAAS backend/src/services/agentIdentity.js](../IAAS%20backend/src/services/agentIdentity.js): mints a 5-minute machine JWT per run.
7. [IAAS backend/src/utils/agentBridge.js](../IAAS%20backend/src/utils/agentBridge.js): `startAgentRun()`. Note the two scope sets (`RUN_SCOPES` and `PLAN_FIX_SCOPES`) and the two transports: HTTP for local dev, async Lambda `Event` invoke for production (`AGENT_INVOKE_MODE=lambda`).
8. [IAAS backend/src/middleware/requireAgentScope.js](../IAAS%20backend/src/middleware/requireAgentScope.js) and [services/agents/app/security.py](../services/agents/app/security.py): the same JWT is verified on both sides with the shared `AGENT_TOOL_SECRET`.

### Phase C — The Python service skeleton (30 min)

9. [app/api/routes_runs.py](../services/agents/app/api/routes_runs.py) (uvicorn entry) and [app/lambda_handler.py](../services/agents/app/lambda_handler.py) (Lambda entry). Both branch on `mode == "plan_fix"`.
10. [app/runner.py](../services/agents/app/runner.py): read the docstrings on `execute_run` and `execute_run_sync`. They explain why the code is fire-and-forget on uvicorn but awaited on Lambda (Lambda freezes the environment once the handler returns). Then read `_run_plan_fix` at the bottom: the wall-clock timeout, and a `409` that means "the run is already closed".
11. [app/gateway.py](../services/agents/app/gateway.py): **the Python service's only window to the world.** Every capability is an `httpx` POST to Express. The bottom section has the four plan-fix tool wrappers (`fix_get_state`, `fix_apply_changes`, `fix_request_plan`, `fix_finish`).

### Phase D — The chat graph (warm-up, 45 min)

12. [app/graph.py](../services/agents/app/graph.py): `build_graph()` at the bottom gives the shape: `ground → supervisor → Send[specialists in parallel] → synthesize → changeplan → END`.
13. [app/state.py](../services/agents/app/state.py): note `Annotated[list, add]`. That reducer is what lets parallel specialists append to `results` instead of overwriting each other.
14. [app/agents/base.py](../services/agents/app/agents/base.py): `call_llm` (one-shot JSON), `call_llm_with_tools` (**the primitive plan-fix is built on**), and `_create_completion`'s retry with exponential backoff.
15. [app/dsl.py](../services/agents/app/dsl.py): how the diagram becomes compact text for the prompt (node IDs in `[brackets]`).
16. [app/evidence.py](../services/agents/app/evidence.py) and [app/changeplan.py](../services/agents/app/changeplan.py): **mechanical gates**. The model can say anything, but only claims that cite real node IDs or Terraform addresses survive. Plan-fix uses the same idea at a larger scale.

### Phase E — The plan-fix agent (the core, 2 hrs)

Read these two files **side by side**. They are two halves of one design.

17. [app/planfix/agent.py](../services/agents/app/planfix/agent.py), the brain. Read it in this order:
    - `SYSTEM_PROMPT` and `TOOLS`: the 5 tools the model can call (`apply_changes`, `get_terraform_block`, `view_draft`, `run_terraform_plan`, `finish`).
    - `PlanFixSession.run()` ([agent.py:166](../services/agents/app/planfix/agent.py#L166)): **the agent loop.** Call the LLM, append its message, post the model's note as a `fix.note` step, run ordinary tools, then handle at most one *terminal* tool (`run_terraform_plan` or `finish`).
    - `_run_tool` and `_run_terminal`: each tool maps to one `gateway.fix_*` call. Only `get_terraform_block` runs locally (via [planfix/hcl.py](../services/agents/app/planfix/hcl.py)).
    - Helpers: `compact_tool_results` (truncates old tool results so the context stays bounded) and `plan_result_payload` (how a plan result is fed back as a tool response).
18. [IAAS backend/src/services/agentPlanFix.js](../IAAS%20backend/src/services/agentPlanFix.js), the guardrails. Map each section to the tool it serves:
    - `createPlanFixState`: the draft is a `structuredClone` of the diagram, with `revision: 0`.
    - `applyChangeItems` / `applyOneChange`: rejects `remove_node`, refuses secret-looking keys (`SENSITIVE_KEY`), and validates real node IDs, edge IDs and service IDs. Each item is applied or rejected independently.
    - `recordAgentChanges`: enforces the edit budget and bumps `revision` when anything is applied.
    - `requestPlanRun`: enforces the plan budget, refuses to plan an unchanged revision, **saves the agent's messages and `pendingToolCallId`**, then starts the plan (local CLI or GitHub Actions).
    - `finishPlanFix`: the "passed" gate. The latest plan must have passed **on the current revision**.
    - `completePlanRun` → `resumePlanFixAgent`: stores the plan result and starts a **new** agent invocation.
    - `normalizePlanDiagnostics`: maps a Terraform error to its resource address and then to the diagram node ID, so the agent knows which node to edit.
19. [internalAgentToolsController.js](../IAAS%20backend/src/controllers/internalAgentToolsController.js) (bottom section): thin HTTP wrappers. `loadOwnFixRun` enforces "your own run only, and only while it is running".
20. [.github/workflows/terraform-plan.yml](../.github/workflows/terraform-plan.yml): the production plan executor. Its last step **always** calls back so the paused agent resumes.
21. [agentController.js](../IAAS%20backend/src/controllers/agentController.js): `startPlanFix`, `receivePlanCallback`, and `applyPlanFix`, which is the *only* path from the draft to the real diagram and is triggered by the user.

### Phase F — Frontend (30 min)

22. [src/dashboard/agentApi.ts](../src/dashboard/agentApi.ts): the types are the cleanest description of the API contract (`AgentStepEvent`, `PlanFixView`, `AgentRunStatus`).
23. [src/dashboard/pages/AgentPage.tsx](../src/dashboard/pages/AgentPage.tsx): `startPlanFixRun` leads to `startPolling`, then `getAgentRunStatus` is polled on an interval, and finally `handleApplyFix`.
24. [src/dashboard/components/AgentPlanFixPanel.tsx](../src/dashboard/components/AgentPlanFixPanel.tsx): renders each `step.type` as a live timeline, plus the Apply button. [AgentRunTimeline.tsx](../src/dashboard/components/AgentRunTimeline.tsx) does the same for chat runs.

### Phase G — Tests as executable docs

25. [services/agents/tests/test_planfix_agent.py](../services/agents/tests/test_planfix_agent.py): drives the loop with a scripted fake LLM and a fake Express. **The best way to see the loop move.**
26. [IAAS backend/test/agentPlanFix.test.js](../IAAS%20backend/test/agentPlanFix.test.js): the guardrails as tests.
27. [services/agents/tests/test_no_cloud_sdk.py](../services/agents/tests/test_no_cloud_sdk.py): enforces "the Python service has no cloud SDK" as a test rather than a comment.

> **Short on time?** Read #3, #10, #17 and #18 in that order. Those four files contain about 80% of the agent design.

---

## 2. One plan-fix run, traced end to end

```
Browser            Express (Mongo)                         Python agent              Terraform
   │ POST /agent/plan-fix
   │──────────────▶ startPlanFix: AgentRun{kind:plan_fix,
   │                 fix: draft=clone(diagram), revision 0}
   │                 startAgentRun(mode=plan_fix) ──JWT──▶ invocation #1
   │◀─ runId                                              fix/state ◀── get draft + TF + issues
   │ poll /runs/:id/status                                 LLM → apply_changes
   │                 fix/changes: gate each item,  ◀────── (rejects remove_node, secrets…)
   │                 revision++                            LLM → run_terraform_plan
   │                 fix/plan: save messages +     ◀──────
   │                 pendingToolCallId, start plan ──────────────────────────────────▶ plan
   │                                                       returns "suspended"
   │                                                       (invocation ENDS)
   │                 completePlanRun ◀──── result (local CLI or GH Actions callback) ─┘
   │                 resumePlanFixAgent ──new JWT──▶ invocation #2
   │                                                       messages restored, plan result
   │                                                       appended as the tool's response
   │                                                       … more edits / plans …
   │                 fix/finish: "passed" only if  ◀────── LLM → finish(passed)
   │                 last plan passed @ current rev
   │◀─ status=completed, fix.outcome
   │ POST /agent/runs/:id/apply-fix → draft written to the real Diagram (only now)
```

**The key insight:** a single run spans **several separate agent invocations**. The agent's whole
conversation lives in Mongo (`fix.agent.messages`). While a plan runs, no agent process exists at
all. When the plan finishes, Express mints a fresh token and starts a new invocation, and the plan
result is attached to the tool call the agent was waiting on (`pendingToolCallId`, see the top of
`PlanFixSession.run()`). That is how a 1–3 minute `terraform plan` fits inside a 120 s Lambda.

### Step events

What each `AgentRun.steps[].type` means and who writes it:

| Step type | Written by | Meaning |
|---|---|---|
| `grounding.ready` | `runner.py` (chat) | Diagram bundle fetched |
| `route.decided` | `runner.py` (chat) | Supervisor picked specialists |
| `agent.finished` | `runner.py` (chat) | One specialist answered |
| `changeplan.ready` | `runner.py` (chat) | Proposed ChangePlan is ready |
| `fix.started` | `agentController.startPlanFix` | Plan-fix run created |
| `fix.note` | `planfix/agent.py` | The model's live reasoning note before a tool call |
| `fix.changes` | `agentPlanFix.recordAgentChanges` | An edit batch was applied or rejected |
| `plan.started` / `plan.finished` | `agentPlanFix.requestPlanRun` / `completePlanRun` | A real `terraform plan` started or finished |
| `fix.finished` / `fix.failed` | `agentPlanFix.finishPlanFix` / `failPlanFixRun` | Terminal state |

---

## 3. Design rules to recognise as you read

1. **The model proposes; code enforces.** Every rule in `SYSTEM_PROMPT` ("never remove resources", "never invent secrets", "passed only after a passing plan") is *also* enforced in `agentPlanFix.js`. The prompt only makes the agent better behaved. Safety comes from the code.
2. **Draft, not the real diagram.** The agent's token has `diagram:draft:write` and no scope that can write a real diagram. Only `applyPlanFix` (a user click) writes, and it refuses if the diagram changed since the run started.
3. **Budgets at three levels:**
   - per invocation: `SOFT_DEADLINE_SECONDS` (85 s) in `agent.py`
   - hard wall per invocation: `PLAN_FIX_INVOCATION_WALL_SECONDS` (105 s) in `runner.py`
   - per run: `PLAN_FIX_LIMITS` in `agentPlanFix.js` (5 plans, 40 edits, 40 turns)
4. **Every run always ends in a terminal state.** Look for the `except Exception: … post_run_complete / _fail_plan_fix` pattern. A run must never sit at `running` forever.
5. **Rejections are tool results, not crashes.** A bad edit comes back as `{rejected: [...reason]}` so the model can read the reason and correct itself.
6. **Untrusted data stays data.** Diagram, Terraform and plan output are wrapped and labelled as data in the prompts. The model is told never to follow instructions inside them.

---

## 4. Dependency injection in the loop

```python
LlmCall = Callable[[list[dict], list[dict], str | None], Awaitable[object]]
```

This type alias in [agent.py:144](../services/agents/app/planfix/agent.py#L144) means "an async
function that takes `(messages, tools, model)` and returns the assistant message". It matches the
signature of `call_llm_with_tools`. `PlanFixSession` takes `llm: LlmCall` and `gateway` as
constructor arguments instead of calling OpenAI or Express directly. In production these default to
the real implementations. In `test_planfix_agent.py` they are a scripted fake model and an
in-memory Express, so the whole loop runs in tests without network access.

---

## 5. Hands-on exercises

1. **Run the Python tests with output:** `cd services/agents && .venv\Scripts\pytest tests/test_planfix_agent.py -v -s`. Add a `print(self.messages[-1])` inside the `run()` loop and watch the conversation grow.
2. **Set breakpoints** at `PlanFixSession.run` (Python) and at `requestPlanRun` / `completePlanRun` (Node). Then click "Make it pass terraform plan" locally and step across the boundary.
3. **Watch the AgentRun document in Mongo** during a run: `steps[]` grows, `fix.revision` goes up, and `fix.agent.messages` is the raw transcript.
4. **Try to break a guardrail:** write a test where the fake LLM calls `finish(passed)` before any plan, or sends `remove_node`. Confirm that Express rejects it and the agent receives the reason.
5. **Explain it back:** what happens if the GitHub Action never calls back? (See Known gaps.)

---

## 6. Known gaps

- **Lost plan callback.** If `terraform-plan.yml` never reports back (runner outage, a deleted
  workflow), the run stays `running` in Mongo. The UI stops polling at its own deadline
  (`PLAN_FIX_MAX_POLL_MS` in `AgentPage.tsx`), but nothing closes the run on the server. A periodic
  job that fails plan-fix runs whose latest plan has been `running` too long would close this gap.

---

## 7. Local setup quick reference

| What | Where |
|---|---|
| Agent service env | `services/agents/.env`: `OPENAI_API_KEY`, `OPENAI_FIX_MODEL` (optional), `AGENT_TOOL_SECRET`, `EXPRESS_INTERNAL_URL` |
| Backend env | `IAAS backend/.env`: `AGENT_TOOL_SECRET` (must match), `AGENT_API_URL`, `AGENT_INVOKE_MODE`, `DEPLOYMENT_EXECUTOR`, `TERRAFORM_BIN` |
| Run the agent service | `services/agents/.venv\Scripts\uvicorn app.main:app --port 8001 --reload` |
| Production deploy | [services/agents/deploy/README.md](../services/agents/deploy/README.md) |
| Regenerate AWS service schema | `npm run gen:agent-schemas` (from the repo root) |
