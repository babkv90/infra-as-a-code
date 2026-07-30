import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { Diagram } from '../models/Diagram.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { assertDiagramServiceAccess } from '../utils/accessControl.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { normalizeDiagramPayload } from '../utils/diagramSchema.js';
import { buildDeploymentPlan } from '../utils/deploymentPlanner.js';
import { lambdaZipUploadIdsFromNodes } from '../utils/terraformGenerator.js';
import { saveLambdaZipUpload } from '../services/lambdaZipUploads.js';
import { runTerraformDeployment, runTerraformDestroy } from '../services/deploymentExecutorDispatch.js';
import { dispatchTerraformValidation } from '../services/githubTerraformValidator.js';
import { syncDeploymentDrift, verifyDeploymentResources } from '../services/terraformDeploymentRunner.js';

// runTerraformDeployment/runTerraformDestroy resolve differently depending on executor:
// github-actions now only dispatches and returns (fast — see githubTerraformRunner.js's top comment
// for why finalization moved to a callback instead of a poll loop this request would have to survive
// past its own response), so it's safe and correct to await here. local runs the whole
// apply/destroy synchronously as a child process — awaiting that in a Lambda-hosted request would
// mean blocking on however long a real `terraform apply` takes, so it stays fire-and-forget,
// unchanged from before.
//
// `run` operates on its own separate document instance (fetched fresh inside
// deploymentExecutorDispatch.js), not the caller's `deployment` — so after awaiting a github-actions
// dispatch, the caller's in-memory copy is stale (still whatever status it was set to right before
// this call, e.g. 'queued') even though the DB has already moved on (e.g. to 'destroying'). Refresh
// it here so the response the client gets back immediately reflects reality instead of waiting for
// the next poll.
async function startTerraformRun(deployment, run) {
  if (deployment.executor === 'github-actions') {
    await run();
    const fresh = await Deployment.findById(deployment._id);
    if (fresh) deployment.set(fresh.toObject());
  } else {
    void run();
  }
}

export const createDeploymentSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    awsAccountId: z.string().optional(),
    status: z.enum(['draft', 'planned', 'approval_required', 'queued']).optional(),
  }),
});

export const createCanvasDeploymentSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120).optional(),
    awsAccountId: z.string().min(1, 'AWS account is required'),
    activeRegion: z.string().min(2).optional(),
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
    autoApply: z.boolean().optional(),
  }),
});

export const updateCanvasDeploymentSchema = z.object({
  body: z.object({
    activeRegion: z.string().min(2).optional(),
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
  }),
});

export const renameDeploymentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  }),
});

export const previewMergeDeploymentSchema = z.object({
  body: z.object({
    sourceDeploymentId: z.string().min(1, 'Source deployment is required'),
  }),
});

export const mergeDeploymentSchema = z.object({
  body: z.object({
    sourceDeploymentId: z.string().min(1, 'Source deployment is required'),
    nodes: z.array(z.any()).min(1, 'Merged diagram must contain at least one node'),
    edges: z.array(z.any()).default([]),
  }),
});

// Statuses a deployment may be in to safely act as a MERGE SOURCE: none of them have ever had a
// successful `terraform apply` run (see runTerraformDeployment / Deployment.js status enum), so its
// diagram's nodes have no real AWS resources or Terraform state behind them yet. That's what makes
// splicing its nodes into another deployment's diagram safe — there's nothing to duplicate. A
// deployment that has ever reached 'deployed'/'queued'/'deploying'/'failed' (partial apply is
// possible) is NOT eligible: merging those would silently create duplicate AWS resources for the
// same logical infrastructure instead of reusing what's already there.
const MERGE_SOURCE_ELIGIBLE_STATUSES = ['draft', 'validating', 'planned', 'approval_required'];
const MERGE_TARGET_ELIGIBLE_STATUSES = ['deployed', 'failed'];

