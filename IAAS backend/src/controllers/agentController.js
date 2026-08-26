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
import { ApiError } from '../utils/ApiError.js';
import { canUseAiAgent } from '../utils/accessControl.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { startAgentRun } from '../utils/agentBridge.js';

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
      status: run.status,
      route: run.route,
      steps: run.steps,
      findings: run.findings,
      conversation,
    },
  });
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
