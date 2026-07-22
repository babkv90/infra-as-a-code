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
import { setGithubActionsSecret } from '../services/githubSecretsService.js';
import { buildOidcPermissionsPolicy, buildOidcTrustPolicy, provisionOidcDeployRole } from '../services/pipelineOidcRoleService.js';
import { githubTokenForUser } from './githubController.js';

const appTypes = ['react-app', 'static-spa', 'node-container', 'python-api', 'java-service', 'serverless-api', 'kubernetes-service'];
const environments = ['development', 'staging', 'production'];

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
  const pipelines = await ApplicationPipeline.find({ workspace: req.user.workspace }).sort({ updatedAt: -1 }).populate('deployment', 'name status resourceCount connectionCount outputs');
  res.json({ success: true, data: pipelines });
});

export const createApplicationPipeline = asyncHandler(async (req, res) => {
  const workspace = await assertPipelineAccess(req);
  const deployment = req.validated.body.deploymentId
    ? await Deployment.findOne({ _id: req.validated.body.deploymentId, workspace: req.user.workspace })
        .populate('diagram', 'name activeRegion nodes edges')
        .populate('awsAccount', 'accountId')
    : undefined;

  if (req.validated.body.deploymentId && !deployment) throw new ApiError(404, 'Deployment target not found');

  const target = inferPipelineTarget(req.validated.body.appType, deployment, req.validated.body.target ?? {});
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

export const syncApplicationPipelineToGithub = asyncHandler(async (req, res) => {
  await assertPipelineAccess(req);
  const pipeline = await ApplicationPipeline.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!pipeline) throw new ApiError(404, 'Application pipeline not found');
  const token = req.validated.body.token || await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before syncing generated pipeline files.');

  const result = await syncFilesToGithub({
    token,
    owner: req.validated.body.owner,
    repo: req.validated.body.repo,
    branch: req.validated.body.branch,
    message: req.validated.body.message || `Sync ${pipeline.name} ${pipeline.environment} pipeline from infraflow`,
    files: pipeline.generatedFiles,
  });

  pipeline.repository.url = `https://github.com/${req.validated.body.owner}/${req.validated.body.repo}`;
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
      environment: pipeline.environment,
    });
  } catch (error) {
    if (!isGithubIntegrationPermissionError(error)) throw error;
    dispatchMode = 'push_trigger';
    await createDeploymentTriggerCommit({
      token,
      owner: repository.owner,
      repo: repository.repo,
      branch: repository.branch,
      pipeline,
    });
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
        ? dispatchMode === 'push_trigger'
          ? 'Deployment started by committing an Infraflow trigger file.'
          : 'Deployment workflow dispatched.'
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
      { id: 'serverless-api', name: 'Serverless API to Lambda', target: 'lambda' },
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
    lambdaFunctionName: overrides.lambdaFunctionName || firstConfig(nodes, ['function_name']) || 'replace-with-lambda-function',
    namespace: overrides.namespace || 'default',
  };

  if (appType === 'react-app' || appType === 'static-spa' || services.has('s3') || services.has('cloudfront')) return { ...base, type: 's3-cloudfront' };
  if (appType === 'serverless-api' || services.has('lambda')) return { ...base, type: 'lambda' };
  if (appType === 'kubernetes-service' || services.has('eks')) return { ...base, type: 'eks' };
  return { ...base, type: 'ecs' };
}