// A deployment consumed as a merge source is locked forever (see Deployment.js 'merged' status
// comment). Applying/updating/queuing/destroying it independently after its nodes were copied
// elsewhere would create duplicate AWS resources for the same infrastructure.
function assertNotMerged(deployment) {
  if (deployment.status === 'merged') {
    throw new ApiError(409, 'This deployment was merged into another deployment and can no longer be applied, updated, queued, or destroyed independently.');
  }
}

export const uploadLambdaZip = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'A .zip file is required.');
  const upload = await saveLambdaZipUpload(req.file.buffer, req.file.originalname);
  res.status(201).json({
    success: true,
    data: { uploadId: upload.uploadId, fileName: upload.fileName, sizeBytes: upload.sizeBytes },
  });
});

export const listDeployments = asyncHandler(async (req, res) => {
  const deployments = await Deployment.find({ workspace: req.user.workspace })
    .sort({ createdAt: -1 })
    .populate('diagram', 'name activeRegion nodes edges')
    .populate('requestedBy', 'name email role');
  res.json({ success: true, data: deployments });
});

export const createDeploymentFromDiagram = asyncHandler(async (req, res) => {
  const diagram = await Diagram.findOne({ _id: req.params.diagramId, workspace: req.user.workspace });
  if (!diagram) throw new ApiError(404, 'Diagram not found');
  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: diagram.nodes });

  let awsAccount;
  if (req.validated.body.awsAccountId) {
    awsAccount = await AwsAccount.findOne({ _id: req.validated.body.awsAccountId, workspace: req.user.workspace });
    if (!awsAccount) throw new ApiError(404, 'AWS account not found');
  }

  // Pre-generated so the Terraform backend block (github-actions executor only) can reference this
  // deployment's own id before the Deployment document exists — see deploymentPlanner.js /
  // terraformGenerator.js. Explicitly set as _id below so this is the id that actually gets used, not
  // a second, different one Mongo would otherwise generate at create time.
  const deploymentId = new mongoose.Types.ObjectId();
  const executor = env.DEPLOYMENT_EXECUTOR;
  const plan = await buildDeploymentPlan(diagram, { deploymentId, remoteStateBackend: executor === 'github-actions' });
  const deployment = await Deployment.create({
    _id: deploymentId,
    workspace: req.user.workspace,
    diagram: diagram._id,
    requestedBy: req.user._id,
    awsAccount: awsAccount?._id,
    name: req.validated.body.name ?? `${diagram.name} deployment`,
    status: req.validated.body.status ?? (plan.plan.blockers ? 'draft' : 'planned'),
    executor,
    resourceCount: plan.resourceCount,
    connectionCount: plan.connectionCount,
    plan: plan.plan,
    terraform: plan.terraform,
    validationIssues: plan.validationIssues,
    logs: [{ message: 'Deployment plan created from visual diagram' }],
  });

  await auditLog(req, 'deployment.create', 'Deployment', deployment._id, { diagram: diagram._id });
  res.status(201).json({ success: true, data: deployment });
});

