import { z } from 'zod';
import { AgentConversation } from '../models/AgentConversation.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { canUseAiAgent } from '../utils/accessControl.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { answerCloudQuestion } from '../utils/agentResponder.js';

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

export const listConversations = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const conversations = await AgentConversation.find({ workspace: req.user.workspace }).sort({ updatedAt: -1 });
  res.json({ success: true, data: conversations });
});

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

  if (req.validated.body.message) {
    const answer = await answerCloudQuestion(req.validated.body.message);
    conversation.messages.push({ role: 'user', content: req.validated.body.message });
    conversation.messages.push({ role: 'assistant', content: answer.content, metadata: answer.metadata });
    await conversation.save();
  }

  res.status(201).json({ success: true, data: conversation });
});

export const addMessage = asyncHandler(async (req, res) => {
  await assertAiAccess(req);
  const conversation = await AgentConversation.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!conversation) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  const message = req.validated.body.message;
  const answer = await answerCloudQuestion(message);
  conversation.messages.push({ role: 'user', content: message });
  conversation.messages.push({ role: 'assistant', content: answer.content, metadata: answer.metadata });
  await conversation.save();

  res.json({ success: true, data: conversation });
});

async function assertAiAccess(req) {
  const workspace = await Workspace.findById(req.user.workspace);
  if (!canUseAiAgent(req.user, workspace)) {
    throw new ApiError(403, 'AI support is available for Pro, Enterprise, and Super admin accounts.');
  }
}
