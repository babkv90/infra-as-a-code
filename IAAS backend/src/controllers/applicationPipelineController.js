import { z } from 'zod';
import { ApplicationPipeline } from '../models/ApplicationPipeline.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { Notification } from '../models/Notification.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { canUseApplicationPipelines } from '../utils/accessControl.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { createNotification } from '../services/notificationService.js';
import {
  cancelWorkflowRun,
  dispatchGithubWorkflow,
  githubDeploymentErrorMessage,
  githubWorkflowRunJobs,
  githubWorkflowRuns,
  isGithubIntegrationPermissionError,
  latestGithubWorkflowRun,
  syncFilesToGithubCommit,
  waitForLatestWorkflowRun,
} from '../services/githubActionsClient.js';
import { setGithubActionsSecret } from '../services/githubSecretsService.js';
import { buildOidcPermissionsPolicy, buildOidcTrustPolicy, provisionOidcDeployRole } from '../services/pipelineOidcRoleService.js';
import { githubTokenForUser } from './githubController.js';

const appTypes = ['react-app', 'static-spa', 'node-container', 'python-api', 'java-service', 'serverless-api', 'kubernetes-service'];
const environments = ['development', 'test', 'staging', 'production'];
const deploymentDispatchLocks = new Map();
const deploymentDispatchLockTtlMs = 10 * 60 * 1000;

function deploymentDispatchLockKey(workspaceId, pipelineId) {
  return `${workspaceId}:${pipelineId}`;
}

function isDeploymentDispatchLocked(key) {
  const lockedAt = deploymentDispatchLocks.get(key);
  if (!lockedAt) return false;
  if (Date.now() - lockedAt > deploymentDispatchLockTtlMs) {
    deploymentDispatchLocks.delete(key);
    return false;
  }
  return true;
}

function lockDeploymentDispatch(key) {
  deploymentDispatchLocks.set(key, Date.now());
}

function unlockDeploymentDispatch(key) {
  deploymentDispatchLocks.delete(key);
}

export const pipelineSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    appType: z.enum(appTypes),
    environment: z.enum(environments).default('development'),
    deploymentId: z.string().optional(),
    repository: z.object({
      url: z.string().max(300).optional().default(''),
      branch: z.string().min(1).max(80).optional().default('main'),
    }),
    commands: z.object({
      install: z.string().max(160).optional(),
      test: z.string().max(160).optional(),
      build: z.string().max(160).optional(),
      start: z.string().max(160).optional(),
    }).optional(),
    target: z.object({
      region: z.string().min(2).optional(),
      ecrRepository: z.string().max(160).optional(),
      serviceName: z.string().max(160).optional(),
      clusterName: z.string().max(160).optional(),
      bucketName: z.string().max(160).optional(),
      lambdaFunctionName: z.string().max(160).optional(),
      namespace: z.string().max(80).optional(),
    }).optional(),
  }),
});

export const githubSyncSchema = z.object({
  body: z.object({
    token: z.string().min(20).optional(),
    owner: z.string().min(1).max(120),
    repo: z.string().min(1).max(120),
    branch: z.string().min(1).max(80).default('main'),
    message: z.string().max(180).optional(),
  }),
});

export const pipelineDeploySchema = z.object({
  body: z.object({
    owner: z.string().min(1).max(120).optional(),
    repo: z.string().min(1).max(120).optional(),
    branch: z.string().min(1).max(80).optional(),
  }).default({}),
});

export const pipelineRunResultSchema = z.object({
  body: z.object({
    runId: z.number(),
    runNumber: z.number().optional(),
    conclusion: z.string().nullable().optional(),
    status: z.string().optional(),
    htmlUrl: z.string().optional(),
    owner: z.string().optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
  }),
});

export const listApplicationPipelines = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipelines = await ApplicationPipeline.find({ workspace: req.user.workspace })
    .sort({ updatedAt: -1 })
    .populate('deployment', 'name status resourceCount connectionCount outputs')
    .populate('createdBy', 'name email role');
  res.json({ success: true, data: pipelines });
});

export const createApplicationPipeline = asyncHandler(async (req, res) => {
  const workspace = await assertPipelineAccess(req);
  const { deployment, target, commands, generatedFiles } = await buildPipelineDefinition(req);

  const pipeline = await ApplicationPipeline.create({
    workspace: req.user.workspace,
    createdBy: req.user._id,
    deployment: deployment?._id,
    name: req.validated.body.name,
    appType: req.validated.body.appType,
    environment: req.validated.body.environment,
    repository: {
      provider: 'github',
      url: req.validated.body.repository.url,
      branch: req.validated.body.repository.branch,
      workflowPath: workflowPathFor(req.validated.body.environment),
    },
    commands,
    target,
    generatedFiles,
    checklist: pipelineChecklist(target.type),
    status: 'ready',
  });

  await auditLog(req, 'pipeline.create', 'ApplicationPipeline', pipeline._id, { workspace: workspace._id, target: target.type });
  res.status(201).json({ success: true, data: pipeline });
});

export const updateApplicationPipeline = asyncHandler(async (req, res) => {
  const workspace = await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  const { deployment, target, commands, generatedFiles } = await buildPipelineDefinition(req);

  pipeline.deployment = deployment?._id;
  pipeline.name = req.validated.body.name;
  pipeline.appType = req.validated.body.appType;
  pipeline.environment = req.validated.body.environment;
  pipeline.repository.provider = 'github';
  pipeline.repository.url = req.validated.body.repository.url;
  pipeline.repository.branch = req.validated.body.repository.branch;
  pipeline.repository.workflowPath = workflowPathFor(req.validated.body.environment);
  pipeline.repository.lastSyncedAt = undefined;
  pipeline.repository.lastSyncCommit = '';
  pipeline.commands = commands;
  pipeline.target = target;
  pipeline.generatedFiles = generatedFiles;
  pipeline.checklist = pipelineChecklist(target.type);
  pipeline.status = 'ready';

  await pipeline.save();
  await auditLog(req, 'pipeline.update', 'ApplicationPipeline', pipeline._id, { workspace: workspace._id, target: target.type });
  res.json({ success: true, data: pipeline });
});

async function buildPipelineDefinition(req) {
  const deployment = req.validated.body.deploymentId
    ? await Deployment.findOne({ _id: req.validated.body.deploymentId, workspace: req.user.workspace })
        .populate('diagram', 'name activeRegion nodes edges')
        .populate('awsAccount', 'accountId')
    : undefined;

  if (req.validated.body.deploymentId && !deployment) throw new ApiError(404, 'Deployment target not found');

  const target = inferPipelineTarget(req.validated.body.appType, deployment, req.validated.body.target ?? {});
  assertTargetResolved(target, deployment);
  const commands = defaultCommandsForApp(req.validated.body.appType, req.validated.body.commands ?? {});
  const generatedFiles = generatePipelineFiles({
    name: req.validated.body.name,
    appType: req.validated.body.appType,
    environment: req.validated.body.environment,
    repository: req.validated.body.repository,
    commands,
    target,
    accountId: deployment?.awsAccount?.accountId,
  });

  return { deployment, target, commands, generatedFiles };
}

