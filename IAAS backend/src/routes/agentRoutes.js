import { Router } from 'express';
import { addMessage, addMessageSchema, createConversation, createConversationSchema, listConversations } from '../controllers/agentController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const agentRouter = Router();

agentRouter.use(requireAuth);
agentRouter.get('/conversations', listConversations);
agentRouter.post('/conversations', validateRequest(createConversationSchema), createConversation);
agentRouter.post('/conversations/:id/messages', validateRequest(addMessageSchema), addMessage);
