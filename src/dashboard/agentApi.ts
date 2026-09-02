import { apiRequest as sharedApiRequest } from '../utils/apiClient';

// The AI agent chat endpoints (/agent/conversations/...) are served by the same main backend as
// every other API — the Express app mounts `apiRouter.use('/agent', agentRouter)` alongside
// /deployments, /tickets, etc., and that router itself proxies to the Python multi-agent service
// (AGENT_API_URL) server-side. There is no separate frontend-facing agent service, so this uses
// the same shared client/base-URL as everything else instead of a bespoke env var.
const agentRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Agent request failed');

export type AgentName = 'architect' | 'terraform' | 'cost' | 'security';

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
    findings?: AgentFinding[];
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

// One entry per graph-node transition the run went through — see services/agents/app/runner.py,
// which is the only thing that ever produces these.
export type AgentStepEvent = {
  type: 'grounding.ready' | 'route.decided' | 'agent.finished' | 'changeplan.ready';
  at?: string;
  route?: AgentName[];
  reason?: string;
  agent?: AgentName;
  summary?: string;
  findingsCount?: number;
  itemCount?: number;
};

export type AgentFinding = {
  agent: AgentName;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  evidence: Array<{ kind: 'node' | 'terraform_block'; ref: string }>;
};

// A proposed, read-only set of diagram edits (M2) — see services/agents/app/changeplan.py. Never
// applied automatically; this is only ever rendered for a human to review.
export type ChangeOp = 'add_node' | 'update_node' | 'remove_node' | 'add_edge' | 'update_edge' | 'remove_edge';

export type ChangeItem = {
  op: ChangeOp;
  target?: string | null;
  serviceId?: string | null;
  data?: Record<string, unknown>;
  rationale: string;
  evidence: Array<{ kind: 'node' | 'terraform_block'; ref: string }>;
};

export type ChangePlan = {
  summary: string;
  items: ChangeItem[];
};

export type AgentRunStatus = {
  status: 'running' | 'completed' | 'failed';
  route: AgentName[];
  steps: AgentStepEvent[];
  findings: AgentFinding[];
  changePlan: ChangePlan | null;
  conversation: AgentConversation;
};

export type AgentRunResult = {
  conversation: AgentConversation;
  runId?: string;
};

/** POST /agent/conversations — starts a new chat thread, optionally with an opening message. */
export async function createAgentConversation(message?: string) {
  return agentRequest<AgentRunResult>('/agent/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title: message ? message.slice(0, 72) : 'AI Cloud Agent chat',
      message,
    }),
  });
}

/** POST /agent/conversations/:id/messages — appends a follow-up message to an existing thread. */
export async function sendAgentMessage(conversationId: string, message: string) {
  return agentRequest<AgentRunResult>(`/agent/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/** GET /agent/runs/:id/status — polled by AgentPage.tsx (see RUN_POLL_MS) while a run is active. */
export async function getAgentRunStatus(runId: string) {
  return agentRequest<AgentRunStatus>(`/agent/runs/${runId}/status`);
}
