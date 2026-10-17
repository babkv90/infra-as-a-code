// The three endpoints the Python agent service calls back into Express with — never called by the
// browser. Sits behind requireAgentScope.js (machine JWT), not requireAuth. Together these are the
// "tool gateway": getGrounding is the read side (diagram/Terraform/validation/billing data),
// postRunStep/postRunComplete are the write side (progress + final answer land on AgentRun /
// AgentConversation, which is what agentController.js's getRunStatus polls).
import { z } from 'zod';
import { AgentConversation } from '../models/AgentConversation.js';
import { AgentRun } from '../models/AgentRun.js';
import { Diagram } from '../models/Diagram.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getCachedAwsInsightsForWorkspace } from '../utils/awsInsightsForAgent.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { finishPlanFix, planFixStateForAgent, recordAgentChanges, requestPlanRun } from '../services/agentPlanFix.js';

// Imported directly from the frontend's own source of truth — never reimplemented here. See
// infraflow-multi-agent-plan.pdf §1.5/§1.7: "same functions the browser calls, not reimplemented."
// Resolved at runtime by the `node --import tsx/esm` loader registered in package.json's
// dev/start scripts, so these .ts files need no build step to be importable from this plain-JS
// backend.
import { exportTerraform } from '../../../src/utils/exportTerraform.ts';
import { validateDiagram } from '../../../src/utils/validate.ts';
import { validateGeneratedTerraform } from '../../../src/utils/terraformValidation.ts';
import { createDeploymentPlan } from '../../../src/utils/deploymentPlan.ts';
import { diagramStructureKey } from '../../../src/utils/graphIndex.ts';

export const groundingSchema = z.object({
  body: z.object({
    diagramId: z.string().min(1),
    include: z.array(z.string()).optional(),
  }),
});

// POST /internal/agent-tools/grounding — the ONE batched call an agent run makes per turn (see
// plan §1.5). Returns everything an agent needs about a diagram in a single response, scoped to
// the calling agent token's workspace so a run can never read another workspace's data.
export const getGrounding = asyncHandler(async (req, res) => {
  const diagram = await Diagram.findOne({ _id: req.validated.body.diagramId, workspace: req.agent.workspaceId });
  if (!diagram) {
    throw new ApiError(404, 'Diagram not found');
  }

  const { nodes, edges, activeRegion } = diagram;
  const terraform = exportTerraform(nodes, edges);
  const validation = [...validateDiagram(nodes, edges, activeRegion), ...validateGeneratedTerraform(terraform)];
  const plan = createDeploymentPlan(nodes, edges, validation);

  const include = req.validated.body.include ?? [];
  // Cost agent's own tool, gated the same way every other tool is: bound only to the scopes this
  // run's token actually carries (plan §3.3's per-agent scoping), not just whether it was asked for.
  const awsInsights =
    include.includes('awsInsights') && req.agent.scopes.includes('aws:read:billing')
      ? await getCachedAwsInsightsForWorkspace(req.agent.workspaceId)
      : null;

  res.json({
    success: true,
    data: {
      diagramId: diagram._id.toString(),
      diagramName: diagram.name,
      nodes,
      edges,
      activeRegion,
      digest: diagramStructureKey(nodes, edges),
      terraform,
      validation,
      plan,
      awsInsights,
    },
  });
});

export const groundingValidation = validateRequest(groundingSchema);

const runStepSchema = z.object({
  body: z.object({ event: z.record(z.any()) }),
  params: z.object({ runId: z.string().min(1) }),
});

const runCompleteSchema = z.object({
  body: z.object({
    status: z.enum(['completed', 'failed']).default('completed'),
    content: z.string(),
    metadata: z.record(z.any()).optional(),
  }),
  params: z.object({ runId: z.string().min(1) }),
});

export const runStepValidation = validateRequest(runStepSchema);
export const runCompleteValidation = validateRequest(runCompleteSchema);

function assertOwnRun(req) {
  if (req.agent.runId !== req.params.runId) {
    throw new ApiError(403, "Agent token cannot report on another run's status");
  }
}