function defaultCommandsForApp(appType, overrides) {
  const defaults = {
    'react-app': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm run preview -- --host 0.0.0.0' },
    'static-spa': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm run preview -- --host 0.0.0.0' },
    'node-container': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm start' },
    'python-api': { install: 'pip install -r requirements.txt', test: 'pytest', build: 'python -m compileall .', start: 'uvicorn app.main:app --host 0.0.0.0 --port 8080' },
    'java-service': { install: './mvnw -B dependency:go-offline', test: './mvnw test', build: './mvnw -B package', start: 'java -jar target/app.jar' },
    'serverless-api': { install: 'npm ci', test: 'npm test -- --watch=false', build: 'npm run build', start: 'npm start' },
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
      purpose: 'GitHub Actions pipeline triggered on push.',
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

function githubWorkflow({ name, appType, environment, branch, commands, target }) {
  const deploy = deployStepsFor(target);
  return `name: ${escapeYaml(`${name} ${environment} CI/CD`)}

on:
  push:
    branches: [${escapeYaml(branch)}]
  workflow_dispatch:
    inputs:
      environment:
        description: Deployment environment
        required: true
        default: ${environment}
        type: choice
        options:
          - development
          - staging
          - production

permissions:
  contents: read
  id-token: write
  security-events: write

env:
  DEPLOY_ENVIRONMENT: ${environment}
  AWS_REGION: ${target.region}
  ECR_REPOSITORY: ${target.ecrRepository}
  ECS_CLUSTER: ${target.clusterName}
  ECS_SERVICE: ${target.serviceName}
  S3_BUCKET: ${target.bucketName}
  CLOUDFRONT_DISTRIBUTION_ID: \${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }}
  LAMBDA_FUNCTION: ${target.lambdaFunctionName}
  K8S_NAMESPACE: ${target.namespace}

jobs:
  deploy:
    name: Build, scan, and deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        if: contains('${appType}', 'react') || contains('${appType}', 'node') || contains('${appType}', 'static') || contains('${appType}', 'serverless') || contains('${appType}', 'kubernetes')
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

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
        run: ${commands.install}

${testStepFor(appType, commands)}

      - name: Build application
        run: ${commands.build}

      - name: Configure AWS credentials with OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: \${{ env.AWS_REGION }}

${deploy}`;
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
    return `      - name: Package Lambda artifact
        run: zip -r lambda.zip . -x ".git/*" "node_modules/.cache/*"

      - name: Deploy Lambda function
        run: aws lambda update-function-code --function-name \${{ env.LAMBDA_FUNCTION }} --zip-file fileb://lambda.zip
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

function testStepFor(appType, commands) {
  if (['react-app', 'static-spa', 'node-container', 'serverless-api', 'kubernetes-service'].includes(appType)) {
    return `      - name: Run tests
        run: |
          if [ -f package.json ] && ! node -e "const pkg = require('./package.json'); process.exit(pkg.scripts && pkg.scripts.test ? 0 : 1)"; then
            echo "No npm test script found; skipping test step."
            exit 0
          fi
          ${commands.test}
`;
  }

  return `      - name: Run tests
        run: ${commands.test}
`;
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

This pipeline deploys on every push to \`${branch}\`. It authenticates to AWS using
GitHub's OIDC provider — no long-lived AWS access keys are stored in GitHub.

## Automatic setup

If this pipeline is linked to an infraflow deployment with a connected AWS account,
Infraflow automatically provisions the OIDC provider, the IAM deploy role (scoped to
this exact repo/branch), and the \`AWS_DEPLOY_ROLE_ARN\` GitHub secret for you the
moment you sync this pipeline to GitHub. Check the pipeline's "AWS deploy role" status
in the dashboard — if it says "Provisioned", skip straight to pushing your code. The
manual steps below are only needed if that status says "Skipped" (no AWS account
linked) or "Failed" (check the error shown in the dashboard).

## Why "Configure AWS credentials with OIDC" fails

That step calls \`sts:AssumeRoleWithWebIdentity\` using a token GitHub issues for the run.
It fails when any of these are missing, and AWS gives no hint which one:

1. The AWS account has no OIDC identity provider for \`token.actions.githubusercontent.com\`.
2. The IAM role's trust policy doesn't exist, or its \`sub\` condition doesn't match
   \`repo:${owner}/${repo}:ref:refs/heads/${branch}\` exactly (wrong owner/repo, wrong branch,
   or a typo).
3. The \`AWS_DEPLOY_ROLE_ARN\` repository secret is missing, empty, or points at a role
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

# 2. Create the deploy role, trusted only for this repo + branch (see deploy/oidc-trust-policy.json)
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

## Required GitHub repository secret

- \`AWS_DEPLOY_ROLE_ARN\`: the ARN printed by step 2 above, e.g.
  \`arn:aws:iam::<ACCOUNT_ID>:role/${roleName}\`.

Recommended secrets by target:
- \`CLOUDFRONT_DISTRIBUTION_ID\` for S3 and CloudFront apps (leave unset to skip cache invalidation).

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
    targetType === 's3-cloudfront' ? 'Confirm S3 bucket and optional CloudFront distribution secret.' : 'Confirm ECR repository and runtime target names.',
    'Push to the configured branch to trigger automated deployment.',
  ];
}

function workflowPathFor(environment) {
  return `.github/workflows/infraflow-${environment}-deploy.yml`;
}

async function syncFilesToGithub({ token, owner, repo, branch, message, files }) {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const synced = [];

  for (const file of sortWorkflowFilesLast(files)) {
    const path = file.path.replace(/^\/+/, '');
    const existingResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(branch)}`, { headers });
    const existing = existingResponse.ok ? await existingResponse.json() : undefined;
    if (!existingResponse.ok && existingResponse.status !== 404) {
      const text = await existingResponse.text();
      throw new ApiError(existingResponse.status, `GitHub read failed for ${path}: ${text}`);
    }

    const updateResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `${message}: ${path}`,
        branch,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        ...(existing?.sha ? { sha: existing.sha } : {}),
      }),
    });

    const result = await updateResponse.json().catch(async () => ({ message: await updateResponse.text() }));
    if (!updateResponse.ok) {
      throw new ApiError(updateResponse.status, githubSyncErrorMessage(path, result?.message));
    }
    synced.push({ path, commitSha: result?.commit?.sha ?? '' });
  }

  return {
    files: synced,
    commitSha: synced[synced.length - 1]?.commitSha ?? '',
  };
}

