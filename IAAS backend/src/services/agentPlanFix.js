// "Make it pass terraform plan" — the Express half of the open-ended plan-fix agent loop.
//
// The Python agent (services/agents/app/planfix) decides *what* to do: which config to change,
// when to run a plan, when to stop. This module owns everything it must not be trusted with:
//   - the draft: a private copy of the diagram the agent edits. The real Diagram is only ever
//     written by a user, via agentController.js's applyPlanFix, after reviewing the result.
//   - mechanical gates on every edit (no deleting resources, no inventing secrets, real ids only).
//   - running the real `terraform plan` (local CLI or GitHub Actions — the same two executors
//     deployments use) with the customer's assumed-role credentials, which never leave Express.
//   - the budget (plan runs, change items) and the finish gate: the agent can only claim
//     "passed" if the latest plan on the *current* draft revision actually passed.
//
// A run spans several agent invocations: requestPlanRun persists the agent's conversation and
// pauses it, completePlanRun stores the plan result and resumes the agent with a fresh token.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { AgentConversation } from '../models/AgentConversation.js';
import { AgentRun } from '../models/AgentRun.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { storage } from '../storage/index.js';
import { startAgentRun } from '../utils/agentBridge.js';
import { normalizeDiagramSnapshot } from '../utils/diagramSchema.js';
import { validateDiagram } from '../utils/diagramValidator.js';
import { generateTerraform, lambdaZipUploadIdsFromNodes, terraformResourceNameForNode } from '../utils/terraformGenerator.js';
import { validateGeneratedTerraform } from '../utils/terraformValidator.js';
import { assumeAwsRole } from './awsRoleCredentials.js';
import { dispatchGithubWorkflow, getBranchHeadSha, syncFilesToGithub, waitForLatestWorkflowRun } from './githubActionsClient.js';
import { lambdaSourceHashesTfvarsContent } from './githubTerraformRunner.js';
import { getPluginCacheDir, runProcess, stageLambdaZipUploads } from './terraformDeploymentRunner.js';
// Same frontend source of truth internalAgentToolsController.js already imports via tsx — new
// nodes get exactly the defaults the builder's own palette would give them.
import { serviceById } from '../../../src/data/awsServices.ts';

export const PLAN_FIX_LIMITS = Object.freeze({
  maxPlanRuns: 5,
  maxChangeItems: 40,
  maxAgentTurns: 40,
});

const PLAN_WORKFLOW_ID = 'terraform-plan.yml';
const MAX_DIAGNOSTICS = 15;
const MAX_VALUE_JSON_LENGTH = 2000;
const ALLOWED_OPS = new Set(['add_node', 'update_node', 'add_edge', 'update_edge', 'remove_edge']);
const EDGE_PATCH_KEYS = new Set(['label', 'connectionType', 'protocol', 'port']);
// Same pattern importDiagram.ts uses to spot secrets. An agent that "fixes" a missing password by
// inventing one has produced a config that passes plan and is wrong — that needs a human.
const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential)/i;

// ---------------------------------------------------------------------------------------------
// Run creation
// ---------------------------------------------------------------------------------------------

export function createPlanFixState({ diagram, awsAccount }) {
  return {
    diagramId: diagram._id.toString(),
    diagramName: diagram.name,
    diagramUpdatedAt: diagram.updatedAt?.toISOString?.() ?? null,
    awsAccountId: awsAccount._id.toString(),
    draft: {
      nodes: structuredClone(diagram.nodes ?? []),
      edges: structuredClone(diagram.edges ?? []),
      activeRegion: diagram.activeRegion,
    },
    revision: 0,
    appliedChanges: [],
    planRuns: [],
    limits: { ...PLAN_FIX_LIMITS },
    agent: { messages: [], pendingToolCallId: null, turns: 0 },
    outcome: null,
    summary: '',
    appliedToDiagramAt: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Draft edits (pure — unit tested in test/agentPlanFix.test.js)
// ---------------------------------------------------------------------------------------------

/**
 * Applies a batch of ChangeItems to a draft. Every item is checked independently: a bad item is
 * rejected with a reason the agent can act on, and never blocks the good ones next to it.
 * Returns the new draft plus what was applied (with any new node/edge ids) and rejected.
 */
export function applyChangeItems(draft, items) {
  const nodes = structuredClone(draft.nodes ?? []);
  const edges = structuredClone(draft.edges ?? []);
  const applied = [];
  const rejected = [];

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const outcome = applyOneChange(nodes, edges, item);
    if (outcome.error) {
      rejected.push({ index, op: item?.op ?? null, reason: outcome.error });
    } else {
      applied.push({ index, ...sanitizeItem(item), ...(outcome.createdId ? { createdId: outcome.createdId } : {}) });
    }
  });

  return { draft: { ...draft, nodes, edges }, applied, rejected };
}