export const createDeploymentFromCanvas = asyncHandler(async (req, res) => {
  const awsAccount = await AwsAccount.findOne({
    _id: req.validated.body.awsAccountId,
    workspace: req.user.workspace,
    status: 'connected',
  });

  if (!awsAccount) throw new ApiError(404, 'Connected AWS account not found');

  const diagramName = req.validated.body.name ?? `Canvas deployment ${new Date().toISOString().slice(0, 10)}`;
  const diagramPayload = normalizeDiagramPayload(req.validated.body, { activeRegion: awsAccount.defaultRegion });
  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: diagramPayload.nodes });
  const diagram = await Diagram.create({
    workspace: req.user.workspace,
    createdBy: req.user._id,
    updatedBy: req.user._id,
    name: diagramName,
    schemaVersion: diagramPayload.schemaVersion,
    activeRegion: diagramPayload.activeRegion ?? awsAccount.defaultRegion,
    nodes: diagramPayload.nodes,
    edges: diagramPayload.edges,
  });

  const deploymentId = new mongoose.Types.ObjectId();
  const executor = env.DEPLOYMENT_EXECUTOR;
  // The Lambda executor has no reliable terraform binary and no realistic time/network budget to
  // download the AWS provider within a single request (see terraformCliValidator.js) — defer Layer 2
  // (the real `terraform validate` CLI check) to an async GitHub Actions run instead of blocking this
  // request on it. Local/dev keeps running it inline exactly as before: fast, no GitHub round trip.
  // Only defer if that async dispatch is actually possible (DEPLOYMENT_GITHUB_OWNER/REPO configured)
  // — deferring with nowhere to send it would silently skip Layer 2 validation entirely, which is
  // worse than the synchronous fail-closed behavior it would otherwise fall back to.
  const canDispatchAsyncValidation = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) && Boolean(env.DEPLOYMENT_GITHUB_OWNER) && Boolean(env.DEPLOYMENT_GITHUB_REPO);
  const plan = await buildDeploymentPlan(diagram, { deploymentId, remoteStateBackend: executor === 'github-actions', deferCliValidation: canDispatchAsyncValidation });
  const hasBlockers = plan.validationIssues.some((issue) => issue.severity === 'error');
  const needsAsyncValidation = canDispatchAsyncValidation && plan.cliValidationPending;
  const autoApply = Boolean(req.validated.body.autoApply);
  const deployment = await Deployment.create({
    _id: deploymentId,
    workspace: req.user.workspace,
    diagram: diagram._id,
    requestedBy: req.user._id,
    awsAccount: awsAccount._id,
    name: diagramName,
    // 'queued' is reserved for a deployment a Terraform run has actually been kicked off for (see
    // the runTerraformDeployment call below) — saving without autoApply must not leave one sitting
    // in 'queued' with nothing ever going to pick it up. 'draft' is also what makes a saved-without-
    // applying deployment eligible as a merge source (see MERGE_SOURCE_ELIGIBLE_STATUSES above).
    // 'validating' is the third option: real validation hasn't run yet at all, so neither 'draft' nor
    // 'queued' would be accurate — terraformValidateCallbackController.js is what moves it out of here.
    status: needsAsyncValidation ? 'validating' : hasBlockers || !autoApply ? 'draft' : 'queued',
    executor,
    resourceCount: plan.resourceCount,
    connectionCount: plan.connectionCount,
    plan: plan.plan,
    terraform: plan.terraform,
    validationIssues: plan.validationIssues,
    lambdaZipUploadIds: lambdaZipUploadIdsFromNodes(diagramPayload.nodes),
    logs: [
      {
        message: needsAsyncValidation
          ? 'Deployment draft created. Validating Terraform via GitHub Actions before it can be applied.'
          : hasBlockers
            ? 'Deployment draft created with blocking validation errors.'
            : autoApply
              ? 'Deployment created. Terraform runner is starting.'
              : 'Saved as draft. Click Apply when you\'re ready to run Terraform against the selected AWS account.',
        level: hasBlockers ? 'warning' : 'info',
      },
    ],
  });

  await auditLog(req, 'deployment.create_from_canvas', 'Deployment', deployment._id, {
    diagram: diagram._id,
    awsAccount: awsAccount._id,
  });

  if (needsAsyncValidation) {
    try {
      await dispatchTerraformValidation(deployment, { autoApply });
    } catch (error) {
      deployment.status = 'draft';
      deployment.pendingValidation = undefined;
      deployment.validationIssues = [
        ...deployment.validationIssues,
        { severity: 'error', message: `Could not start async Terraform validation: ${error.message ?? String(error)}` },
      ];
      deployment.logs.push({ message: `Async Terraform validation failed to start: ${error.message ?? String(error)}`, level: 'error' });
      await deployment.save();
    }
  } else if (!hasBlockers && autoApply) {
    await startTerraformRun(deployment, () => runTerraformDeployment(deployment._id));
  }

  res.status(201).json({ success: true, data: deployment });
});