function sortWorkflowFilesLast(files) {
  return [...files].sort((a, b) => {
    const aWorkflow = String(a.path ?? '').replace(/^\/+/, '').startsWith('.github/workflows/');
    const bWorkflow = String(b.path ?? '').replace(/^\/+/, '').startsWith('.github/workflows/');
    return Number(aWorkflow) - Number(bWorkflow);
  });
}

function resolvePipelineRepository(pipeline, source = {}) {
  const parsed = parseGithubRepositoryUrl(pipeline.repository?.url);
  return {
    owner: String(source.owner ?? parsed.owner ?? '').trim(),
    repo: String(source.repo ?? parsed.repo ?? '').trim(),
    branch: String(source.branch ?? pipeline.repository?.branch ?? 'main').trim() || 'main',
  };
}

function parseGithubRepositoryUrl(url = '') {
  const match = String(url).match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  return {
    owner: match?.[1] ?? '',
    repo: match?.[2] ?? '',
  };
}

async function dispatchGithubWorkflow({ token, owner, repo, workflowId, branch, environment }) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
    {
      method: 'POST',
      headers: githubApiHeaders(token),
      body: JSON.stringify({
        ref: branch,
        inputs: { environment },
      }),
    },
  );

  if (response.status === 204) return;

  const result = await response.json().catch(async () => ({ message: await response.text() }));
  throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Workflow dispatch failed.'));
}

async function createDeploymentTriggerCommit({ token, owner, repo, branch, pipeline }) {
  const triggerPath = `.infraflow/deploy-triggers/${pipeline._id}.json`;
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = githubApiHeaders(token);
  const existingResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(triggerPath)}?ref=${encodeURIComponent(branch)}`, { headers });
  const existing = existingResponse.ok ? await existingResponse.json() : undefined;
  if (!existingResponse.ok && existingResponse.status !== 404) {
    const text = await existingResponse.text();
    throw new ApiError(existingResponse.status, `GitHub trigger read failed for ${triggerPath}: ${text}`);
  }

  const content = JSON.stringify(
    {
      pipelineId: String(pipeline._id),
      pipelineName: pipeline.name,
      environment: pipeline.environment,
      target: pipeline.target?.type,
      requestedAt: new Date().toISOString(),
      source: 'infraflow',
    },
    null,
    2,
  );
  const updateResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(triggerPath)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Trigger ${pipeline.name} deployment from Infraflow`,
      branch,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(existing?.sha ? { sha: existing.sha } : {}),
    }),
  });
  const result = await updateResponse.json().catch(async () => ({ message: await updateResponse.text() }));
  if (!updateResponse.ok) {
    throw new ApiError(updateResponse.status, githubSyncErrorMessage(triggerPath, result?.message));
  }
  return {
    path: triggerPath,
    commitSha: result?.commit?.sha ?? '',
  };
}

