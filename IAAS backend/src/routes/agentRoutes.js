// User-facing AI Cloud Agent routes, mounted at /agent (see routes/index.js) and gated by
// requireAuth — a real logged-in user, as opposed to internalAgentTools.js's machine-JWT-only
// routes that the Python service calls back into.
import { Router } from 'express';
import {
  addMessage,
  addMessageSchema,
  applyPlanFix,
  createConversation,
  createConversationSchema,
  getRunStatus,
  listConversations,
  planCallbackSchema,
  receivePlanCallback,
  startPlanFix,
  startPlanFixSchema,
} from '../controllers/agentController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const agentRouter = Router();

// Registered before requireAuth deliberately — the caller is terraform-plan.yml's own callback
// step (shared-secret auth, see receivePlanCallback), never a logged-in user.
agentRouter.post('/plan-fix/:runId/plan-callback', validateRequest(planCallbackSchema), receivePlanCallback);

agentRouter.use(requireAuth);
agentRouter.get('/conversations', listConversations); // chat history list
agentRouter.post('/conversations', validateRequest(createConversationSchema), createConversation); // new thread (+ optional first message)
agentRouter.post('/conversations/:id/messages', validateRequest(addMessageSchema), addMessage); // follow-up message
agentRouter.get('/runs/:id/status', getRunStatus); // polled by AgentPage.tsx while a run is in flight
agentRouter.post('/plan-fix', validateRequest(startPlanFixSchema), startPlanFix); // "make it pass terraform plan" agent loop
agentRouter.post('/runs/:id/apply-fix', applyPlanFix); // user applies a finished plan-fix draft to the real diagram