export const queueDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  assertNotMerged(deployment);
  if (deployment.validationIssues.some((issue) => issue.severity === 'error')) {
    throw new ApiError(409, 'Deployment has blocking validation errors');
  }
  const diagram = await Diagram.findOne({ _id: deployment.diagram, workspace: req.user.workspace });
  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: diagram?.nodes ?? [] });

  deployment.status = 'queued';
  deployment.logs.push({ message: 'Deployment queued. Wire AWS/Terraform runner to execute apply.', level: 'info' });
  await deployment.save();

  await auditLog(req, 'deployment.queue', 'Deployment', deployment._id);
  res.json({ success: true, data: deployment });
});

export const applyDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  assertNotMerged(deployment);
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');
  if (deployment.validationIssues.some((issue) => issue.severity === 'error')) {
    throw new ApiError(409, 'Deployment has blocking validation errors');
  }
  const diagram = await Diagram.findOne({ _id: deployment.diagram, workspace: req.user.workspace });
  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: diagram?.nodes ?? [] });
  if (deployment.status === 'deploying') {
    return res.json({ success: true, data: deployment });
  }

  deployment.status = 'queued';
  deployment.logs.push({ message: 'Deployment apply requested.', level: 'info' });
  await deployment.save();

  await auditLog(req, 'deployment.apply', 'Deployment', deployment._id);
  await startTerraformRun(deployment, () => runTerraformDeployment(deployment._id));
  res.json({ success: true, data: deployment });
});

// Updates an already-deployed (or previously-failed) deployment's underlying diagram and re-applies
// only the differences via Terraform, instead of creating a brand-new deployment from scratch. This
// relies on the runner reusing the same per-deployment work directory/state (see
// terraformDeploymentRunner.js) so a normal `terraform plan`/`apply` diff runs against what's
// actually already in AWS.
export const updateDeploymentFromCanvas = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  assertNotMerged(deployment);
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');
  if (['queued', 'deploying', 'destroying'].includes(deployment.status)) {
    throw new ApiError(409, 'This deployment is already running. Wait for it to finish before updating it.');
  }
  if (!['deployed', 'failed'].includes(deployment.status)) {
    throw new ApiError(409, 'Only deployed (or previously failed) infrastructure can be updated.');
  }
  if (!deployment.diagram) throw new ApiError(409, 'Deployment has no linked diagram to update.');

  const diagram = await Diagram.findOne({ _id: deployment.diagram, workspace: req.user.workspace });
  if (!diagram) throw new ApiError(404, 'Underlying diagram not found');

  const workspace = await Workspace.findById(req.user.workspace);
  const diagramPayload = normalizeDiagramPayload(req.validated.body, diagram);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: diagramPayload.nodes });

  diagram.schemaVersion = diagramPayload.schemaVersion;
  diagram.nodes = diagramPayload.nodes;
  diagram.edges = diagramPayload.edges;
  if (diagramPayload.activeRegion) diagram.activeRegion = diagramPayload.activeRegion;
  diagram.updatedBy = req.user._id;
  await diagram.save();

  // Regenerated with the SAME executor/backend this deployment was originally created with —
  // deployment.executor is pinned for life (see Deployment.js), never re-derived from the current
  // env.DEPLOYMENT_EXECUTOR default, so an update can never silently move a deployment's Terraform
  // config onto a different backend than what its existing state actually lives in.
  const plan = await buildDeploymentPlan(diagram, { deploymentId: deployment._id, remoteStateBackend: deployment.executor === 'github-actions' });
  const hasBlockers = plan.validationIssues.some((issue) => issue.severity === 'error');

  deployment.resourceCount = plan.resourceCount;
  deployment.connectionCount = plan.connectionCount;
  deployment.plan = plan.plan;
  deployment.terraform = plan.terraform;
  deployment.validationIssues = plan.validationIssues;
  deployment.lambdaZipUploadIds = lambdaZipUploadIdsFromNodes(diagramPayload.nodes);

  if (hasBlockers) {
    deployment.logs.push({ message: 'Update rejected: the edited diagram has blocking validation errors.', level: 'error' });
    await deployment.save();
    await deployment.populate('diagram', 'name activeRegion nodes edges');
    throw new ApiError(409, 'Updated diagram has blocking validation errors. Fix them before updating the deployment.');
  }

  deployment.status = 'queued';
  deployment.logs.push({
    message: 'Infrastructure update requested from an edited diagram. Terraform will compute and apply only the differences against what is already deployed.',
    level: 'info',
  });
  await deployment.save();

  await auditLog(req, 'deployment.update', 'Deployment', deployment._id, { diagram: diagram._id });
  await startTerraformRun(deployment, () => runTerraformDeployment(deployment._id, { isUpdate: true }));

  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});

