import { apiRequest as sharedApiRequest } from '../utils/apiClient';

// The AI agent chat endpoints (/agent/conversations/...) are served by the same main backend as
// every other API — the Express app mounts `apiRouter.use('/agent', agentRouter)` alongside
// /deployments, /tickets, etc., and that router itself proxies to a separate RAG service
// (RAG_API_URL) server-side. There is no separate frontend-facing agent service, so this uses the
// same shared client/base-URL as everything else instead of a bespoke env var.
const agentRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Agent request failed');

export type AgentMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    contexts?: Array<{
      id: string;
      score: number;
      text: string;
      metadata?: Record<string, unknown>;
    }>;
    error?: string;
  };
  createdAt?: string;
};

export type AgentConversation = {
  _id: string;
  title: string;
  messages: AgentMessage[];
  createdAt?: string;
  updatedAt?: string;
};

export async function createAgentConversation(message?: string) {
  return agentRequest<AgentConversation>('/agent/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title: message ? message.slice(0, 72) : 'AWS Well-Architected chat',
      message,
    }),
  });
}

export async function sendAgentMessage(conversationId: string, message: string) {
  return agentRequest<AgentConversation>(`/agent/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}