function applyOneChange(nodes, edges, item) {
  if (!isRecord(item) || typeof item.op !== 'string') return { error: 'Each change needs an "op".' };
  if (item.op === 'remove_node') {
    return {
      error:
        "Removing resources isn't allowed while fixing a plan — deleting the failing resource would make the plan pass without fixing the design. Fix its configuration instead, or finish with gave_up and explain what a human needs to decide.",
    };
  }
  if (!ALLOWED_OPS.has(item.op)) return { error: `Unknown op "${item.op}".` };
  if (typeof item.rationale !== 'string' || !item.rationale.trim()) return { error: 'Every change needs a one-sentence "rationale".' };

  const data = isRecord(item.data) ? item.data : {};

  if (item.op === 'update_node') {
    const node = nodes.find((candidate) => candidate.id === item.target);
    if (!node || !node.data?.serviceId) return { error: `No AWS resource node with id "${item.target}" in the draft.` };

    const { config, label, error } = splitNodePatch(data);
    if (error) return { error };
    if (!config && label === undefined) return { error: 'update_node needs config keys to change (or a new "label").' };

    if (label !== undefined) node.data.label = label;
    if (config) {
      const nextConfig = { ...(node.data.config ?? {}) };
      for (const [key, value] of Object.entries(config)) {
        if (value === null) delete nextConfig[key];
        else nextConfig[key] = value;
      }
      node.data.config = nextConfig;
    }
    return {};
  }

  if (item.op === 'add_node') {
    const serviceId = item.service_id ?? item.serviceId;
    const service = serviceById[serviceId];
    if (!service) return { error: `"${serviceId}" is not a service id this builder supports.` };

    const { config, label, error } = splitNodePatch(data);
    if (error) return { error };

    const id = uniqueId(`agent-${serviceId}`, new Set(nodes.map((node) => node.id)));
    const maxX = nodes.reduce((max, node) => Math.max(max, Number(node.position?.x) || 0), 0);
    const minY = nodes.reduce((min, node) => Math.min(min, Number(node.position?.y) || 0), Number.POSITIVE_INFINITY);
    nodes.push({
      id,
      type: 'awsService',
      position: { x: maxX + 280, y: Number.isFinite(minY) ? minY : 0 },
      data: {
        serviceId,
        serviceName: service.name,
        label: label ?? service.name,
        region: String(config?.region ?? service.defaultConfig?.region ?? 'ap-south-1'),
        arn: '',
        status: 'unknown',
        color: service.color,
        icon: service.icon,
        subLabel: service.subLabel,
        ports: service.ports,
        config: { ...(service.defaultConfig ?? {}), ...withoutNulls(config ?? {}) },
      },
    });
    return { createdId: id };
  }

  if (item.op === 'add_edge') {
    const source = data.source;
    const target = data.target;
    const nodeIds = new Set(nodes.map((node) => node.id));
    if (!nodeIds.has(source) || !nodeIds.has(target)) return { error: `add_edge needs real "source" and "target" node ids (got "${source}" -> "${target}").` };
    if (source === target) return { error: 'An edge cannot connect a node to itself.' };
    if (edges.some((edge) => edge.source === source && edge.target === target)) return { error: `An edge ${source} -> ${target} already exists.` };

    const id = uniqueId(`agent-edge-${source}-${target}`, new Set(edges.map((edge) => edge.id)));
    const connectionType = typeof data.connectionType === 'string' ? data.connectionType : 'data';
    edges.push({
      id,
      source,
      target,
      type: 'flowEdge',
      data: {
        label: typeof data.label === 'string' ? data.label : connectionType,
        connectionType,
        protocol: typeof data.protocol === 'string' ? data.protocol : 'HTTPS',
        port: data.port === undefined ? '443' : String(data.port),
      },
    });
    return { createdId: id };
  }

  const edge = edges.find((candidate) => candidate.id === item.target);
  if (!edge) return { error: `No edge with id "${item.target}" in the draft.` };

  if (item.op === 'remove_edge') {
    edges.splice(edges.indexOf(edge), 1);
    return {};
  }

  // update_edge
  const unknownKeys = Object.keys(data).filter((key) => !EDGE_PATCH_KEYS.has(key));
  if (unknownKeys.length) return { error: `update_edge can only change ${[...EDGE_PATCH_KEYS].join(', ')} (got ${unknownKeys.join(', ')}).` };
  edge.data = { ...(edge.data ?? {}), ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])) };
  return {};
}