export const deleteApplicationPipeline = asyncHandler(async (req, res) => {
  const workspace = await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOneAndDelete({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  await auditLog(req, 'pipeline.delete', 'ApplicationPipeline', pipeline._id, { workspace: workspace._id, name: pipeline.name });
  res.json({ success: true, data: { deleted: true } });
});

export const syncApplicationPipelineToGithub = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace }).populate('deployment', 'awsAccount').populate('deployment.awsAccount', 'accountId');
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');
  const token = req.validated.body.token || await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before syncing generated pipeline files.');
  const syncRepository = {
    url: `https://github.com/${req.validated.body.owner}/${req.validated.body.repo}`,
    branch: req.validated.body.branch,
  };
  pipeline.generatedFiles = generatePipelineFiles({
    name: pipeline.name,
    appType: pipeline.appType,
    environment: pipeline.environment,
    repository: syncRepository,
    commands: pipeline.commands,
    target: pipeline.target,
    accountId: pipeline.deployment?.awsAccount?.accountId,
  });

  const result = await syncFilesToGithubCommit({
    token,
    owner: req.validated.body.owner,
    repo: req.validated.body.repo,
    branch: req.validated.body.branch,
    message: req.validated.body.message || `Sync ${pipeline.name} ${pipeline.environment} pipeline from infraflow`,
    files: pipeline.generatedFiles,
    deletePaths: obsoleteWorkflowPathsFor(pipeline.environment),
  });

  pipeline.repository.url = syncRepository.url;
  pipeline.repository.branch = req.validated.body.branch;
  pipeline.repository.lastSyncedAt = new Date();
  pipeline.repository.lastSyncCommit = result.commitSha;
  await pipeline.save();

  await auditLog(req, 'pipeline.github.sync', 'ApplicationPipeline', pipeline._id, {
    owner: req.validated.body.owner,
    repo: req.validated.body.repo,
    branch: req.validated.body.branch,
    files: pipeline.generatedFiles.map((file) => file.path),
  });

  const oidc = await provisionAndSyncDeployRole({
    pipeline,
    token,
    owner: req.validated.body.owner,
    repo: req.validated.body.repo,
    branch: req.validated.body.branch,
  });

  res.json({ success: true, data: { pipeline, sync: result, oidc } });
});

async function provisionAndSyncDeployRole({ pipeline, token, owner, repo, branch }) {
  if (!pipeline.deployment) {
    pipeline.awsDeployRole = {
      status: 'skipped',
      error: 'This pipeline is not linked to an infraflow deployment, so no AWS account is known. Follow deploy/README.md to create the deploy role manually.',
      arn: '',
      roleName: '',
    };
    await pipeline.save();
    return pipeline.awsDeployRole;
  }

  try {
    const deployment = await Deployment.findById(pipeline.deployment).select('awsAccount');
    const account = deployment?.awsAccount ? await AwsAccount.findById(deployment.awsAccount) : null;
    if (!account) {
      pipeline.awsDeployRole = {
        status: 'skipped',
        error: 'The linked infraflow deployment has no connected AWS account. Follow deploy/README.md to create the deploy role manually.',
        arn: '',
        roleName: '',
      };
      await pipeline.save();
      return pipeline.awsDeployRole;
    }

    const { roleArn, roleName } = await provisionOidcDeployRole({
      account,
      pipelineId: String(pipeline._id),
      pipelineName: pipeline.name,
      owner,
      repo,
      branch,
      target: pipeline.target,
    });

    await setGithubActionsSecret({ token, owner, repo, secretName: 'AWS_DEPLOY_ROLE_ARN', secretValue: roleArn });

    pipeline.awsDeployRole = { status: 'provisioned', arn: roleArn, roleName, error: '', provisionedAt: new Date() };
    await pipeline.save();

    await createNotification({
      workspace: pipeline.workspace,
      type: 'pipeline',
      status: 'success',
      title: `AWS deploy role ready for "${pipeline.name}"`,
      message: `Provisioned ${roleName} and set AWS_DEPLOY_ROLE_ARN on ${owner}/${repo}. No manual AWS setup needed.`,
      resourceType: 'ApplicationPipeline',
      resourceId: pipeline._id,
      resourceName: pipeline.name,
    });

    return pipeline.awsDeployRole;
  } catch (error) {
    pipeline.awsDeployRole = { status: 'failed', error: error.message || 'AWS deploy role provisioning failed.', arn: '', roleName: '' };
    await pipeline.save();

    await createNotification({
      workspace: pipeline.workspace,
      type: 'pipeline',
      status: 'failed',
      title: `AWS deploy role setup failed for "${pipeline.name}"`,
      message: 'Automatic OIDC role provisioning failed. See deploy/README.md for manual setup steps.',
      errorLog: error.message || String(error),
      resourceType: 'ApplicationPipeline',
      resourceId: pipeline._id,
      resourceName: pipeline.name,
    });

    return pipeline.awsDeployRole;
  }
}

export const deployApplicationPipeline = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before deploying the application.');

  const repository = resolvePipelineRepository(pipeline, req.validated.body);
  if (!repository.owner || !repository.repo) {
    throw new ApiError(409, 'Choose and sync a GitHub repository before deploying the application.');
  }

  if (pipeline.deployment) {
    const deployment = await Deployment.findById(pipeline.deployment).select('status name');
    if (deployment && deployment.status !== 'deployed') {
      throw new ApiError(
        409,
        `Target infrastructure "${deployment.name}" is ${deployment.status}, not deployed. The resources this pipeline ships to (e.g. S3 bucket "${pipeline.target.bucketName}") no longer exist. Redeploy that infrastructure, or link this pipeline to a currently-deployed one, before deploying the application.`,
      );
    }
  }

  const workflowFile = pipeline.generatedFiles.find((file) => file.path === pipeline.repository.workflowPath)
    ?? pipeline.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'));
  if (!workflowFile) throw new ApiError(409, 'Generate and sync a workflow file before deploying.');

  const workflowId = workflowFile.path.split('/').pop();
  const dispatchedAt = new Date();
  let dispatchMode = 'workflow_dispatch';
  try {
    await dispatchGithubWorkflow({
      token,
      owner: repository.owner,
      repo: repository.repo,
      workflowId,
      branch: repository.branch,
      inputs: { environment: pipeline.environment },
    });
  } catch (error) {
    if (!isGithubIntegrationPermissionError(error)) throw error;
    throw new ApiError(
      409,
      'GitHub workflow dispatch is not accessible with the connected token. Reconnect GitHub and approve repo + workflow access, then sync the selected environment workflow again.',
    );
  }

  let run = null;
  let statusUnavailable = false;
  let statusMessage = '';
  try {
    run = await waitForLatestWorkflowRun({
      token,
      owner: repository.owner,
      repo: repository.repo,
      workflowId,
      branch: repository.branch,
      createdAfter: dispatchedAt,
    });
  } catch (error) {
    if (!isGithubIntegrationPermissionError(error)) throw error;
    statusUnavailable = true;
    statusMessage = 'Deployment was triggered by a repository push, but GitHub Actions status is not readable with the connected token for this repository.';
  }

  await auditLog(req, 'pipeline.deploy.dispatch', 'ApplicationPipeline', pipeline._id, {
    owner: repository.owner,
    repo: repository.repo,
    branch: repository.branch,
    workflow: workflowId,
    runId: run?.id,
    dispatchMode,
  });

  res.status(202).json({
    success: true,
    data: {
      pipelineId: pipeline._id,
      repository,
      workflowPath: workflowFile.path,
      dispatchMode,
      run,
      jobs: [],
      statusUnavailable,
      statusMessage,
      message: run
        ? 'Deployment workflow dispatched.'
        : statusUnavailable
          ? statusMessage
        : 'Deployment was requested. GitHub has not returned the run yet.',
    },
  });
});

