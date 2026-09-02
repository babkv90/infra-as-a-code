import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { Diagram } from '../models/Diagram.js';
import { env } from '../config/env.js';
import { mintAgentToken, mintRagAdminToken } from '../services/agentIdentity.js';
import { makeEnvCredentials } from '../services/awsRoleCredentials.js';

// Only needs to wait for the run to be *accepted* (HTTP mode) or *queued* (Lambda mode), not
// finished — completion is reported later via the callback in internalAgentToolsController.js's
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
  const payload = { message, history, diagramId: resolvedDiagramId };

  return env.AGENT_INVOKE_MODE === 'lambda'
    ? startViaLambda(token, payload)
    : startViaHttp(token, payload);
}

// Production: the agent service is a zip Lambda (services/agents/app/lambda_handler.py) that runs
// the whole LangGraph graph inside one invocation. InvocationType 'Event' hands the payload to
// Lambda's async queue and returns immediately with StatusCode 202 — Lambda then runs it (with its
// own retry + dead-letter queue on failure), and the run reports itself back to Express via the
// same /internal/agent-tools/* callbacks the HTTP path uses.
let _lambdaClient;
function lambdaClient() {
  if (!_lambdaClient) {
    _lambdaClient = new LambdaClient({ region: env.AGENT_LAMBDA_REGION, credentials: makeEnvCredentials() });
  }
  return _lambdaClient;
}

async function startViaLambda(token, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_START_TIMEOUT_MS);

  try {
    const response = await lambdaClient().send(
      new InvokeCommand({
        FunctionName: env.AGENT_LAMBDA_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ token, ...payload })),
      }),
      { abortSignal: controller.signal },
    );

    // Async invokes come back 202 when queued. Anything else (throttling that slipped past the
    // SDK's own retries, a 4xx) means the run never got scheduled.
    if (response.StatusCode !== 202 && response.StatusCode !== 200) {
      throw new Error(`Lambda invoke returned status ${response.StatusCode}${response.FunctionError ? ` (${response.FunctionError})` : ''}`);
    }

    return { accepted: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown Lambda invoke error';
    return {
      accepted: false,
      error:
        `Could not start the infraflow AI agent run — invoking ${env.AGENT_LAMBDA_FUNCTION} ` +
        `(region ${env.AGENT_LAMBDA_REGION}) failed. Check the function name, the backend's IAM ` +
        `permission to lambda:InvokeFunction it, and CloudWatch logs. Details: ${detail}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Local dev, or the service running as a long-lived container: POST /runs/start, which schedules a
// background task and returns 2xx immediately (see services/agents/app/api/routes_runs.py).
async function startViaHttp(token, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_START_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.AGENT_API_URL.replace(/\/$/, '')}/runs/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(typeof result?.detail === 'string' ? result.detail : 'Agent service rejected the run.');
    }

    return { accepted: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown agent service error';
    return {
      accepted: false,
      error:
        `The infraflow AI agent service is not available right now. ` +
        `Start the FastAPI service at ${env.AGENT_API_URL} (see services/agents/README.md). Details: ${detail}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mostRecentDiagramId(workspaceId) {
  const diagram = await Diagram.findOne({ workspace: workspaceId }).sort({ updatedAt: -1 }).select('_id').lean();
  return diagram?._id?.toString();
}

// --- Knowledge base (superadmin) ---------------------------------------------------------------
//
// Ingestion embeds every chunk of a document, so give it far longer than a run-start's 10s.
const RAG_TIMEOUT_MS = 90_000;

/** GET the knowledge-base document list. -> { ok, documents } | { ok: false, error } */
export async function ragListDocuments({ userId, workspaceId }) {
  const token = mintRagAdminToken({ userId, workspaceId });
  return env.AGENT_INVOKE_MODE === 'lambda'
    ? invokeRagLambda('rag.list', token, {})
    : ragHttp('GET', '/rag/documents', token);
}

/** Ingest one uploaded document. -> { ok, document } | { ok: false, error, status } */
export async function ragIngestDocument({ userId, workspaceId, filename, contentType, buffer }) {
  const token = mintRagAdminToken({ userId, workspaceId });
  if (env.AGENT_INVOKE_MODE === 'lambda') {
    return invokeRagLambda('rag.ingest', token, {
      filename,
      contentType: contentType ?? '',
      contentB64: Buffer.from(buffer).toString('base64'),
    });
  }
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType || 'application/octet-stream' }), filename || 'upload');
  return ragHttp('POST', '/rag/documents', token, { body: form });
}

/** Delete one document (and its chunks, via ON DELETE CASCADE). -> { ok, deleted } | { ok: false, error } */
export async function ragDeleteDocument({ userId, workspaceId, documentId }) {
  const token = mintRagAdminToken({ userId, workspaceId });
  return env.AGENT_INVOKE_MODE === 'lambda'
    ? invokeRagLambda('rag.delete', token, { documentId })
    : ragHttp('DELETE', `/rag/documents/${encodeURIComponent(documentId)}`, token);
}

async function invokeRagLambda(op, token, extra) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);
  try {
    const response = await lambdaClient().send(
      new InvokeCommand({
        FunctionName: env.AGENT_LAMBDA_FUNCTION,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ op, token, ...extra })),
      }),
      { abortSignal: controller.signal },
    );

    if (response.FunctionError) {
      const raw = response.Payload ? Buffer.from(response.Payload).toString('utf8') : '';
      return { ok: false, error: `Agent Lambda raised an error (${response.FunctionError}): ${raw.slice(0, 500)}` };
    }
    const parsed = response.Payload ? JSON.parse(Buffer.from(response.Payload).toString('utf8')) : {};
    if (parsed.ok === false) {
      return { ok: false, error: parsed.message || parsed.error || 'Knowledge base operation failed.', status: parsed.error === 'ingest_rejected' ? 422 : 502 };
    }
    return { ok: true, ...parsed };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown Lambda invoke error';
    return { ok: false, error: `Could not reach the agent Lambda (${env.AGENT_LAMBDA_FUNCTION}) for ${op}: ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

async function ragHttp(method, path, token, { body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.AGENT_API_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body,
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: typeof result?.detail === 'string' ? result.detail : `Agent service returned ${response.status}.`, status: response.status === 422 ? 422 : 502 };
    }
    return { ok: true, ...(result ?? {}) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown agent service error';
    return { ok: false, error: `The agent service at ${env.AGENT_API_URL} is not reachable: ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}