// Accepts either { config: {...}, label } or a flat { key: value } patch — models produce both.
function splitNodePatch(data) {
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : undefined;
  const rawConfig = isRecord(data.config) ? data.config : Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'label'));
  const keys = Object.keys(rawConfig);
  if (!keys.length) return { config: undefined, label };

  const sensitive = keys.filter((key) => SENSITIVE_KEY.test(key) && rawConfig[key] !== null);
  if (sensitive.length) {
    return {
      error: `Refusing to set sensitive value(s) ${sensitive.join(', ')} — a secret must come from the user, never be invented. Finish with gave_up and say which value the user has to provide.`,
    };
  }
  const oversized = keys.filter((key) => JSON.stringify(rawConfig[key] ?? null).length > MAX_VALUE_JSON_LENGTH);
  if (oversized.length) return { error: `Value(s) too large for ${oversized.join(', ')}.` };

  return { config: rawConfig, label };
}

function sanitizeItem(item) {
  return {
    op: item.op,
    target: item.target ?? null,
    serviceId: item.service_id ?? item.serviceId ?? null,
    data: isRecord(item.data) ? item.data : {},
    rationale: String(item.rationale ?? ''),
  };
}

// ---------------------------------------------------------------------------------------------
// Draft artifacts + agent-facing state
// ---------------------------------------------------------------------------------------------

export function buildDraftArtifacts(fix) {
  const snapshot = normalizeDiagramSnapshot(fix.draft);
  const region = snapshot.activeRegion ?? fix.draft.activeRegion;
  const terraform = generateTerraform(snapshot.nodes, snapshot.edges, { region, suffix: fix.diagramId, remoteStateBackend: false });
  const staticIssues = [...validateDiagram(snapshot.nodes, snapshot.edges, region), ...validateGeneratedTerraform(terraform)];
  return { nodes: snapshot.nodes, edges: snapshot.edges, region, terraform, staticIssues };
}

export function planFixStateForAgent(run) {
  const fix = run.fix;
  const artifacts = buildDraftArtifacts(fix);
  return {
    diagramName: fix.diagramName,
    activeRegion: artifacts.region,
    revision: fix.revision,
    nodes: artifacts.nodes,
    edges: artifacts.edges,
    terraform: artifacts.terraform,
    staticIssues: artifacts.staticIssues,
    planRuns: fix.planRuns.map(publicPlanRun),
    appliedChangeCount: fix.appliedChanges.length,
    limits: fix.limits,
    agent: fix.agent,
  };
}

// What the browser sees (agentController.js's getRunStatus) — no draft nodes, no agent transcript.
export function planFixPublicView(run) {
  const fix = run.fix;
  if (!fix) return null;
  return {
    diagramId: fix.diagramId,
    diagramName: fix.diagramName,
    revision: fix.revision,
    outcome: fix.outcome,
    summary: fix.summary,
    appliedChanges: fix.appliedChanges,
    planRuns: fix.planRuns.map(publicPlanRun),
    limits: fix.limits,
    appliedToDiagramAt: fix.appliedToDiagramAt,
  };
}