export const getApplicationPipelineDeploymentStatus = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before checking deployment status.');

  const repository = resolvePipelineRepository(pipeline, req.query);
  if (!repository.owner || !repository.repo) {
    throw new ApiError(409, 'Choose a GitHub repository before checking deployment status.');
  }

  const workflowFile = pipeline.generatedFiles.find((file) => file.path === pipeline.repository.workflowPath)
    ?? pipeline.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'));
  const workflowId = workflowFile?.path.split('/').pop();
  if (!workflowId) throw new ApiError(409, 'Generate a workflow file before checking deployment status.');

  let run = null;
  let jobs = [];
  let statusUnavailable = false;
  let statusMessage = '';
  try {
    run = await latestGithubWorkflowRun({
      token,
      owner: repository.owner,
      repo: repository.repo,
      workflowId,
      branch: repository.branch,
    });
    jobs = run?.id ? await githubWorkflowRunJobs({ token, owner: repository.owner, repo: repository.repo, runId: run.id }) : [];
  } catch (error) {
    if (!isGithubIntegrationPermissionError(error)) throw error;
    statusUnavailable = true;
    statusMessage = 'GitHub Actions status is not readable with the connected token for this repository. Enable Actions read permission, then refresh status.';
  }
  if (run?.status === 'completed') unlockDeploymentDispatch(deploymentDispatchLockKey(req.user.workspace, pipeline._id));

  res.json({
    success: true,
    data: {
      pipelineId: pipeline._id,
      repository,
      workflowPath: workflowFile.path,
      run,
      jobs,
      statusUnavailable,
      statusMessage,
    },
  });
});

export const forceStopApplicationPipelineDeployment = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before stopping deployment.');

  const repository = resolvePipelineRepository(pipeline, req.body ?? {});
  if (!repository.owner || !repository.repo) {
    throw new ApiError(409, 'Choose a GitHub repository before stopping deployment.');
  }

  const workflowFile = pipeline.generatedFiles.find((file) => file.path === pipeline.repository.workflowPath)
    ?? pipeline.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'));
  const workflowId = workflowFile?.path.split('/').pop();
  if (!workflowId) throw new ApiError(409, 'Generate a workflow file before stopping deployment.');

  const run = await latestGithubWorkflowRun({
    token,
    owner: repository.owner,
    repo: repository.repo,
    workflowId,
    branch: repository.branch,
  });

  if (!run) {
    res.json({ success: true, data: { stopped: false, message: 'No GitHub Actions run was found for this pipeline.', run: null } });
    return;
  }

  if (run.status === 'completed') {
    unlockDeploymentDispatch(deploymentDispatchLockKey(req.user.workspace, pipeline._id));
    res.json({ success: true, data: { stopped: false, message: 'The latest GitHub Actions run is already completed.', run } });
    return;
  }

  const stopResult = await cancelWorkflowRun({ token, owner: repository.owner, repo: repository.repo, runId: run.id });
  unlockDeploymentDispatch(deploymentDispatchLockKey(req.user.workspace, pipeline._id));
  await auditLog(req, 'pipeline.deploy.force_stop', 'ApplicationPipeline', pipeline._id, { runId: run.id, repository });
  await createNotification({
    workspace: req.user.workspace,
    user: req.user._id,
    title: `Deployment stopped: ${pipeline.name}`,
    message: `GitHub Actions run #${run.runNumber ?? run.id} was requested to stop.`,
    status: 'failed',
    resourceType: 'ApplicationPipeline',
    resourceId: pipeline._id,
    meta: { runId: run.id, runNumber: run.runNumber, owner: repository.owner, repo: repository.repo, branch: repository.branch },
  });

  res.json({
    success: true,
    data: {
      stopped: stopResult.cancelled,
      message: stopResult.alreadyFinished ? 'The latest run already finished before it could be stopped.' : 'Stop request sent to GitHub Actions.',
      run,
    },
  });
});

export const cancelQueuedApplicationPipelineWorkflows = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before cancelling queued workflows.');

  const repository = resolvePipelineRepository(pipeline, req.body ?? {});
  if (!repository.owner || !repository.repo) {
    throw new ApiError(409, 'Choose a GitHub repository before cancelling queued workflows.');
  }

  const workflowFile = pipeline.generatedFiles.find((file) => file.path === pipeline.repository.workflowPath)
    ?? pipeline.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'));
  const workflowId = workflowFile?.path.split('/').pop();
  if (!workflowId) throw new ApiError(409, 'Generate a workflow file before cancelling queued workflows.');

  const queuedRuns = await githubWorkflowRuns({
    token,
    owner: repository.owner,
    repo: repository.repo,
    workflowId,
    branch: repository.branch,
    status: 'queued',
    perPage: 50,
  });

  const results = await Promise.allSettled(
    queuedRuns.map(async (run) => {
      const result = await cancelWorkflowRun({ token, owner: repository.owner, repo: repository.repo, runId: run.id });
      return { ...run, stopped: result.cancelled, alreadyFinished: result.alreadyFinished };
    }),
  );
  const cancelled = results.filter((result) => result.status === 'fulfilled' && result.value.stopped).map((result) => result.value);
  const failed = results
    .filter((result) => result.status === 'rejected')
    .map((result) => (result.reason instanceof Error ? result.reason.message : 'Unable to cancel queued workflow run.'));

  if (cancelled.length || failed.length) {
    await auditLog(req, 'pipeline.deploy.cancel_queued', 'ApplicationPipeline', pipeline._id, {
      repository,
      workflow: workflowId,
      queuedCount: queuedRuns.length,
      cancelledCount: cancelled.length,
      failedCount: failed.length,
    });
  }

  res.json({
    success: true,
    data: {
      cancelledCount: cancelled.length,
      queuedCount: queuedRuns.length,
      cancelledRuns: cancelled,
      failed,
      message: queuedRuns.length
        ? `Cancelled ${cancelled.length} of ${queuedRuns.length} queued workflow runs.`
        : 'No queued workflow runs were found for this pipeline.',
    },
  });
});

