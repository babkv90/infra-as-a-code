import { Diagram } from '../models/Diagram.js';
import { env } from '../config/env.js';
import { mintAgentToken } from '../services/agentIdentity.js';

// Only needs to wait for Python to *accept* the run (schedule the background LangGraph task), not
// finish it — completion is reported later via the callback in internalAgentToolsController.js's
// postRunComplete, and the browser polls Express's own AgentRun doc (agentController.js's
// getRunStatus) rather than this request. See the M1 plan's run-lifecycle diagram.
const AGENT_START_TIMEOUT_MS = 10_000;

const RUN_SCOPES = ['diagram:read', 'terraform:generate', 'aws:read:billing'];

export async function startAgentRun({ runId, message, history = [], userId, workspaceId, diagramId }) {
  const resolvedDiagramId = diagramId ?? (await mostRecentDiagramId(workspaceId));
  if (!resolvedDiagramId) {
    return { accepted: false, error: "You don't have a diagram yet — open or save one in the builder first." };
  }

  const token = mintAgentToken({ userId, workspaceId, runId, scopes: RUN_SCOPES });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_START_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.AGENT_API_URL.replace(/\/$/, '')}/runs/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, history, diagramId: resolvedDiagramId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(typeof result?.detail === 'string' ? result.detail : 'Agent service rejected the run.');
    }

    return { accepted: true };
  } catch (error) {
    const message2 = error instanceof Error ? error.message : 'Unknown agent service error';
    return {
      accepted: false,
      error:
        `The infraflow AI agent service is not available right now. ` +
        `Start the FastAPI service at ${env.AGENT_API_URL} (see services/agents/README.md). Details: ${message2}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mostRecentDiagramId(workspaceId) {
  const diagram = await Diagram.findOne({ workspace: workspaceId }).sort({ updatedAt: -1 }).select('_id').lean();
  return diagram?._id?.toString();
}