// Remaps every source node/edge id so it can never collide with a target diagram's existing ids,
// and nudges imported node positions so they don't render exactly on top of the target's own nodes.
// Mirrors the frontend's own paste/duplicate id-remap convention (`${id}-copy-${Date.now()}` in
// diagramStore.ts) so merged nodes are visually distinguishable and stable once loaded onto canvas.
function remapSourceDiagram(targetNodes, sourceNodes, sourceEdges) {
  const usedIds = new Set(targetNodes.map((node) => node?.id));
  const idMap = new Map();

  const remappedNodes = sourceNodes.map((node) => {
    let candidate = `${node.id}-merge-${Date.now()}`;
    let attempt = 0;
    while (usedIds.has(candidate)) {
      attempt += 1;
      candidate = `${node.id}-merge-${Date.now()}-${attempt}`;
    }
    usedIds.add(candidate);
    idMap.set(node.id, candidate);
    return {
      ...node,
      id: candidate,
      position: node.position ? { x: (node.position.x ?? 0) + 160, y: (node.position.y ?? 0) + 160 } : node.position,
    };
  });

  const remappedEdges = sourceEdges
    .filter((edge) => idMap.has(edge?.source) && idMap.has(edge?.target))
    .map((edge, index) => ({
      ...edge,
      id: `${edge.id ?? 'edge'}-merge-${Date.now()}-${index}`,
      source: idMap.get(edge.source),
      target: idMap.get(edge.target),
    }));

  return { nodes: remappedNodes, edges: remappedEdges, idMap };
}