export const reportApplicationPipelineRunResult = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');

  const { runId, runNumber, conclusion, htmlUrl, owner, repo, branch } = req.validated.body;
  const existing = await Notification.findOne({
    resourceType: 'ApplicationPipeline',
    resourceId: pipeline._id,
    'meta.runId': runId,
  });

  if (!existing) {
    const success = conclusion === 'success';
    await createNotification({
      workspace: pipeline.workspace,
      type: 'pipeline',
      status: success ? 'success' : 'failed',
      title: success ? `Pipeline "${pipeline.name}" deployed successfully` : `Pipeline "${pipeline.name}" deploy failed`,
      message: `${pipeline.environment} run #${runNumber ?? runId} on ${owner}/${repo}@${branch}.`,
      errorLog: success ? '' : `GitHub Actions run ${htmlUrl ?? ''} concluded as "${conclusion ?? 'unknown'}".`,
      resourceType: 'ApplicationPipeline',
      resourceId: pipeline._id,
      resourceName: pipeline.name,
      meta: { runId, runNumber, conclusion, htmlUrl, owner, repo, branch },
    });
  }

  res.json({ success: true, data: { recorded: true } });
});

export const getPipelineTemplates = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  res.json({
    success: true,
    data: [
      { id: 'react-app', name: 'React app to S3 and CloudFront', target: 's3-cloudfront' },
      { id: 'static-spa', name: 'Static SPA to S3 and CloudFront', target: 's3-cloudfront' },
      { id: 'node-container', name: 'Node.js container to ECS Fargate', target: 'ecs' },
      { id: 'python-api', name: 'Python API container to ECS Fargate', target: 'ecs' },
      { id: 'java-service', name: 'Java service container to ECS Fargate', target: 'ecs' },
      { id: 'serverless-api', name: 'Node.js API to AWS Lambda', target: 'lambda' },
      { id: 'kubernetes-service', name: 'Container service to EKS', target: 'eks' },
    ],
  });
});

async function assertPipelineAccess(req) {
  const workspace = await Workspace.findById(req.user.workspace);
  if (!canUseApplicationPipelines(req.user, workspace)) {
    throw new ApiError(403, 'Application pipelines are available only for Super admin or Enterprise workspaces.');
  }
  return workspace;
}

function inferPipelineTarget(appType, deployment, overrides) {
  const nodes = deployment?.diagram?.nodes ?? [];
  const services = new Set(nodes.map((node) => node?.data?.serviceId).filter(Boolean));
  const region = overrides.region || deployment?.diagram?.activeRegion || 'ap-south-1';
  const base = {
    region,
    ecrRepository: overrides.ecrRepository || safeName(`${deployment?.name ?? appType}-app`),
    serviceName: overrides.serviceName || firstConfig(nodes, ['name', 'function_name']) || safeName(`${appType}-service`),
    clusterName: overrides.clusterName || firstConfig(nodes, ['cluster']) || 'infraflow-cluster',
    bucketName: overrides.bucketName || firstConfig(nodes, ['bucket']) || firstOutputForService(deployment, 'S3', ['id']) || 'replace-with-s3-bucket',
    lambdaFunctionName: overrides.lambdaFunctionName || firstConfig(nodes, ['function_name']) || firstOutputForService(deployment, 'Lambda', ['function_name']) || 'replace-with-lambda-function',
    namespace: overrides.namespace || 'default',
  };

  if (appType === 'react-app' || appType === 'static-spa' || services.has('s3') || services.has('cloudfront')) return { ...base, type: 's3-cloudfront' };
  if (appType === 'serverless-api' || services.has('lambda')) return { ...base, type: 'lambda' };
  if (appType === 'kubernetes-service' || services.has('eks')) return { ...base, type: 'eks' };
  return { ...base, type: 'ecs' };
}

// inferPipelineTarget falls back to literal "replace-with-..." placeholders when it can't find a real
// bucket/function on the linked deployment (e.g. the deployment is a Lambda+API backend but this
// pipeline needs an S3+CloudFront frontend). Left unchecked, that silently creates a pipeline that
// looks fine until deploy time — the actual failure only ever surfaces as a deep, unrelated-looking
// error inside a GitHub Actions run (a stale/wrong AWS_DEPLOY_ROLE_ARN failing OIDC, or S3 PutObject
// against a bucket that was never real). Fail here instead, with a message that names the mismatch.
function assertTargetResolved(target, deployment) {
  if (target.type === 's3-cloudfront' && target.bucketName === 'replace-with-s3-bucket') {
    throw new ApiError(
      409,
      deployment
        ? `"${deployment.name}" doesn't have an S3 bucket in its outputs, so this pipeline has nothing to deploy the frontend build to. Link a deployment that includes an S3 + CloudFront frontend, or set target.bucketName explicitly.`
        : 'This app type deploys to S3 + CloudFront. Link a deployment that includes an S3 bucket, or set target.bucketName explicitly.',
    );
  }

  if (target.type === 'lambda' && target.lambdaFunctionName === 'replace-with-lambda-function') {
    throw new ApiError(
      409,
      deployment
        ? `"${deployment.name}" doesn't have a Lambda function in its outputs, so this pipeline has nothing to deploy code to. Link a deployment that includes a Lambda function, or set target.lambdaFunctionName explicitly.`
        : 'This app type deploys to Lambda. Link a deployment that includes a Lambda function, or set target.lambdaFunctionName explicitly.',
    );
  }
}

function defaultCommandsForApp(appType, overrides) {
  const defaults = {
    'react-app': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm run preview -- --host 0.0.0.0' },
    'static-spa': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm run preview -- --host 0.0.0.0' },
    'node-container': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm start' },
    'python-api': { install: 'pip install -r requirements.txt', test: 'pytest', build: 'python -m compileall .', start: 'uvicorn app.main:app --host 0.0.0.0 --port 8080' },
    'java-service': { install: './mvnw -B dependency:go-offline', test: './mvnw test', build: './mvnw -B package', start: 'java -jar target/app.jar' },
    'serverless-api': { install: 'npm ci', test: 'echo "Skipping Lambda tests by default. Set a custom test command to run them."', build: 'npm run build --if-present', start: 'npm start' },
    'kubernetes-service': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm start' },
  }[appType];

  return { ...defaults, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value)) };
}

