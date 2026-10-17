// User-facing REST surface for the AI Cloud Agent chat, mounted at /agent by agentRoutes.js and
// sitting behind requireAuth (a real user session, unlike the machine-JWT-only routes in
// internalAgentTools.js). Talks to the Python multi-agent service only indirectly, via
// startAgentRun() in utils/agentBridge.js — this file never calls it directly.
//
// Two Mongo collections back this feature: AgentConversation (the chat thread the browser
// renders) and AgentRun (one document per in-flight/completed multi-agent run, written to only by
// the Python service's callbacks in internalAgentToolsController.js).
import { z } from 'zod';
import { AgentConversation } from '../models/AgentConversation.js';
import { AgentRun } from '../models/AgentRun.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Diagram } from '../models/Diagram.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { canUseAiAgent } from '../utils/accessControl.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { startAgentRun } from '../utils/agentBridge.js';
import { completePlanRun, createPlanFixState, failPlanFixRun, planFixPublicView } from '../services/agentPlanFix.js';

export const createConversationSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    diagramId: z.string().optional(),
    awsAccountId: z.string().optional(),
    message: z.string().optional(),
  }),
});

export const addMessageSchema = z.object({
  body: z.object({
    message: z.string().min(1),
  }),
});

// GET /agent/conversations — the sidebar/history list for the current user's workspace.
export const listConversations = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const conversations = await AgentConversation.find({ workspace: req.user.workspace }).sort({ updatedAt: -1 });
  res.json({ success: true, data: conversations });
});

// POST /agent/conversations — starts a new chat thread and, if the caller included an opening
// message, immediately kicks off the first agent run against it (see launchRun below).
export const createConversation = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const conversation = await AgentConversation.create({
    workspace: req.user.workspace,
    user: req.user._id,
    title: req.validated.body.title ?? 'New cloud agent conversation',
    context: {
      diagram: req.validated.body.diagramId,
      awsAccount: req.validated.body.awsAccountId,
    },
  });

  let runId;
  if (req.validated.body.message) {
    conversation.messages.push({ role: 'user', content: req.validated.body.message });
    await conversation.save();
    runId = await launchRun({ req, conversation, message: req.validated.body.message, history: [] });
  }

  res.status(201).json({ success: true, data: { conversation, runId } });
});

// POST /agent/conversations/:id/messages — appends a follow-up message to an existing thread and
// runs the agent again, this time with the prior turns as `history` for LLM context.
export const addMessage = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const conversation = await AgentConversation.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!conversation) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  const message = req.validated.body.message;
  const history = conversation.messages.map((entry) => ({ role: entry.role, content: entry.content }));
  conversation.messages.push({ role: 'user', content: message });
  await conversation.save();

  const runId = await launchRun({ req, conversation, message, history });

  res.json({ success: true, data: { conversation, runId } });
});

// GET /agent/runs/:id/status — polled by AgentPage.tsx every ~1.5s while a run is in flight
// (same pattern DeploymentLiveMonitor.tsx already uses for deployment status, not a new one).
export const getRunStatus = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const run = await AgentRun.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!run) {
    return res.status(404).json({ success: false, message: 'Agent run not found' });
  }
  const conversation = await AgentConversation.findOne({ _id: run.conversation, workspace: req.user.workspace });

  res.json({
    success: true,
    data: {
      kind: run.kind ?? 'chat',
      status: run.status,
      fix: run.kind === 'plan_fix' ? planFixPublicView(run) : null,
      route: run.route,
      steps: run.steps,
      findings: run.findings,
      changePlan: run.changePlan,
      conversation,
    },
  });
});

export const startPlanFixSchema = z.object({
  body: z.object({
    conversationId: z.string().optional(),
    diagramId: z.string().optional(),
    awsAccountId: z.string().optional(),
  }),
});

// POST /agent/plan-fix — starts the open-ended "make it pass terraform plan" agent loop (see
// services/agentPlanFix.js) against a draft copy of a diagram. Reuses an existing conversation if
// one is given, so the result lands in the same chat thread the user is looking at.
export const startPlanFix = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const { conversationId, diagramId, awsAccountId } = req.validated.body;

  let conversation = conversationId ? await AgentConversation.findOne({ _id: conversationId, workspace: req.user.workspace }) : null;
  if (conversationId && !conversation) throw new ApiError(404, 'Conversation not found');

  const resolvedDiagramId = diagramId ?? conversation?.context?.diagram?.toString();
  const diagram = resolvedDiagramId
    ? await Diagram.findOne({ _id: resolvedDiagramId, workspace: req.user.workspace })
    : await Diagram.findOne({ workspace: req.user.workspace }).sort({ updatedAt: -1 });
  if (!diagram) throw new ApiError(409, "You don't have a diagram yet — open or save one in the builder first.");
  if (!(diagram.nodes ?? []).some((node) => node?.type === 'awsService' && node?.data?.serviceId)) {
    throw new ApiError(409, `"${diagram.name}" has no AWS resources to plan.`);
  }

  // terraform plan talks to AWS (provider auth, data sources), so it needs a real connected
  // account — the same assumed-role credentials a deployment would use, read-only here.
  const accountQuery = { workspace: req.user.workspace, status: 'connected' };
  const resolvedAccountId = awsAccountId ?? conversation?.context?.awsAccount?.toString();
  const awsAccount = resolvedAccountId
    ? await AwsAccount.findOne({ ...accountQuery, _id: resolvedAccountId })
    : await AwsAccount.findOne(accountQuery).sort({ updatedAt: -1 });
  if (!awsAccount) throw new ApiError(409, 'Connect an AWS account first — terraform plan needs real credentials to check the configuration against AWS.');

  if (!conversation) {
    conversation = await AgentConversation.create({
      workspace: req.user.workspace,
      user: req.user._id,
      title: `Make "${diagram.name}" pass terraform plan`.slice(0, 72),
      context: { diagram: diagram._id, awsAccount: awsAccount._id },
    });
  }
  conversation.messages.push({ role: 'user', content: `Make "${diagram.name}" pass terraform plan.` });
  await conversation.save();

  const run = await AgentRun.create({
    workspace: req.user.workspace,
    conversation: conversation._id,
    user: req.user._id,
    kind: 'plan_fix',
    status: 'running',
    fix: createPlanFixState({ diagram, awsAccount }),
    steps: [{ type: 'fix.started', diagramName: diagram.name, at: new Date() }],
  });

  const result = await startAgentRun({
    runId: run._id.toString(),
    message: '',
    history: [],
    userId: req.user._id,
    workspaceId: req.user.workspace,
    diagramId: diagram._id.toString(),
    mode: 'plan_fix',
  });
  if (!result.accepted) await failPlanFixRun(run._id, result.error);

  const freshConversation = await AgentConversation.findById(conversation._id);
  res.status(201).json({ success: true, data: { conversation: freshConversation, runId: run._id.toString() } });
});