// Computes what a merge WOULD produce — target diagram's nodes/edges plus the source diagram's
// nodes/edges (id-remapped) appended — without persisting anything. The caller (canvas) loads this
// onto the builder so the user can draw the "missing piece of information": a connecting edge
// between an imported node and an existing target node. Nothing is locked or applied until that
// edited result is submitted to mergeDeploymentFromCanvas below.
export const previewDeploymentMerge = asyncHandler(async (req, res) => {
  const target = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!target) throw new ApiError(404, 'Target deployment not found');
  assertNotMerged(target);

  const { sourceDeploymentId } = req.validated.body;
  if (sourceDeploymentId === String(target._id)) throw new ApiError(409, 'A deployment cannot be merged into itself.');

  const source = await Deployment.findOne({ _id: sourceDeploymentId, workspace: req.user.workspace });
  if (!source) throw new ApiError(404, 'Source deployment not found');
  assertNotMerged(source);

  if (['queued', 'deploying', 'destroying'].includes(target.status)) {
    throw new ApiError(409, 'The target deployment is already running. Wait for it to finish before merging into it.');
  }
  if (!MERGE_TARGET_ELIGIBLE_STATUSES.includes(target.status)) {
    throw new ApiError(409, 'Only deployed (or previously failed) infrastructure can be a merge target.');
  }
  if (!MERGE_SOURCE_ELIGIBLE_STATUSES.includes(source.status)) {
    throw new ApiError(
      409,
      `Only infrastructure that has never been applied can be merged as a source (this deployment is "${source.status}"). Deployments with real AWS resources cannot be merged — wire a reference to their existing resource ID/ARN instead.`,
    );
  }
  // Belt-and-suspenders on top of the status check above: a source with any recorded Terraform work
  // dir or outputs has, at some point, actually run `terraform apply` against AWS regardless of what
  // its status field currently says.
  if (source.terraformWorkDir || (source.outputs && Object.keys(source.outputs).length > 0)) {
    throw new ApiError(409, 'Source deployment has existing Terraform state/outputs and cannot be safely merged.');
  }
  if (!target.diagram || !source.diagram) throw new ApiError(409, 'Both deployments must have a linked diagram to merge.');

  const [targetDiagram, sourceDiagram] = await Promise.all([
    Diagram.findOne({ _id: target.diagram, workspace: req.user.workspace }),
    Diagram.findOne({ _id: source.diagram, workspace: req.user.workspace }),
  ]);
  if (!targetDiagram) throw new ApiError(404, 'Target diagram not found');
  if (!sourceDiagram) throw new ApiError(404, 'Source diagram not found');

  if (String(targetDiagram.activeRegion) !== String(sourceDiagram.activeRegion)) {
    throw new ApiError(
      409,
      `Source and target must target the same AWS region to be merged (target: ${targetDiagram.activeRegion}, source: ${sourceDiagram.activeRegion}).`,
    );
  }

  const { nodes: remappedSourceNodes, edges: remappedSourceEdges, idMap } = remapSourceDiagram(
    targetDiagram.nodes ?? [],
    sourceDiagram.nodes ?? [],
    sourceDiagram.edges ?? [],
  );
  const mergedNodes = [...(targetDiagram.nodes ?? []), ...remappedSourceNodes];
  const mergedEdges = [...(targetDiagram.edges ?? []), ...remappedSourceEdges];

  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: mergedNodes });

  res.json({
    success: true,
    data: {
      targetDeploymentId: String(target._id),
      sourceDeploymentId: String(source._id),
      activeRegion: targetDiagram.activeRegion,
      nodes: mergedNodes,
      edges: mergedEdges,
      importedNodeIds: Array.from(idMap.values()),
    },
  });
});