function generatePipelineFiles({ name, appType, environment, repository, commands, target, accountId }) {
  const { owner, repo } = parseGithubOwnerRepo(repository?.url);
  const branch = repository?.branch || 'main';
  const resolvedAccountId = accountId || '<ACCOUNT_ID>';
  return [
    {
      path: workflowPathFor(environment),
      language: 'yaml',
      purpose: 'GitHub Actions deployment pipeline triggered by Infraflow workflow dispatch.',
      content: githubWorkflow({ name, appType, environment, branch: repository.branch || 'main', commands, target }),
    },
    {
      path: 'Dockerfile',
      language: 'dockerfile',
      purpose: 'Container build used for ECS/EKS targets.',
      content: dockerfileFor(appType, commands),
    },
    {
      path: '.dockerignore',
      language: 'text',
      purpose: 'Keeps build context small and avoids secrets.',
      content: ['node_modules', 'dist', 'build', '.git', '.env', '.terraform', 'coverage', '__pycache__', 'target'].join('\n'),
    },
    target.type === 'eks'
      ? {
          path: 'deploy/k8s-deployment.yaml',
          language: 'yaml',
          purpose: 'Kubernetes deployment and service manifest.',
          content: eksManifest(name, target),
        }
      : {
          path: 'deploy/README.md',
          language: 'markdown',
          purpose: 'Deployment setup and repository secrets guide.',
          content: setupGuide({ name, target, repository }),
        },
    {
      path: 'deploy/oidc-trust-policy.json',
      language: 'json',
      purpose: 'AWS IAM trust policy for the GitHub OIDC deploy role.',
      content: JSON.stringify(buildOidcTrustPolicy({ owner, repo, branch, accountId: resolvedAccountId }), null, 2),
    },
    {
      path: 'deploy/oidc-permissions-policy.json',
      language: 'json',
      purpose: 'AWS IAM permissions policy attached to the GitHub OIDC deploy role.',
      content: JSON.stringify(buildOidcPermissionsPolicy({ target, accountId: resolvedAccountId }), null, 2),
    },
  ];
}

function parseGithubOwnerRepo(url) {
  const match = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], repo: match[2] } : { owner: 'OWNER', repo: 'REPO' };
}

// deployApplicationPipeline/getApplicationPipelineDeploymentStatus both let the caller override which
// repo/branch to act against (pipelineDeploySchema's body, or raw query params for the GET) instead of
// always using the pipeline's saved repository.url — unlike parseGithubOwnerRepo above, this must
// return empty strings (not 'OWNER'/'REPO' placeholders) when nothing resolves, so the
// `!repository.owner || !repository.repo` checks at both call sites still correctly block an
// unconfigured pipeline instead of silently proceeding with placeholder values.
function resolvePipelineRepository(pipeline, source = {}) {
  const branch = source?.branch || pipeline.repository?.branch || 'main';
  if (source?.owner && source?.repo) {
    return { owner: source.owner, repo: source.repo, branch };
  }

  const match = String(pipeline.repository?.url || '').match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  return { owner: match?.[1] ?? '', repo: match?.[2] ?? '', branch };
}

function githubWorkflow({ name, appType, environment, branch, commands, target }) {
  const deploy = deployStepsFor(target);
  const lambdaAppDirectoryStep = target.type === 'lambda' ? lambdaAppDirectoryWorkflowStep() : '';
  const frontendApiBaseUrlStep = target.type === 's3-cloudfront' ? frontendApiBaseUrlWorkflowStep() : '';
  const workingDirectory = target.type === 'lambda' ? `\n        working-directory: \${{ env.LAMBDA_APP_DIR }}` : '';
  return `name: ${escapeYaml(`${name} ${environment} CI/CD`)}

on:
  workflow_dispatch:
    inputs:
      environment:
        description: Deployment environment
        required: true
        default: ${environment}
        type: choice
        options:
          - development
          - test
          - staging
          - production

permissions:
  contents: read
  id-token: write
  security-events: write

jobs:
  deploy:
    name: Build, scan, and deploy
    runs-on: ubuntu-latest
    environment: \${{ inputs.environment }}
    env:
      DEPLOY_ENVIRONMENT: \${{ inputs.environment }}
      AWS_REGION: \${{ vars.AWS_REGION || '${target.region}' }}
      ECR_REPOSITORY: \${{ vars.ECR_REPOSITORY || '${target.ecrRepository}' }}
      ECS_CLUSTER: \${{ vars.ECS_CLUSTER || '${target.clusterName}' }}
      ECS_SERVICE: \${{ vars.ECS_SERVICE || '${target.serviceName}' }}
      S3_BUCKET: \${{ vars.S3_BUCKET || '${target.bucketName}' }}
      CLOUDFRONT_DISTRIBUTION_ID: \${{ vars.CLOUDFRONT_DISTRIBUTION_ID || secrets.CLOUDFRONT_DISTRIBUTION_ID }}
      LAMBDA_FUNCTION: \${{ vars.LAMBDA_FUNCTION || '${target.lambdaFunctionName}' }}
      K8S_NAMESPACE: \${{ vars.K8S_NAMESPACE || '${target.namespace}' }}
      VITE_API_BASE_URL: \${{ vars.VITE_API_BASE_URL || secrets.INFRAFLOW_API_BASE_URL || vars.INFRAFLOW_API_BASE_URL }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

${lambdaAppDirectoryStep}
      - name: Setup Node.js
        if: contains('${appType}', 'react') || contains('${appType}', 'node') || contains('${appType}', 'static') || contains('${appType}', 'serverless') || contains('${appType}', 'kubernetes')
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: |
            package-lock.json
            IAAS backend/package-lock.json

      - name: Setup Python
        if: contains('${appType}', 'python')
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Setup Java
        if: contains('${appType}', 'java')
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'

      - name: Install dependencies
${workingDirectory}
        run: ${commands.install}

${testStepFor(appType, commands, workingDirectory)}
${frontendApiBaseUrlStep}

      - name: Build application
${workingDirectory}
        env:
          VITE_API_BASE_URL: \${{ env.VITE_API_BASE_URL }}
        run: ${commands.build}

      - name: Verify AWS deploy role secret
        run: |
          if [ -z "\${{ secrets.AWS_DEPLOY_ROLE_ARN }}" ]; then
            echo "::error::Set AWS_DEPLOY_ROLE_ARN as a repository secret or on the selected GitHub Environment: \${{ inputs.environment }}."
            exit 1
          fi

      - name: Configure AWS credentials with OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: \${{ env.AWS_REGION }}

${deploy}`;
}

function frontendApiBaseUrlWorkflowStep() {
  return `
      - name: Verify frontend API URL
        run: |
          if [ -z "$VITE_API_BASE_URL" ]; then
            echo "::error::Set GitHub variable VITE_API_BASE_URL or secret/variable INFRAFLOW_API_BASE_URL to the current API Gateway /api/v1 URL before deploying the frontend."
            exit 1
          fi
`;
}

