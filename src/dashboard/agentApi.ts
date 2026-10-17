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
  type:
    | 'grounding.ready'
    | 'route.decided'
    | 'agent.finished'
    | 'changeplan.ready'
    // plan_fix runs — see IAAS backend/src/services/agentPlanFix.js and services/agents/app/planfix
    | 'fix.started'
    | 'fix.note'
    | 'fix.changes'
    | 'plan.started'
    | 'plan.finished'
    | 'fix.finished'
    | 'fix.failed';
  at?: string;
  route?: AgentName[];
  reason?: string;
  agent?: AgentName;
  summary?: string;
  findingsCount?: number;
  itemCount?: number;
  text?: string;
  applied?: number;
  rejected?: number;
  revision?: number;
  index?: number;
  status?: PlanRunStatus;
  errorCount?: number;
  firstError?: string | null;
  changeSummary?: PlanChangeSummary | null;
  outcome?: PlanFixOutcome;
};

export type PlanRunStatus = 'running' | 'passed' | 'failed' | 'error';
export type PlanFixOutcome = 'passed' | 'gave_up';
export type PlanChangeSummary = { add: number; change: number; remove: number };

export type PlanDiagnostic = {
  summary: string;
  detail?: string;
  address?: string;
  line?: number;
  nodeId?: string;
};

export type PlanRun = {
  index: number;
  revision: number;
  status: PlanRunStatus;
  executor: 'local' | 'github-actions';
  diagnostics: PlanDiagnostic[];
  errorCount: number;
  changeSummary: PlanChangeSummary | null;
  error: string | null;
  githubRunUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AppliedPlanFixChange = Omit<ChangeItem, 'evidence'> & { revision: number; createdId?: string };

// What the browser sees of a plan_fix run — the draft itself and the agent's transcript stay
// server-side; only a user's applyPlanFix call ever writes the draft to the real diagram.
export type PlanFixView = {
  diagramId: string;
  diagramName: string;
  revision: number;
  outcome: PlanFixOutcome | null;
  summary: string;
  appliedChanges: AppliedPlanFixChange[];
  planRuns: PlanRun[];
  limits: { maxPlanRuns: number; maxChangeItems: number; maxAgentTurns: number };
  appliedToDiagramAt: string | null;
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
  kind: 'chat' | 'plan_fix';
  status: 'running' | 'completed' | 'failed';
  fix: PlanFixView | null;
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

/**
 * POST /agent/plan-fix — starts the "make it pass terraform plan" agent loop on a draft copy of the
 * conversation's diagram (or the workspace's most recent one). Runs for minutes, not seconds.
 */
export async function startPlanFix(conversationId?: string) {
  return agentRequest<AgentRunResult>('/agent/plan-fix', {
    method: 'POST',
    body: JSON.stringify(conversationId && conversationId !== 'pending' ? { conversationId } : {}),
  });
}

/** POST /agent/runs/:id/apply-fix — writes a finished plan-fix run's draft to the real diagram. */
export async function applyPlanFix(runId: string) {
  return agentRequest<{ diagramId: string; fix: PlanFixView }>(`/agent/runs/${runId}/apply-fix`, { method: 'POST' });
}
