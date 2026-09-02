import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Short-lived, scoped machine token minted per agent run — never the user's own session token.
// The Python agent service treats this as its identity for every callback into
// /internal/agent-tools/*, and requireAgentScope.js is the only thing that verifies it.
export function mintAgentToken({ userId, workspaceId, runId, scopes }) {
  return jwt.sign(
    {
      sub: `agent:${runId}`,
      aud: 'agent-tools',
      act: String(userId),
      workspace: String(workspaceId),
      scope: scopes,
      run: runId,
    },
    env.AGENT_TOOL_SECRET,
    { expiresIn: '5m' },
  );
}

// Machine token for the superadmin Knowledge Base operations (agentBridge.js's rag* helpers). Same
// secret/audience the agent service already verifies, but scoped to `rag:admin` and tied to no run —
// the superadmin route is what enforces the caller is actually a super admin before this is minted.
export function mintRagAdminToken({ userId, workspaceId }) {
  return jwt.sign(
    {
      sub: `rag:${userId}`,
      aud: 'agent-tools',
      act: String(userId),
      workspace: String(workspaceId ?? ''),
      scope: ['rag:admin'],
    },
    env.AGENT_TOOL_SECRET,
    { expiresIn: '5m' },
  );
}