function lambdaAppDirectoryWorkflowStep() {
  return `      - name: Resolve Lambda app directory
        run: |
          if [ -f "IAAS backend/lambda.js" ] && [ -f "IAAS backend/package.json" ]; then
            echo "LAMBDA_APP_DIR=IAAS backend" >> "$GITHUB_ENV"
          elif [ -f lambda.js ] && [ -f package.json ]; then
            echo "LAMBDA_APP_DIR=." >> "$GITHUB_ENV"
          elif [ -f "IAAS backend/package.json" ]; then
            echo "LAMBDA_APP_DIR=IAAS backend" >> "$GITHUB_ENV"
          elif [ -f package.json ]; then
            echo "LAMBDA_APP_DIR=." >> "$GITHUB_ENV"
          else
            echo "::error::No Lambda app found. Expected lambda.js plus package.json at repository root or IAAS backend/."
            exit 1
          fi
          echo "Lambda app directory: $(cat "$GITHUB_ENV" | grep '^LAMBDA_APP_DIR=' | tail -1 | cut -d= -f2-)"

`;
}

function deployStepsFor(target) {
  if (target.type === 's3-cloudfront') {
    return `      - name: Verify build output
        run: |
          echo "Looking for a static build output directory (dist/ or build/)..."
          if [ -d dist ]; then
            echo "Found dist/ with $(find dist -type f | wc -l) file(s), $(du -sh dist | cut -f1) total."
            find dist -maxdepth 2 -type f | head -20
          elif [ -d build ]; then
            echo "Found build/ with $(find build -type f | wc -l) file(s), $(du -sh build | cut -f1) total."
            find build -maxdepth 2 -type f | head -20
          else
            echo "::error::No static build output found. Expected dist/ (Vite) or build/ (Create React App)."
            echo "Contents of the repository root after the build step:"
            ls -la
            echo "If your build tool writes elsewhere (e.g. Angular's dist/<project-name>/), update this pipeline's build command or the target output directory."
            exit 1
          fi

      - name: Deploy static build to S3
        run: |
          if [ -d dist ]; then BUILD_DIR=dist; else BUILD_DIR=build; fi
          echo "Syncing $BUILD_DIR/ to s3://\${{ env.S3_BUCKET }} ..."
          aws s3 sync "$BUILD_DIR/" s3://\${{ env.S3_BUCKET }} --delete
          echo "Sync complete. Bucket now contains:"
          aws s3 ls "s3://\${{ env.S3_BUCKET }}" --recursive --summarize | tail -5

      - name: Invalidate CloudFront cache
        if: \${{ env.CLOUDFRONT_DISTRIBUTION_ID != '' }}
        run: aws cloudfront create-invalidation --distribution-id "\${{ env.CLOUDFRONT_DISTRIBUTION_ID }}" --paths "/*"
`;
  }

  if (target.type === 'lambda') {
    return `      - name: Prune dev dependencies
        working-directory: \${{ env.LAMBDA_APP_DIR }}
        run: npm prune --omit=dev

      - name: Verify Lambda handler file
        working-directory: \${{ env.LAMBDA_APP_DIR }}
        run: |
          if [ -f lambda.js ]; then
            DESIRED_HANDLER="lambda.handler"
          elif [ -f src/lambda.js ]; then
            DESIRED_HANDLER="src/lambda.handler"
          else
            echo "::error::No Lambda entry file found. Expected lambda.js or src/lambda.js in $PWD."
            find . -maxdepth 3 -type f | sort | head -80
            exit 1
          fi

          HANDLER_MODULE="\${DESIRED_HANDLER%.*}"
          HANDLER_EXPORT="\${DESIRED_HANDLER##*.}"
          if ! grep -Eq "(^|[^A-Za-z0-9_])$HANDLER_EXPORT([^A-Za-z0-9_]|$)" "$HANDLER_MODULE.js"; then
            echo "::error::$HANDLER_MODULE.js exists but does not reference handler export '$HANDLER_EXPORT'."
            exit 1
          fi

          echo "Lambda package contains handler entry: $DESIRED_HANDLER"
          echo "Leaving the existing AWS Lambda handler configuration unchanged."

      - name: Configure Lambda application env
        env:
          JWT_ACCESS_SECRET: \${{ secrets.JWT_ACCESS_SECRET }}
          JWT_REFRESH_SECRET: \${{ secrets.JWT_REFRESH_SECRET }}
          CLIENT_ORIGINS: \${{ vars.CLIENT_ORIGINS }}
          APP_BASE_URL: \${{ vars.APP_BASE_URL }}
          STORAGE_MODE: \${{ vars.STORAGE_MODE }}
          STORAGE_S3_BUCKET: \${{ vars.STORAGE_S3_BUCKET }}
          STORAGE_S3_REGION: \${{ vars.STORAGE_S3_REGION }}
          STORAGE_DYNAMODB_LOCK_TABLE: \${{ vars.STORAGE_DYNAMODB_LOCK_TABLE }}
          DEPLOYMENT_EXECUTOR: \${{ vars.DEPLOYMENT_EXECUTOR }}
          DEPLOYMENT_GITHUB_OWNER: \${{ vars.DEPLOYMENT_GITHUB_OWNER }}
          DEPLOYMENT_GITHUB_REPO: \${{ vars.DEPLOYMENT_GITHUB_REPO }}
          DEPLOYMENT_GITHUB_BRANCH: \${{ vars.DEPLOYMENT_GITHUB_BRANCH }}
          DEPLOYMENT_CALLBACK_SECRET: \${{ secrets.DEPLOYMENT_CALLBACK_SECRET }}
          INFRAFLOW_APP_AWS_ACCESS_KEY_ID: \${{ secrets.INFRAFLOW_APP_AWS_ACCESS_KEY_ID }}
          INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY: \${{ secrets.INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY }}
          INFRAFLOW_APP_AWS_SESSION_TOKEN: \${{ secrets.INFRAFLOW_APP_AWS_SESSION_TOKEN }}
        run: |
          aws lambda get-function-configuration --function-name "\${{ env.LAMBDA_FUNCTION }}" --query 'Environment.Variables' --output json > lambda-env.json
          jq \
            --arg nodeEnv "production" \
            --arg jwtAccessSecret "$JWT_ACCESS_SECRET" \
            --arg jwtRefreshSecret "$JWT_REFRESH_SECRET" \
            --arg clientOrigins "$CLIENT_ORIGINS" \
            --arg appBaseUrl "$APP_BASE_URL" \
            --arg storageMode "$STORAGE_MODE" \
            --arg storageS3Bucket "$STORAGE_S3_BUCKET" \
            --arg storageS3Region "$STORAGE_S3_REGION" \
            --arg storageDynamodbLockTable "$STORAGE_DYNAMODB_LOCK_TABLE" \
            --arg deploymentExecutor "$DEPLOYMENT_EXECUTOR" \
            --arg deploymentGithubOwner "$DEPLOYMENT_GITHUB_OWNER" \
            --arg deploymentGithubRepo "$DEPLOYMENT_GITHUB_REPO" \
            --arg deploymentGithubBranch "$DEPLOYMENT_GITHUB_BRANCH" \
            --arg deploymentCallbackSecret "$DEPLOYMENT_CALLBACK_SECRET" \
            --arg accessKeyId "$INFRAFLOW_APP_AWS_ACCESS_KEY_ID" \
            --arg secretAccessKey "$INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY" \
            --arg sessionToken "$INFRAFLOW_APP_AWS_SESSION_TOKEN" \
            '. + {
              NODE_ENV: $nodeEnv
            }
            + (if $jwtAccessSecret == "" then {} else { JWT_ACCESS_SECRET: $jwtAccessSecret } end)
            + (if $jwtRefreshSecret == "" then {} else { JWT_REFRESH_SECRET: $jwtRefreshSecret } end)
            + (if $clientOrigins == "" then {} else { CLIENT_ORIGINS: $clientOrigins } end)
            + (if $appBaseUrl == "" then {} else { APP_BASE_URL: $appBaseUrl } end)
            + (if $storageMode == "" then {} else { STORAGE_MODE: $storageMode } end)
            + (if $storageS3Bucket == "" then {} else { STORAGE_S3_BUCKET: $storageS3Bucket } end)
            + (if $storageS3Region == "" then {} else { STORAGE_S3_REGION: $storageS3Region } end)
            + (if $storageDynamodbLockTable == "" then {} else { STORAGE_DYNAMODB_LOCK_TABLE: $storageDynamodbLockTable } end)
            + (if $deploymentExecutor == "" then {} else { DEPLOYMENT_EXECUTOR: $deploymentExecutor } end)
            + (if $deploymentGithubOwner == "" then {} else { DEPLOYMENT_GITHUB_OWNER: $deploymentGithubOwner } end)
            + (if $deploymentGithubRepo == "" then {} else { DEPLOYMENT_GITHUB_REPO: $deploymentGithubRepo } end)
            + (if $deploymentGithubBranch == "" then {} else { DEPLOYMENT_GITHUB_BRANCH: $deploymentGithubBranch } end)
            + (if $deploymentCallbackSecret == "" then {} else { DEPLOYMENT_CALLBACK_SECRET: $deploymentCallbackSecret } end)
            + (if $accessKeyId == "" then {} else { INFRAFLOW_APP_AWS_ACCESS_KEY_ID: $accessKeyId } end)
            + (if $secretAccessKey == "" then {} else { INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY: $secretAccessKey } end)
            + (if $sessionToken == "" then {} else { INFRAFLOW_APP_AWS_SESSION_TOKEN: $sessionToken } end)' \
            lambda-env.json > lambda-env-updated.json
          aws lambda update-function-configuration --function-name "\${{ env.LAMBDA_FUNCTION }}" --environment "Variables=$(jq -c . lambda-env-updated.json)"
          aws lambda wait function-updated --function-name "\${{ env.LAMBDA_FUNCTION }}"

      - name: Package Lambda artifact
        working-directory: \${{ env.LAMBDA_APP_DIR }}
        run: |
          rm -rf shared
          if [ -d "../shared" ]; then
            cp -R ../shared shared
          elif [ -d "../../shared" ]; then
            cp -R ../../shared shared
          elif [ -d "$GITHUB_WORKSPACE/shared" ]; then
            cp -R "$GITHUB_WORKSPACE/shared" shared
          else
            echo "::error::Missing shared/resourceRegistry.json. Lambda packaging requires the repository shared/ directory."
            exit 1
          fi
          test -f shared/resourceRegistry.json
          zip -r lambda.zip . -x ".git/*" ".github/*" ".env" ".env.*" "coverage/*" "node_modules/.cache/*" "lambda.zip"

      - name: Deploy Lambda function
        run: aws lambda update-function-code --function-name \${{ env.LAMBDA_FUNCTION }} --zip-file fileb://"\${{ env.LAMBDA_APP_DIR }}/lambda.zip"
`;
  }

  const containerSteps = `      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Amazon ECR
        id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build image
        run: docker build -t \${{ steps.ecr.outputs.registry }}/\${{ env.ECR_REPOSITORY }}:\${{ github.sha }} .

      - name: Scan image with Trivy
        uses: aquasecurity/trivy-action@0.24.0
        with:
          image-ref: \${{ steps.ecr.outputs.registry }}/\${{ env.ECR_REPOSITORY }}:\${{ github.sha }}
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH

      - name: Upload Trivy SARIF
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-results.sarif

      - name: Push image
        run: docker push \${{ steps.ecr.outputs.registry }}/\${{ env.ECR_REPOSITORY }}:\${{ github.sha }}
`;

  if (target.type === 'eks') {
    return `${containerSteps}
      - name: Configure kubectl
        run: aws eks update-kubeconfig --region \${{ env.AWS_REGION }} --name \${{ env.ECS_CLUSTER }}

      - name: Deploy to EKS
        run: |
          kubectl apply -f deploy/k8s-deployment.yaml
          kubectl -n \${{ env.K8S_NAMESPACE }} set image deployment/${target.serviceName} app=\${{ steps.ecr.outputs.registry }}/\${{ env.ECR_REPOSITORY }}:\${{ github.sha }}
          kubectl -n \${{ env.K8S_NAMESPACE }} rollout status deployment/${target.serviceName}
`;
  }

  return `${containerSteps}
      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster \${{ env.ECS_CLUSTER }} --service \${{ env.ECS_SERVICE }} --force-new-deployment
`;
}

