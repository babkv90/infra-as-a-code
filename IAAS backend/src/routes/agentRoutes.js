// User-facing AI Cloud Agent routes, mounted at /agent (see routes/index.js) and gated by
// requireAuth — a real logged-in user, as opposed to internalAgentTools.js's machine-JWT-only
// routes that the Python service calls back into.
import { Router } from 'express';
import {
  addMessage,
  addMessageSchema,
  createConversation,
  createConversationSchema,
  getRunStatus,
  listConversations,
} from '../controllers/agentController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const agentRouter = Router();

agentRouter.use(requireAuth);
agentRouter.get('/conversations', listConversations); // chat history list
agentRouter.post('/conversations', validateRequest(createConversationSchema), createConversation); // new thread (+ optional first message)
agentRouter.post('/conversations/:id/messages', validateRequest(addMessageSchema), addMessage); // follow-up message
agentRouter.get('/runs/:id/status', getRunStatus); // polled by AgentPage.tsx while a run is in flight
