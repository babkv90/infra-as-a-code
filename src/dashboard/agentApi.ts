import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_AGENT_API_BASE_URL ?? 'http://127.0.0.1:4001/api/v1';

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

async function agentRequest<T>(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Agent request failed');
  }

  return result.data as T;
}