function testStepFor(appType, commands, workingDirectory = '') {
  if (appType === 'serverless-api' && isDefaultSkippedLambdaTestCommand(commands.test)) {
    return `      - name: Run tests
        run: echo "Skipping Lambda tests by default. Set a custom test command in Infraflow to run deployment tests."
`;
  }

  if (['react-app', 'static-spa', 'node-container', 'serverless-api', 'kubernetes-service'].includes(appType)) {
    return `      - name: Run tests
        timeout-minutes: 3
        env:
          CI: true
          NODE_ENV: test
${workingDirectory}
        run: |
          if [ ! -f package.json ]; then
            echo "No package.json found; skipping test step."
            exit 0
          fi
          TEST_SCRIPT="$(node -e "const pkg = require('./package.json'); process.stdout.write(pkg.scripts?.test || '')")"
          if [ -z "$TEST_SCRIPT" ]; then
            echo "No npm test script found; skipping test step."
            exit 0
          fi
          if echo "$TEST_SCRIPT" | grep -Eiq 'no test specified|exit 1'; then
            echo "Default placeholder npm test script found; skipping test step."
            exit 0
          fi
          timeout 150s ${commands.test}
`;
  }

  return `      - name: Run tests
        timeout-minutes: 3
${workingDirectory}
        run: timeout 150s ${commands.test}
`;
}