async function waitForLatestWorkflowRun({ token, owner, repo, workflowId, branch, createdAfter }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(1400);
    const run = await latestGithubWorkflowRun({ token, owner, repo, workflowId, branch, createdAfter });
    if (run) return run;
  }
  return null;
}

async function latestGithubWorkflowRun({ token, owner, repo, workflowId, branch, createdAfter }) {
  const params = new URLSearchParams({
    branch,
    per_page: '5',
  });
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/runs?${params.toString()}`,
    { headers: githubApiHeaders(token) },
  );
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow runs.'));

  const runs = result.workflow_runs ?? [];
  const run = createdAfter
    ? runs.find((item) => new Date(item.created_at).getTime() >= new Date(createdAfter).getTime() - 3000)
    : runs[0];
  return run ? normalizeGithubWorkflowRun(run) : null;
}

async function githubWorkflowRunJobs({ token, owner, repo, runId }) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=20`,
    { headers: githubApiHeaders(token) },
  );
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow jobs.'));
  return (result.jobs ?? []).map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    htmlUrl: job.html_url,
    steps: (job.steps ?? []).map((step) => ({
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      number: step.number,
      startedAt: step.started_at,
      completedAt: step.completed_at,
    })),
  }));
}

function normalizeGithubWorkflowRun(run) {
  return {
    id: run.id,
    name: run.name,
    runNumber: run.run_number,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    commitSha: run.head_sha,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at,
  };
}

function githubApiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function githubDeploymentErrorMessage(message) {
  const text = String(message || 'GitHub deployment request failed.');
  if (/workflow does not have 'workflow_dispatch'/i.test(text)) {
    return `${text} Regenerate and sync the pipeline so the workflow includes workflow_dispatch.`;
  }
  if (/not found/i.test(text)) {
    return `${text} Confirm the generated workflow file has been synced to the selected repository and branch.`;
  }
  if (/resource not accessible by integration/i.test(text)) {
    return `${text} The connected GitHub app/token needs Actions read access and Contents/Workflow write access for this repository.`;
  }
  return text;
}

function isGithubIntegrationPermissionError(error) {
  const message = String(error?.message ?? '');
  return error?.statusCode === 403 && /resource not accessible by integration/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function githubSyncErrorMessage(path, message = 'Unknown error') {
  const text = String(message || 'Unknown error');
  if (path.startsWith('.github/workflows/') && /resource not accessible by integration/i.test(text)) {
    return `GitHub sync failed for ${path}: ${text}. GitHub blocks workflow file writes unless the connected app/token has workflow access. If this is a GitHub App, enable Repository permissions > Contents: Read and write and Workflows: Read and write in the GitHub App settings, reinstall or reauthorize it for this repository, then sync again. If this is an OAuth app, reconnect GitHub and approve the workflow scope.`;
  }

  if (/resource not accessible by integration/i.test(text)) {
    return `GitHub sync failed for ${path}: ${text}. The selected GitHub account can see the repository, but the connected GitHub App/token cannot write repository contents. Enable Repository permissions > Contents: Read and write in the GitHub App settings, reinstall or reauthorize the app for this repository, then sync again.`;
  }

  if (/protected branch/i.test(text)) {
    return `GitHub sync failed for ${path}: ${text}. Choose an unprotected branch or allow this GitHub account to push to the selected protected branch.`;
  }

  return `GitHub sync failed for ${path}: ${text}`;
}

function encodeURIComponentPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
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