// POST /internal/agent-tools/runs/:runId/steps — Python posts one of these per graph-node
// transition (app/runner.py). Up to 4 specialists finish in parallel, so multiple of these can
// land on the same AgentRun document at nearly the same instant — findOne()+mutate+save() would
// race (a losing save throws Mongoose's classic concurrent-array-push VersionError, which the
// Python caller wasn't checking for, silently stranding the run at 'running' forever). An atomic
// $push sidesteps the race entirely: no read-modify-write, so there's nothing to conflict on.
export const postRunStep = asyncHandler(async (req, res) => {
  assertOwnRun(req);
  const event = req.validated.body.event;
  const update = { $push: { steps: { ...event, at: new Date() } } };
  if (event.type === 'route.decided' && Array.isArray(event.route)) {
    update.$set = { route: event.route };
  }

  const run = await AgentRun.findOneAndUpdate({ _id: req.params.runId, workspace: req.agent.workspaceId }, update);
  if (!run) throw new ApiError(404, 'Agent run not found');

  res.json({ success: true });
});

// POST /internal/agent-tools/runs/:runId/complete — the run's terminal callback: appends the
// assistant reply to the conversation (the same {content, metadata} shape the frontend has always
// rendered) and closes out the AgentRun. Same atomic-update reasoning as postRunStep above — this
// can race the very last specialist's still-in-flight step post.
export const postRunComplete = asyncHandler(async (req, res) => {
  assertOwnRun(req);
  const { status, content, metadata } = req.validated.body;

  const run = await AgentRun.findOneAndUpdate(
    { _id: req.params.runId, workspace: req.agent.workspaceId },
    { $set: { status, findings: metadata?.findings ?? [], changePlan: metadata?.changePlan ?? null } },
  );
  if (!run) throw new ApiError(404, 'Agent run not found');

  await AgentConversation.findOneAndUpdate(
    { _id: run.conversation, workspace: req.agent.workspaceId },
    { $push: { messages: { role: 'assistant', content, metadata: metadata ?? {} } } },
  );

  res.json({ success: true });
});

// ---------------------------------------------------------------------------------------------
// Plan-fix agent tools ("make it pass terraform plan") — see services/agentPlanFix.js for what
// each one enforces. All four act only on the calling run's own draft, never on a real Diagram.
// ---------------------------------------------------------------------------------------------

const fixRunParams = z.object({ runId: z.string().min(1) });

export const fixStateValidation = validateRequest(z.object({ params: fixRunParams }));
export const fixChangesValidation = validateRequest(
  z.object({ params: fixRunParams, body: z.object({ items: z.array(z.record(z.any())).max(40) }) }),
);
export const fixPlanValidation = validateRequest(
  z.object({
    params: fixRunParams,
    body: z.object({ messages: z.array(z.record(z.any())), toolCallId: z.string().min(1), turns: z.number().int().nonnegative() }),
  }),
);
export const fixFinishValidation = validateRequest(
  z.object({
    params: fixRunParams,
    body: z.object({
      outcome: z.enum(['passed', 'gave_up']),
      summary: z.string().max(4000),
      messages: z.array(z.record(z.any())).optional(),
      turns: z.number().int().nonnegative().optional(),
    }),
  }),
);

async function loadOwnFixRun(req) {
  assertOwnRun(req);
  const run = await AgentRun.findOne({ _id: req.params.runId, workspace: req.agent.workspaceId, kind: 'plan_fix' });
  if (!run || !run.fix) throw new ApiError(404, 'Plan-fix run not found');
  if (run.status !== 'running') throw new ApiError(409, `Plan-fix run is already ${run.status}`);
  return run;
}

// POST /internal/agent-tools/runs/:runId/fix/state — the draft, its generated Terraform, static
// issues, every plan result so far, budgets, and the agent's own paused conversation.
export const getFixState = asyncHandler(async (req, res) => {
  const run = await loadOwnFixRun(req);
  res.json({ success: true, data: planFixStateForAgent(run) });
});

// POST /internal/agent-tools/runs/:runId/fix/changes — apply_changes tool.
export const postFixChanges = asyncHandler(async (req, res) => {
  const run = await loadOwnFixRun(req);
  res.json({ success: true, data: await recordAgentChanges(run, req.validated.body.items) });
});

// POST /internal/agent-tools/runs/:runId/fix/plan — run_terraform_plan tool. On success the agent
// must stop: its conversation is persisted here and it is resumed with the plan result later.
export const postFixPlan = asyncHandler(async (req, res) => {
  const run = await loadOwnFixRun(req);
  res.json({ success: true, data: await requestPlanRun(run, req.validated.body) });
});

// POST /internal/agent-tools/runs/:runId/fix/finish — finish tool, gated: "passed" is rejected
// unless the latest plan on the current draft revision actually passed.
export const postFixFinish = asyncHandler(async (req, res) => {
  const run = await loadOwnFixRun(req);
  res.json({ success: true, data: await finishPlanFix(run, req.validated.body) });
});