// POST /agent/runs/:id/apply-fix — the only path from an agent's draft to the real diagram, and
// it's a user action. Refuses if the diagram was edited after the run started, rather than
// silently overwriting those edits with a draft based on an older version.
export const applyPlanFix = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const run = await AgentRun.findOne({ _id: req.params.id, workspace: req.user.workspace, kind: 'plan_fix' });
  if (!run?.fix) throw new ApiError(404, 'Plan-fix run not found');
  if (run.status !== 'completed') throw new ApiError(409, 'This run has not finished.');
  if (run.fix.appliedToDiagramAt) throw new ApiError(409, 'These changes were already applied to the diagram.');
  if (!run.fix.appliedChanges?.length) throw new ApiError(409, 'This run made no changes to apply.');

  const diagram = await Diagram.findOne({ _id: run.fix.diagramId, workspace: req.user.workspace });
  if (!diagram) throw new ApiError(404, 'The diagram this run was based on no longer exists.');
  if (run.fix.diagramUpdatedAt && diagram.updatedAt?.toISOString() !== run.fix.diagramUpdatedAt) {
    throw new ApiError(409, 'The diagram was edited after this fix run started. Run the fix again so it is based on the latest version.');
  }

  diagram.nodes = run.fix.draft.nodes;
  diagram.edges = run.fix.draft.edges;
  diagram.updatedBy = req.user._id;
  diagram.markModified('nodes');
  diagram.markModified('edges');
  await diagram.save();

  run.fix.appliedToDiagramAt = new Date().toISOString();
  run.markModified('fix');
  await run.save();

  await auditLog(req, 'agent.plan_fix.apply', 'Diagram', diagram._id, { agentRun: run._id, changes: run.fix.appliedChanges.length, outcome: run.fix.outcome });
  res.json({ success: true, data: { diagramId: diagram._id.toString(), fix: planFixPublicView(run) } });
});

export const planCallbackSchema = z.object({
  params: z.object({ runId: z.string().min(1) }),
  body: z.object({
    planIndex: z.coerce.number().int().nonnegative(),
    githubRunId: z.union([z.string(), z.number()]).optional(),
    exitCode: z.coerce.number().int(),
    initFailed: z.boolean().optional().default(false),
    initOutput: z.string().optional().default(''),
    diagnostics: z.array(z.record(z.any())).optional().default([]),
    changeSummary: z.record(z.any()).nullable().optional(),
  }),
});

// POST /agent/plan-fix/:runId/plan-callback — called by terraform-plan.yml's last step, not a
// user: shared-secret auth like terraformValidateCallbackController.js, registered before
// requireAuth. Stores the plan result and resumes the paused agent.
export const receivePlanCallback = asyncHandler(async (req, res) => {
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!env.DEPLOYMENT_CALLBACK_SECRET || provided !== env.DEPLOYMENT_CALLBACK_SECRET) {
    throw new ApiError(401, 'Invalid callback credentials.');
  }

  const { planIndex, githubRunId, ...result } = req.validated.body;
  await completePlanRun(req.validated.params.runId, planIndex, { ...result, githubRunId: githubRunId ? String(githubRunId) : undefined });
  res.json({ success: true });
});

// Creates the AgentRun record and asks the Python service to start working. If the service can't
// even be reached, the run is closed out as 'failed' with the error already in the conversation —
// the UI never polls a run that was never actually going to complete.
async function launchRun({ req, conversation, message, history }) {
  const run = await AgentRun.create({
    workspace: req.user.workspace,
    conversation: conversation._id,
    user: req.user._id,
    status: 'running',
  });

  const result = await startAgentRun({
    runId: run._id.toString(),
    message,
    history,
    userId: req.user._id,
    workspaceId: req.user.workspace,
    diagramId: conversation.context.diagram?.toString(),
  });

  if (!result.accepted) {
    run.status = 'failed';
    await run.save();
    conversation.messages.push({ role: 'assistant', content: result.error, metadata: { error: result.error } });
    await conversation.save();
  }

  return run._id.toString();
}

async function assertAiAccess(req) {
  if (!canUseAiAgent(req.user)) {
    throw new ApiError(403, 'AI Cloud Agent is available to Super Admin accounts only.');
  }
}