// Applies a previewed (and user-completed, i.e. wired up) merge: replaces the target diagram's
// nodes/edges with the submitted merged set and re-applies via the SAME update path as
// updateDeploymentFromCanvas above (same work dir/state, Terraform diffs against what's already
// deployed) — so the source's nodes land as new resources on the TARGET's existing stack instead of
// spinning up a separate Deployment for them. The source deployment is then locked ('merged') so it
// can never be independently applied and create the same resources a second time.
export const mergeDeploymentFromCanvas = asyncHandler(async (req, res) => {
  const target = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!target) throw new ApiError(404, 'Target deployment not found');
  assertNotMerged(target);
  if (!target.awsAccount) throw new ApiError(409, 'Target deployment is not linked to an AWS account');

  const { sourceDeploymentId, nodes, edges } = req.validated.body;
  if (sourceDeploymentId === String(target._id)) throw new ApiError(409, 'A deployment cannot be merged into itself.');

  const sourceDeployment = await Deployment.findOne({ _id: sourceDeploymentId, workspace: req.user.workspace });
  if (!sourceDeployment) throw new ApiError(404, 'Source deployment not found');
  assertNotMerged(sourceDeployment);

  if (['queued', 'deploying', 'destroying'].includes(target.status)) {
    throw new ApiError(409, 'The target deployment is already running. Wait for it to finish before merging into it.');
  }
  if (!MERGE_TARGET_ELIGIBLE_STATUSES.includes(target.status)) {
    throw new ApiError(409, 'Only deployed (or previously failed) infrastructure can be a merge target.');
  }
  if (!MERGE_SOURCE_ELIGIBLE_STATUSES.includes(sourceDeployment.status)) {
    throw new ApiError(409, `Only infrastructure that has never been applied can be merged as a source (this deployment is "${sourceDeployment.status}").`);
  }
  if (sourceDeployment.terraformWorkDir || (sourceDeployment.outputs && Object.keys(sourceDeployment.outputs).length > 0)) {
    throw new ApiError(409, 'Source deployment has existing Terraform state/outputs and cannot be safely merged.');
  }
  if (!target.diagram) throw new ApiError(409, 'Target deployment has no linked diagram to update.');

  const targetDiagram = await Diagram.findOne({ _id: target.diagram, workspace: req.user.workspace });
  if (!targetDiagram) throw new ApiError(404, 'Target diagram not found');

  // Strict structural checks on what was submitted — a merge must never be the vehicle for silently
  // deleting existing infrastructure (that's what the normal update flow is for), and it must
  // actually attach what it imports, not just append disconnected nodes.
  const originalNodeIds = new Set((targetDiagram.nodes ?? []).map((node) => node?.id));
  const submittedNodeIds = new Set(nodes.map((node) => node?.id));
  const missingOriginalIds = [...originalNodeIds].filter((id) => !submittedNodeIds.has(id));
  if (missingOriginalIds.length) {
    throw new ApiError(409, 'Merge cannot remove nodes that already belong to the target deployment. Use the normal update flow to edit existing infrastructure.');
  }

  const newNodeIds = new Set([...submittedNodeIds].filter((id) => !originalNodeIds.has(id)));
  if (newNodeIds.size === 0) {
    throw new ApiError(409, 'Merged diagram does not contain any nodes from the source deployment.');
  }

  const hasConnectingEdge = edges.some((edge) => {
    if (!edge?.source || !edge?.target) return false;
    const sourceIsNew = newNodeIds.has(edge.source);
    const targetIsNew = newNodeIds.has(edge.target);
    return sourceIsNew !== targetIsNew; // exactly one endpoint newly-imported, the other pre-existing
  });
  if (!hasConnectingEdge) {
    throw new ApiError(409, 'Merged infrastructure is not attached to the existing deployment. Draw a connection between an imported node and an existing one before applying.');
  }

  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes });

  targetDiagram.nodes = nodes;
  targetDiagram.edges = edges;
  targetDiagram.updatedBy = req.user._id;
  await targetDiagram.save();

  const plan = await buildDeploymentPlan(targetDiagram, { deploymentId: target._id, remoteStateBackend: target.executor === 'github-actions' });
  const hasBlockers = plan.validationIssues.some((issue) => issue.severity === 'error');

  target.resourceCount = plan.resourceCount;
  target.connectionCount = plan.connectionCount;
  target.plan = plan.plan;
  target.terraform = plan.terraform;
  target.validationIssues = plan.validationIssues;
  target.lambdaZipUploadIds = lambdaZipUploadIdsFromNodes(nodes);

  if (hasBlockers) {
    target.logs.push({ message: 'Merge rejected: the merged diagram has blocking validation errors.', level: 'error' });
    await target.save();
    await target.populate('diagram', 'name activeRegion nodes edges');
    throw new ApiError(409, 'Merged diagram has blocking validation errors. Fix them before applying the merge.');
  }

  target.status = 'queued';
  target.logs.push({
    message: `Merging deployment "${sourceDeployment.name}" (${sourceDeployment._id}) into this deployment. Terraform will compute and apply only the new resources.`,
    level: 'info',
  });
  await target.save();

  sourceDeployment.status = 'merged';
  sourceDeployment.mergedInto = target._id;
  sourceDeployment.logs.push({
    message: `Merged into deployment "${target.name}" (${target._id}). This deployment can no longer be applied independently.`,
    level: 'info',
  });
  await sourceDeployment.save();

  await auditLog(req, 'deployment.merge', 'Deployment', target._id, { sourceDeployment: sourceDeployment._id });
  await auditLog(req, 'deployment.merge_source_locked', 'Deployment', sourceDeployment._id, { targetDeployment: target._id });
  await startTerraformRun(target, () => runTerraformDeployment(target._id, { isUpdate: true }));

  await target.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: { target, source: sourceDeployment } });
});

