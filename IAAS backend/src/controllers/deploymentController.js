import { z } from 'zod';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { Diagram } from '../models/Diagram.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { assertDiagramServiceAccess } from '../utils/accessControl.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { buildDeploymentPlan } from '../utils/deploymentPlanner.js';
import { runTerraformDeployment, runTerraformDestroy } from '../services/terraformDeploymentRunner.js';

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

export const listDeployments = asyncHandler(async (req, res) => {
  const deployments = await Deployment.find({ workspace: req.user.workspace }).sort({ createdAt: -1 }).populate('diagram', 'name activeRegion nodes edges');
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

  const plan = buildDeploymentPlan(diagram);
  const deployment = await Deployment.create({
    workspace: req.user.workspace,
    diagram: diagram._id,
    requestedBy: req.user._id,
    awsAccount: awsAccount?._id,
    name: req.validated.body.name ?? `${diagram.name} deployment`,
    status: req.validated.body.status ?? (plan.plan.blockers ? 'draft' : 'planned'),
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
  const workspace = await Workspace.findById(req.user.workspace);
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: req.validated.body.nodes });
  const diagram = await Diagram.create({
    workspace: req.user.workspace,
    createdBy: req.user._id,
    updatedBy: req.user._id,
    name: diagramName,
    activeRegion: req.validated.body.activeRegion ?? awsAccount.defaultRegion,
    nodes: req.validated.body.nodes,
    edges: req.validated.body.edges,
  });

  const plan = buildDeploymentPlan(diagram);
  const hasBlockers = plan.validationIssues.some((issue) => issue.severity === 'error');
  const deployment = await Deployment.create({
    workspace: req.user.workspace,
    diagram: diagram._id,
    requestedBy: req.user._id,
    awsAccount: awsAccount._id,
    name: `${diagramName} deployment`,
    status: hasBlockers ? 'draft' : 'queued',
    resourceCount: plan.resourceCount,
    connectionCount: plan.connectionCount,
    plan: plan.plan,
    terraform: plan.terraform,
    validationIssues: plan.validationIssues,
    logs: [
      {
        message: hasBlockers
          ? 'Deployment draft created with blocking validation errors.'
          : req.validated.body.autoApply
            ? 'Deployment created. Terraform runner is starting.'
            : 'Deployment queued. Click apply to execute Terraform against the selected AWS account.',
        level: hasBlockers ? 'warning' : 'info',
      },
    ],
  });

  await auditLog(req, 'deployment.create_from_canvas', 'Deployment', deployment._id, {
    diagram: diagram._id,
    awsAccount: awsAccount._id,
  });

  if (!hasBlockers && req.validated.body.autoApply) {
    void runTerraformDeployment(deployment._id);
  }

  res.status(201).json({ success: true, data: deployment });
});

export const queueDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
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
  void runTerraformDeployment(deployment._id);
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
  assertDiagramServiceAccess({ user: req.user, workspace, nodes: req.validated.body.nodes });

  diagram.nodes = req.validated.body.nodes;
  diagram.edges = req.validated.body.edges;
  if (req.validated.body.activeRegion) diagram.activeRegion = req.validated.body.activeRegion;
  diagram.updatedBy = req.user._id;
  await diagram.save();

  const plan = buildDeploymentPlan(diagram);
  const hasBlockers = plan.validationIssues.some((issue) => issue.severity === 'error');

  deployment.resourceCount = plan.resourceCount;
  deployment.connectionCount = plan.connectionCount;
  deployment.plan = plan.plan;
  deployment.terraform = plan.terraform;
  deployment.validationIssues = plan.validationIssues;

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
  void runTerraformDeployment(deployment._id, { isUpdate: true });

  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});

export const getDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace }).populate('diagram', 'name activeRegion nodes edges');
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  res.json({ success: true, data: deployment });
});

export const destroyDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
  if (!deployment.awsAccount) throw new ApiError(409, 'Deployment is not linked to an AWS account');
  if (['queued', 'deploying', 'destroying'].includes(deployment.status)) {
    throw new ApiError(409, 'Deployment is already running.');
  }
  if (!['deployed', 'failed'].includes(deployment.status)) {
    throw new ApiError(409, 'Only deployed infrastructure can be destroyed.');
  }

  deployment.status = 'destroying';
  deployment.logs.push({ message: 'Destroy requested. Terraform runner is starting.', level: 'warning' });
  await deployment.save();

  await auditLog(req, 'deployment.destroy', 'Deployment', deployment._id);
  void runTerraformDestroy(deployment._id);
  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});

export const forceDestroyDeployment = asyncHandler(async (req, res) => {
  const deployment = await Deployment.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');
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
  void runTerraformDestroy(deployment._id, { force: true });
  await deployment.populate('diagram', 'name activeRegion nodes edges');
  res.json({ success: true, data: deployment });
});