function isDefaultSkippedLambdaTestCommand(command = '') {
  return /^echo\s+["']?Skipping Lambda tests by default/i.test(String(command).trim());
}

function dockerfileFor(appType, commands) {
  if (appType === 'python-api') {
    return `FROM python:3.12-slim
WORKDIR /app
COPY requirements*.txt ./
RUN ${commands.install}
COPY . .
EXPOSE 8080
CMD ${jsonCommand(commands.start)}
`;
  }

  if (appType === 'java-service') {
    return `FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY . .
RUN ${commands.build}

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
`;
  }

  return `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN ${commands.install}
COPY . .
RUN ${commands.build}

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app .
EXPOSE 8080
CMD ${jsonCommand(commands.start)}
`;
}

function eksManifest(name, target) {
  const safe = safeName(target.serviceName || name);
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${safe}
  namespace: ${target.namespace}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ${safe}
  template:
    metadata:
      labels:
        app: ${safe}
    spec:
      containers:
        - name: app
          image: replace-me
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: ${safe}
  namespace: ${target.namespace}
spec:
  selector:
    app: ${safe}
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
`;
}

function setupGuide({ name, target, repository }) {
  const { owner, repo } = parseGithubOwnerRepo(repository?.url);
  const branch = repository?.branch || 'main';
  const roleName = safeName(`${name}-deploy-role`);

  return `# ${name} deployment pipeline

This pipeline deploys from a selected GitHub Environment. It authenticates to AWS using
GitHub's OIDC provider — no long-lived AWS deploy keys are stored in GitHub.

## Automatic setup

If this pipeline is linked to an infraflow deployment with a connected AWS account,
Infraflow automatically provisions the OIDC provider, the IAM deploy role (scoped to
this exact repo plus branch/environment subjects), and the \`AWS_DEPLOY_ROLE_ARN\` GitHub secret for you the
moment you sync this pipeline to GitHub. Check the pipeline's "AWS deploy role" status
in the dashboard — if it says "Provisioned", skip straight to pushing your code. The
manual steps below are only needed if that status says "Skipped" (no AWS account
linked) or "Failed" (check the error shown in the dashboard).

## Why "Configure AWS credentials with OIDC" fails

That step calls \`sts:AssumeRoleWithWebIdentity\` using a token GitHub issues for the run.
It fails when any of these are missing or mismatched:

1. The AWS account has no OIDC identity provider for \`token.actions.githubusercontent.com\`.
2. The IAM role trust policy does not match this repo. With GitHub Environments, the
   run subject is \`repo:${owner}/${repo}:environment:<environment>\`, not only
   \`repo:${owner}/${repo}:ref:refs/heads/${branch}\`.
3. GitHub has no \`AWS_DEPLOY_ROLE_ARN\` repository secret or selected Environment secret, or it points at a role
   in the wrong AWS account.
4. The workflow's \`permissions.id-token: write\` block was removed (already included here).

## One-time AWS setup

Run these once per AWS account (replace \`<ACCOUNT_ID>\` with your account ID):

\`\`\`bash
# 1. Create the OIDC provider (skip if it already exists — one per AWS account, shared by all repos)
aws iam create-open-id-connect-provider \\
  --url https://token.actions.githubusercontent.com \\
  --client-id-list sts.amazonaws.com \\
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea 1c58a3a8518e8759bf075b76b750d4f2df264fcd

# 2. Create the deploy role, trusted only for this repo + selected environments (see deploy/oidc-trust-policy.json)
aws iam create-role \\
  --role-name ${roleName} \\
  --assume-role-policy-document file://deploy/oidc-trust-policy.json

# 3. Attach the least-privilege permissions this pipeline needs (see deploy/oidc-permissions-policy.json)
aws iam put-role-policy \\
  --role-name ${roleName} \\
  --policy-name ${roleName}-permissions \\
  --policy-document file://deploy/oidc-permissions-policy.json
\`\`\`

Before running step 2, replace \`<ACCOUNT_ID>\` in \`deploy/oidc-trust-policy.json\` with your
AWS account ID. Before running step 3, replace \`<ACCOUNT_ID>\` in
\`deploy/oidc-permissions-policy.json\` if it references account-scoped ARNs (Lambda target only).

## Required GitHub secret

- \`AWS_DEPLOY_ROLE_ARN\`: set this as a repository secret or per-environment secret. Use the ARN printed by step 2 above, e.g.
  \`arn:aws:iam::<ACCOUNT_ID>:role/${roleName}\`.

Recommended secrets by target:
- Environment variable \`VITE_API_BASE_URL\` for S3 and CloudFront apps. \`INFRAFLOW_API_BASE_URL\` is accepted as a fallback alias.
- Environment variable \`CLOUDFRONT_DISTRIBUTION_ID\` for S3 and CloudFront apps (leave unset to skip cache invalidation).
- Environment secrets \`INFRAFLOW_APP_AWS_ACCESS_KEY_ID\` and \`INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY\` for Lambda backend apps that need to connect AWS accounts from production.
- Environment secret \`INFRAFLOW_APP_AWS_SESSION_TOKEN\` only when the access key is temporary.

## Target

- Type: ${target.type}
- Region: ${target.region}
- ECR repository: ${target.ecrRepository}
- Service: ${target.serviceName}
`;
}

function pipelineChecklist(targetType) {
  return [
    'Connect GitHub repository and sync generated files (this also auto-provisions the AWS OIDC deploy role when a deployment is linked).',
    'Check the "AWS deploy role" status on this pipeline — if it says Skipped or Failed, follow deploy/README.md to set it up manually.',
    'Confirm target infrastructure exists from the selected infraflow deployment.',
    targetType === 's3-cloudfront'
      ? 'Confirm selected GitHub Environment has S3_BUCKET, VITE_API_BASE_URL (or INFRAFLOW_API_BASE_URL), and optional CLOUDFRONT_DISTRIBUTION_ID variables.'
      : targetType === 'lambda'
        ? 'Confirm Lambda function name, AWS region, and INFRAFLOW_APP_AWS_* environment secrets if this backend connects AWS accounts.'
        : 'Confirm ECR repository and runtime target names.',
    'Use Deploy Application in Infraflow to dispatch the selected environment workflow.',
  ];
}

function workflowPathFor(environment) {
  return `.github/workflows/infraflow-${environment}-deploy.yml`;
}

function obsoleteWorkflowPathsFor(environment) {
  return environments
    .filter((item) => item !== environment)
    .map(workflowPathFor);
}

function firstConfig(nodes, keys) {
  for (const node of nodes) {
    for (const key of keys) {
      const value = node?.data?.config?.[key];
      if (value) return String(value);
    }
  }
  return '';
}

function firstOutputForService(deployment, serviceName, attrs) {
  const outputs = deployment?.outputs && typeof deployment.outputs === 'object' ? Object.values(deployment.outputs) : [];
  for (const output of outputs) {
    if (!output || typeof output !== 'object') continue;
    if (String(output.service ?? '').toLowerCase() !== serviceName.toLowerCase()) continue;
    for (const attr of attrs) {
      const value = String(output[attr] ?? '').trim();
      if (value) return value;
    }
  }
  return '';
}

function safeName(value) {
  return String(value || 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'app';
}

function escapeYaml(value) {
  return JSON.stringify(String(value));
}

function jsonCommand(command) {
  return JSON.stringify(command.split(' ').filter(Boolean));
}