export const getDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace }).populate('diagram', 'name activeRegion nodes edges');
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  res.json({ success: true, data: deployment });
});

// Renaming is just a label change — it never touches the diagram, Terraform config, or AWS
// resources, so unlike apply/update/destroy it's allowed regardless of status (including on
// 'merged' or 'destroyed' deployments, where you'd still want to relabel a stale record).
export const renameDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');

  const previousName = deployment.name;
  deployment.name = req.validated.body.name;
  await deployment.save();

  await auditLog(req, 'deployment.rename', 'Deployment', deployment._id, { previousName, name: deployment.name });
  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});

export const destroyDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  assertNotMerged(deployment);
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');
  if (['queued', 'deploying', 'destroying'].includes(deployment.status)) {
    throw new ApiError(409, 'Deployment is already running.');
  }
  if (!['deployed', 'failed'].includes(deployment.status)) {
    throw new ApiError(409, 'Only deployed infrastructure can be destroyed.');
  }

  // Deliberately 'queued', not 'destroying': runTerraformDestroy/runTerraformDeployment (see
  // githubTerraformRunner.js) re-fetch the deployment and refuse to start if it's already in an
  // ACTIVE_STATUSES status (deploying/destroying) — a reentrancy guard against double-dispatch.
  // Pre-setting 'destroying' here collided with that guard and made it return immediately, doing
  // nothing: every normal (non-force) GitHub Actions destroy silently no-op'd. 'queued' mirrors what
  // applyDeployment already does below, and isn't in ACTIVE_STATUSES, so the runner is free to make
  // its own (fast, awaited) transition to 'destroying' once it actually starts.
  deployment.status = 'queued';
  deployment.logs.push({ message: 'Destroy requested. Terraform runner is starting.', level: 'warning' });
  await deployment.save();

  await auditLog(req, 'deployment.destroy', 'Deployment', deployment._id);
  await startTerraformRun(deployment, () => runTerraformDestroy(deployment._id));
  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});

export const forceDestroyDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  assertNotMerged(deployment);
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');
  if (['destroyed', 'cancelled'].includes(deployment.status)) {
    throw new ApiError(409, 'This deployment has already been destroyed or cancelled.');
  }

  const previousStatus = deployment.status;
  deployment.status = 'destroying';
  deployment.logs.push({
    message: `Force destroy requested by ${req.user.email}. This bypasses the normal status guard to clean up resources from a deployment that appears stuck (was "${previousStatus}").`,
    level: 'warning',
  });
  await deployment.save();

  await auditLog(req, 'deployment.force_destroy', 'Deployment', deployment._id, { previousStatus });
  await startTerraformRun(deployment, () => runTerraformDestroy(deployment._id, { force: true }));
  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});

export const verifyDeploymentResourcesRoute = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');

  await auditLog(req, 'deployment.verify_resources', 'Deployment', deployment._id);
  const result = await verifyDeploymentResources(deployment._id);
  res.json({ success: true, data: result });
});

export const syncDeploymentDriftRoute = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');
  if (!deployment.terraform) throw new ApiError(409, 'Deployment does not have Terraform saved for drift sync');

  await auditLog(req, 'deployment.sync_drift', 'Deployment', deployment._id);
  const result = await syncDeploymentDrift(deployment._id);
  res.json({ success: true, data: result });
});