function publicPlanRun(planRun) {
  return {
    index: planRun.index,
    revision: planRun.revision,
    status: planRun.status,
    executor: planRun.executor,
    diagnostics: planRun.diagnostics ?? [],
    errorCount: planRun.errorCount ?? 0,
    changeSummary: planRun.changeSummary ?? null,
    error: planRun.error ?? null,
    githubRunUrl: planRun.githubRunUrl ?? null,
    startedAt: planRun.startedAt,
    finishedAt: planRun.finishedAt ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Agent tool handlers (called from internalAgentToolsController.js)
// ---------------------------------------------------------------------------------------------

export async function recordAgentChanges(run, items) {
  const fix = run.fix;
  const batch = Array.isArray(items) ? items : [];
  if (!batch.length) return { applied: [], rejected: [], revision: fix.revision, ...draftSummary(fix) };

  if (fix.appliedChanges.length + batch.length > fix.limits.maxChangeItems) {
    return {
      applied: [],
      rejected: batch.map((item, index) => ({ index, op: item?.op ?? null, reason: `Change budget exhausted (${fix.limits.maxChangeItems} edits per run).` })),
      revision: fix.revision,
      ...draftSummary(fix),
    };
  }

  const { draft, applied, rejected } = applyChangeItems(fix.draft, batch);
  if (applied.length) {
    fix.draft = draft;
    fix.revision += 1;
    fix.appliedChanges.push(...applied.map(({ index: _index, ...change }) => ({ ...change, revision: fix.revision })));
  }
  run.steps.push({ type: 'fix.changes', applied: applied.length, rejected: rejected.length, revision: fix.revision, at: new Date() });
  await saveFix(run);

  return { applied, rejected, revision: fix.revision, ...draftSummary(fix) };
}

function draftSummary(fix) {
  const { nodes, edges, terraform, staticIssues } = buildDraftArtifacts(fix);
  return { nodes, edges, terraform, staticIssues };
}

export async function requestPlanRun(run, { messages, toolCallId, turns }) {
  const fix = run.fix;
  const used = fix.planRuns.length;
  const last = fix.planRuns.at(-1);

  if (used >= fix.limits.maxPlanRuns) {
    return { suspended: false, error: `Plan budget exhausted (${fix.limits.maxPlanRuns} runs). Finish now — passed only if the last plan passed, otherwise gave_up.` };
  }
  if (last?.status === 'running') return { suspended: false, error: 'A plan is already running for this draft.' };
  if (last && last.revision === fix.revision && last.status !== 'error') {
    return { suspended: false, error: `Nothing changed since plan #${last.index + 1} (${last.status}). Make a change with apply_changes before planning again.` };
  }

  const artifacts = buildDraftArtifacts(fix);
  const index = used;
  const executor = planExecutor();
  fix.planRuns.push({ index, revision: fix.revision, status: 'running', executor, startedAt: new Date().toISOString() });
  fix.agent = { messages: Array.isArray(messages) ? messages : [], pendingToolCallId: toolCallId ?? null, turns: Number(turns) || 0 };
  run.steps.push({ type: 'plan.started', index, revision: fix.revision, at: new Date() });
  await saveFix(run);

  const account = await AwsAccount.findOne({ _id: fix.awsAccountId, workspace: run.workspace });
  if (!account) {
    await markPlanRunError(run._id, index, 'The AWS account this run was started with is no longer connected.');
    return { suspended: false, error: 'The AWS account is no longer connected — plans cannot run. Finish with gave_up.' };
  }

  const uploadIds = lambdaZipUploadIdsFromNodes(artifacts.nodes);
  try {
    if (executor === 'github-actions') {
      const githubRun = await dispatchGithubPlan({ runId: run._id.toString(), index, terraform: artifacts.terraform, account, uploadIds });
      await AgentRun.updateOne(
        { _id: run._id },
        { $set: { [`fix.planRuns.${index}.githubRunId`]: githubRun.githubRunId, [`fix.planRuns.${index}.githubRunUrl`]: githubRun.htmlUrl } },
      );
    } else {
      // Not awaited: the agent's HTTP call returns now and the agent pauses. completePlanRun
      // resumes it once terraform finishes, exactly like the GitHub callback path does.
      void runLocalPlan({ runId: run._id.toString(), index, terraform: artifacts.terraform, account, uploadIds });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markPlanRunError(run._id, index, message);
    return { suspended: false, error: `Could not start terraform plan: ${message}` };
  }

  return { suspended: true, planIndex: index };
}

export async function finishPlanFix(run, { outcome, summary, messages, turns }) {
  const fix = run.fix;
  if (!['passed', 'gave_up'].includes(outcome)) return { accepted: false, reason: 'outcome must be "passed" or "gave_up".' };

  if (outcome === 'passed') {
    const last = fix.planRuns.at(-1);
    if (!last || last.status !== 'passed') {
      return { accepted: false, reason: 'You can only finish as passed after a terraform plan passes. Run a plan, or finish with gave_up.' };
    }
    if (last.revision !== fix.revision) {
      return { accepted: false, reason: `The draft changed (revision ${fix.revision}) after the last passing plan (revision ${last.revision}). Run a plan on the current draft first.` };
    }
  }

  fix.outcome = outcome;
  fix.summary = String(summary ?? '').slice(0, 4000);
  fix.agent = { messages: Array.isArray(messages) ? messages : fix.agent.messages, pendingToolCallId: null, turns: Number(turns) || fix.agent.turns };
  run.status = 'completed';
  run.steps.push({ type: 'fix.finished', outcome, at: new Date() });
  await saveFix(run);

  await AgentConversation.findOneAndUpdate(
    { _id: run.conversation, workspace: run.workspace },
    {
      $push: {
        messages: {
          role: 'assistant',
          content: fix.summary || (outcome === 'passed' ? 'terraform plan now passes on the draft.' : 'I could not make terraform plan pass.'),
          metadata: { planFix: { runId: run._id.toString(), outcome, changeCount: fix.appliedChanges.length, planRuns: fix.planRuns.length } },
        },
      },
    },
  );

  return { accepted: true };
}

// ---------------------------------------------------------------------------------------------
// Plan completion + resume
// ---------------------------------------------------------------------------------------------

/**
 * Stores one plan run's result and resumes the paused agent. Called by runLocalPlan, or by
 * agentController.js's GitHub Actions callback. `result` is
 * { exitCode, diagnostics, changeSummary, initFailed?, initOutput?, error?, githubRunId? }.
 */
export async function completePlanRun(runId, index, result) {
  const run = await AgentRun.findById(runId);
  const planRun = run?.fix?.planRuns?.[index];
  if (!run || run.kind !== 'plan_fix' || run.status !== 'running' || !planRun || planRun.status !== 'running') return false;
  if (result.githubRunId && planRun.githubRunId && String(planRun.githubRunId) !== String(result.githubRunId)) return false;

  // Diagnostics refer to lines of the terraform that was planned — regenerated from the draft,
  // which is still that exact revision because the agent is paused while a plan runs.
  const { nodes, terraform } = buildDraftArtifacts(run.fix);

  if (result.error) {
    planRun.status = 'error';
    planRun.error = String(result.error).slice(0, 1500);
  } else if (result.initFailed) {
    planRun.status = 'failed';
    planRun.diagnostics = [{ summary: 'terraform init failed', detail: tail(result.initOutput, 1500) }];
    planRun.errorCount = 1;
  } else {
    const diagnostics = normalizePlanDiagnostics(result.diagnostics, { terraform, nodes, suffix: run.fix.diagramId });
    const errorCount = (Array.isArray(result.diagnostics) ? result.diagnostics : []).filter((d) => d?.severity === 'error').length;
    const passed = Number(result.exitCode) === 0 && errorCount === 0;
    planRun.status = passed ? 'passed' : 'failed';
    planRun.diagnostics = diagnostics;
    planRun.errorCount = passed ? 0 : Math.max(errorCount, 1);
    planRun.changeSummary = result.changeSummary ?? null;
    if (!passed && !diagnostics.length) planRun.diagnostics = [{ summary: 'terraform plan exited with an error but reported no diagnostics', detail: tail(result.rawOutput, 1500) }];
  }
  planRun.finishedAt = new Date().toISOString();
  run.steps.push({
    type: 'plan.finished',
    index,
    status: planRun.status,
    errorCount: planRun.errorCount ?? 0,
    firstError: planRun.diagnostics?.[0]?.summary ?? planRun.error ?? null,
    changeSummary: planRun.changeSummary ?? null,
    at: new Date(),
  });
  await saveFix(run);

  await resumePlanFixAgent(run);
  return true;
}

async function resumePlanFixAgent(run) {
  const result = await startAgentRun({
    runId: run._id.toString(),
    message: '',
    history: [],
    userId: run.user,
    workspaceId: run.workspace,
    diagramId: run.fix.diagramId,
    mode: 'plan_fix',
  });
  if (!result.accepted) await failPlanFixRun(run._id, result.error);
}

export async function failPlanFixRun(runId, message) {
  const run = await AgentRun.findOneAndUpdate({ _id: runId, status: 'running' }, { $set: { status: 'failed' }, $push: { steps: { type: 'fix.failed', at: new Date() } } });
  if (!run) return;
  await AgentConversation.findOneAndUpdate(
    { _id: run.conversation },
    { $push: { messages: { role: 'assistant', content: message, metadata: { error: message } } } },
  );
}

async function markPlanRunError(runId, index, message) {
  await AgentRun.updateOne(
    { _id: runId },
    {
      $set: {
        [`fix.planRuns.${index}.status`]: 'error',
        [`fix.planRuns.${index}.error`]: message,
        [`fix.planRuns.${index}.finishedAt`]: new Date().toISOString(),
        'fix.agent.pendingToolCallId': null,
      },
      $push: { steps: { type: 'plan.finished', index, status: 'error', errorCount: 0, firstError: message, at: new Date() } },
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Diagnostics (pure — unit tested)
// ---------------------------------------------------------------------------------------------

/** Parses `terraform plan -json` output (one JSON object per line) into diagnostics + summary. */
export function parsePlanJsonLines(output) {
  const diagnostics = [];
  let changeSummary = null;
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'diagnostic' && entry.diagnostic) diagnostics.push(entry.diagnostic);
    if (entry.type === 'change_summary' && entry.changes) {
      changeSummary = { add: entry.changes.add ?? 0, change: entry.changes.change ?? 0, remove: entry.changes.remove ?? 0 };
    }
  }
  return { diagnostics, changeSummary };
}

/**
 * Keeps only error diagnostics, trims them, and annotates each with the Terraform address and the
 * diagram node that produced it — so the agent can go straight from "plan says X" to "update node Y".
 */
export function normalizePlanDiagnostics(diagnostics, { terraform = '', nodes = [], suffix = 'diagram' } = {}) {
  const headers = [];
  String(terraform)
    .split(/\r?\n/)
    .forEach((line, lineIndex) => {
      const match = line.match(/^\s*(resource|data)\s+"([^"]+)"\s+"([^"]+)"/);
      if (match) headers.push({ line: lineIndex + 1, address: match[1] === 'data' ? `data.${match[2]}.${match[3]}` : `${match[2]}.${match[3]}` });
    });
  const nodeNames = nodes
    .filter((node) => node?.type === 'awsService' && node?.data?.serviceId)
    .map((node) => ({ id: node.id, name: terraformResourceNameForNode(node, suffix) }))
    .sort((a, b) => b.name.length - a.name.length);

  return (Array.isArray(diagnostics) ? diagnostics : [])
    .filter((diagnostic) => diagnostic?.severity === 'error')
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic) => {
      const line = diagnostic.range?.start?.line;
      const address = diagnostic.address || (line ? [...headers].reverse().find((header) => header.line <= line)?.address : undefined);
      const resourceName = address?.split('.').at(-1)?.replace(/\[.*\]$/, '');
      const nodeId = resourceName ? nodeNames.find((entry) => resourceName === entry.name || resourceName.startsWith(`${entry.name}_`))?.id : undefined;
      return {
        summary: String(diagnostic.summary ?? 'Terraform error').slice(0, 300),
        detail: String(diagnostic.detail ?? '').slice(0, 800),
        ...(address ? { address } : {}),
        ...(line ? { line } : {}),
        ...(nodeId ? { nodeId } : {}),
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------------------------

// Same rule deploymentController.js uses for async validation: a Lambda-hosted backend has no
// terraform binary or time budget, so plans go to GitHub Actions there.
function planExecutor() {
  return env.DEPLOYMENT_EXECUTOR === 'github-actions' || process.env.AWS_LAMBDA_FUNCTION_NAME ? 'github-actions' : 'local';
}

async function runLocalPlan({ runId, index, terraform, account, uploadIds }) {
  const workDir = await storage.getWorkingDirectory(`agent-plan-${runId}-${index}`);
  let result;
  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, 'main.tf'), terraform, 'utf8');
    await stageLambdaZipUploads(uploadIds, workDir);
    const hashes = storage.mode === 's3' ? await lambdaSourceHashesTfvarsContent({ lambdaZipUploadIds: uploadIds }) : null;
    if (hashes) await writeFile(path.join(workDir, 'infraflow_lambda_hashes.auto.tfvars.json'), hashes, 'utf8');

    const credentials = await assumeAwsRole(account);
    const terraformEnv = {
      ...process.env,
      AWS_ACCESS_KEY_ID: credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      AWS_SESSION_TOKEN: credentials.sessionToken ?? '',
      AWS_REGION: account.defaultRegion,
      AWS_DEFAULT_REGION: account.defaultRegion,
      TF_IN_AUTOMATION: 'true',
      TF_PLUGIN_CACHE_DIR: await getPluginCacheDir(),
    };

    try {
      await runProcess(env.TERRAFORM_BIN, ['init', '-input=false', '-no-color'], workDir, terraformEnv);
    } catch (error) {
      if (error?.code === 'ENOENT') throw error;
      result = { initFailed: true, initOutput: error.message };
    }

    if (!result) {
      // -lock=false: a throwaway local state nobody else touches. Plan exits non-zero on errors but
      // still prints its JSON diagnostics, which runProcess puts in the rejection's message.
      let exitCode = 0;
      const output = await runProcess(env.TERRAFORM_BIN, ['plan', '-input=false', '-lock=false', '-no-color', '-json'], workDir, terraformEnv).catch((error) => {
        if (error?.code === 'ENOENT') throw error;
        exitCode = 1;
        return error.message;
      });
      const parsed = parsePlanJsonLines(output);
      result = { exitCode, diagnostics: parsed.diagnostics, changeSummary: parsed.changeSummary, rawOutput: output };
    }
  } catch (error) {
    result = {
      error:
        error?.code === 'ENOENT'
          ? `The terraform binary (${env.TERRAFORM_BIN}) is not installed on this server.`
          : `terraform plan could not run: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  try {
    await completePlanRun(runId, index, result);
  } catch (error) {
    await failPlanFixRun(runId, `The plan-fix run stopped unexpectedly after a plan: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function dispatchGithubPlan({ runId, index, terraform, account, uploadIds }) {
  const token = env.DEPLOYMENT_GITHUB_TOKEN;
  const owner = env.DEPLOYMENT_GITHUB_OWNER;
  const repo = env.DEPLOYMENT_GITHUB_REPO;
  const branch = env.DEPLOYMENT_GITHUB_BRANCH;
  if (!token || !owner || !repo) throw new Error('GitHub Actions plan runner is not configured (DEPLOYMENT_GITHUB_TOKEN/OWNER/REPO).');
  if (!env.DEPLOYMENT_CALLBACK_SECRET) throw new Error('DEPLOYMENT_CALLBACK_SECRET is required for GitHub Actions plan callbacks.');

  const workingDirectory = `agent-plans/${runId}/${index}`;
  const files = [{ path: `${workingDirectory}/main.tf`, content: terraform }];
  const hashes = await lambdaSourceHashesTfvarsContent({ lambdaZipUploadIds: uploadIds });
  if (hashes) files.push({ path: `${workingDirectory}/infraflow_lambda_hashes.auto.tfvars.json`, content: hashes });

  const sync = await syncFilesToGithub({ token, owner, repo, branch, message: `Infraflow agent plan — run ${runId} #${index + 1}`, files });
  const commitSha = sync.commitSha || (await getBranchHeadSha({ token, owner, repo, branch }));
  const credentials = await assumeAwsRole(account);

  const dispatchedAt = new Date();
  await dispatchGithubWorkflow({
    token,
    owner,
    repo,
    workflowId: PLAN_WORKFLOW_ID,
    branch,
    inputs: {
      agent_run_id: runId,
      plan_index: String(index),
      working_directory: workingDirectory,
      commit_sha: commitSha,
      aws_region: account.defaultRegion,
      aws_access_key_id: credentials.accessKeyId,
      aws_secret_access_key: credentials.secretAccessKey,
      aws_session_token: credentials.sessionToken ?? '',
    },
  });

  const githubRun = await waitForLatestWorkflowRun({ token, owner, repo, workflowId: PLAN_WORKFLOW_ID, branch, createdAfter: dispatchedAt });
  if (!githubRun) throw new Error('GitHub Actions did not report a plan run after dispatch.');
  return { githubRunId: String(githubRun.id), htmlUrl: githubRun.htmlUrl };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function saveFix(run) {
  run.markModified('fix');
  await run.save();
}

function uniqueId(base, taken) {
  const clean = base.replace(/[^a-zA-Z0-9_-]+/g, '-');
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}-${n}`)) n += 1;
  return `${clean}-${n}`;
}

function withoutNulls(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null));
}

function tail(value, length) {
  const text = String(value ?? '');
  return text.length > length ? `…${text.slice(-length)}` : text;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
