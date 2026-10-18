import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/config -> src -> IAAS backend -> repo root, used only to build TIMELINE_SOURCE_DIRS' default below.
const repoRoot = path.resolve(__dirname, '..', '..', '..');

// AWS_LAMBDA_FUNCTION_NAME is a reserved variable Lambda always sets on the real function's
// behalf, never present anywhere else — the standard way to detect "this process is actually
// running inside Lambda" without guessing from NODE_ENV (which locals can also set to
// 'production'). Real values there come from the function's own configured environment variables,
// set directly in the Lambda console/IaC — never from a .env file, which won't exist in the
// deployment package at all. Skipping dotenv entirely in that case (rather than relying on it
// silently finding nothing, or on its default non-override behavior) means a .env file accidentally
// left in a zip could never shadow the real configured values, and makes the local-vs-Lambda split
// explicit here instead of implicit in dotenv's loading semantics.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

function readString(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;

  const trimmed = value.trim();
  const hasMatchingQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));

  return hasMatchingQuotes ? trimmed.slice(1, -1) : trimmed;
}

function readFirstString(names, fallback = '') {
  for (const name of names) {
    const value = readString(name);
    if (value) return value;
  }
  return fallback;
}

function readNumber(name, fallback) {
  const value = readString(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(name, fallback) {
  return readString(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readMergedList(names, fallback) {
  return Array.from(
    new Set(
      names
        .flatMap((name) => readList(name, ''))
        .concat(readList('', fallback))
        .map((item) => item.replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  );
}

const DEV_OAUTH_STATE_SECRET = 'dev-oauth-state-secret-change-me';

export const env = {
  NODE_ENV: readString('NODE_ENV', 'development'),
  // True on any real deployment — production NODE_ENV, or running inside Lambda at all (same signal
  // the dotenv guard above uses). Used where "is this a developer's laptop?" must not hinge on
  // someone remembering to set NODE_ENV: Secure cookies, and never trusting localhost/http origins.
  IS_DEPLOYED: readString('NODE_ENV') === 'production' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
  PORT: readNumber('PORT', 4000),
  MONGODB_URI: readString('MONGODB_URI'),
  JWT_ACCESS_SECRET: readString('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: readString('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  JWT_ACCESS_EXPIRES_IN: readString('JWT_ACCESS_EXPIRES_IN', '15m'),
  JWT_REFRESH_EXPIRES_IN: readString('JWT_REFRESH_EXPIRES_IN', '7d'),
  CLIENT_ORIGINS: readMergedList(
    ['CLIENT_ORIGIN', 'CLIENT_ORIGINS'],
    'http://127.0.0.1:5173,http://localhost:5173,https://v72gcv51pi.execute-api.ap-south-1.amazonaws.com,https://d3pgg5abvvdatt.cloudfront.net',
  ),
  BCRYPT_ROUNDS: readNumber('BCRYPT_ROUNDS', 12),
  RATE_LIMIT_WINDOW_MS: readNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber('RATE_LIMIT_MAX', 600),
  // Separate, far more generous limit for the small set of frequent read-only status-polling GET
  // routes (deployment/GitHub-run/pipeline status, notifications — see app.js's POLLING_ROUTE_PATTERNS).
  // A single browser tab watching one active deployment can legitimately generate ~800+ requests in
  // a 15-minute window across those endpoints alone (2.2s/4s/8s/15s poll intervals) — comfortably
  // under RATE_LIMIT_MAX would throttle completely normal usage, not abuse.
  POLLING_RATE_LIMIT_MAX: readNumber('POLLING_RATE_LIMIT_MAX', 3000),
  APP_BASE_URL: readString('APP_BASE_URL', 'http://localhost:5173'),
  SMTP_HOST: readString('SMTP_HOST'),
  SMTP_PORT: readNumber('SMTP_PORT', 587),
  SMTP_SECURE: readString('SMTP_SECURE') === 'true',
  SMTP_USER: readString('SMTP_USER'),
  SMTP_PASS: readString('SMTP_PASS'),
  EMAIL_FROM: readString('EMAIL_FROM'),
  TERRAFORM_APPLY_ENABLED: readString('TERRAFORM_APPLY_ENABLED') === 'true',
  TERRAFORM_BIN: readString('TERRAFORM_BIN', 'terraform'),
  TERRAFORM_WORK_DIR: readString('TERRAFORM_WORK_DIR'),
  // 'local' (default) or 's3' — selects the StorageAdapter (src/storage/index.js) for uploaded
  // artifacts. Read once here and never checked elsewhere. STORAGE_S3_REGION falls back to
  // AWS_REGION (the base identity's region) since they're usually the same, but is separate
  // because AWS_REGION is about the STS-assume-role identity, not where this bucket lives.
  STORAGE_MODE: readString('STORAGE_MODE', 'local'),
  STORAGE_S3_BUCKET: readString('STORAGE_S3_BUCKET'),
  STORAGE_S3_REGION: readString('STORAGE_S3_REGION') || readString('AWS_REGION'),
  STORAGE_DYNAMODB_LOCK_TABLE: readString('STORAGE_DYNAMODB_LOCK_TABLE'),
  RAG_API_URL: readString('RAG_API_URL', 'http://127.0.0.1:8000'),
  // The Python/FastAPI multi-agent service (services/agents). Distinct port from RAG_API_URL above
  // — that service is unrelated and unused by the agent flow as of M0.
  AGENT_API_URL: readString('AGENT_API_URL', 'http://127.0.0.1:8001'),
  // How startAgentRun() (utils/agentBridge.js) reaches that service.
  //   'http'   (default) — POST /runs/start on AGENT_API_URL. Local dev, or the service running as
  //                         a long-lived container.
  //   'lambda'           — invoke AGENT_LAMBDA_FUNCTION asynchronously (InvocationType=Event). The
  //                         production deployment: the service is a zip Lambda that runs the whole
  //                         graph inside one invocation (services/agents/app/lambda_handler.py).
  AGENT_INVOKE_MODE: readString('AGENT_INVOKE_MODE', 'http'),
  // Only used when AGENT_INVOKE_MODE=lambda: the agent Lambda's name or ARN, and the region it
  // lives in (falls back to the platform's own AWS_REGION, then us-east-1).
  AGENT_LAMBDA_FUNCTION: readString('AGENT_LAMBDA_FUNCTION'),
  AGENT_LAMBDA_REGION: readString('AGENT_LAMBDA_REGION') || readString('AWS_REGION', 'us-east-1'),
  // Signs the short-lived machine JWT Express mints per agent run (agentIdentity.js) and that the
  // Python service verifies before trusting a call, and that requireAgentScope.js verifies on every
  // /internal/agent-tools/* request. Deliberately its own secret, not shared with JWT_ACCESS_SECRET
  // — it authenticates a service-to-service call acting on a user's behalf, not a user session.
  AGENT_TOOL_SECRET: readString('AGENT_TOOL_SECRET', 'dev-agent-tool-secret-change-me'),
  GITHUB_CLIENT_ID: readFirstString(['INFRAFLOW_GITHUB_CLIENT_ID', 'GITHUB_CLIENT_ID']),
  GITHUB_CLIENT_SECRET: readFirstString(['INFRAFLOW_GITHUB_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET']),
  GITHUB_OAUTH_CALLBACK_URL: readFirstString(['INFRAFLOW_GITHUB_OAUTH_CALLBACK_URL', 'GITHUB_OAUTH_CALLBACK_URL']),
  // Deliberately its own dev-default, distinct from the JWT_*_SECRET ones below — this key encrypts
  // stored GitHub tokens, a different concern from signing login sessions. Sharing a value between
  // them (which happened before this had its own fallback) means rotating one for a security reason
  // silently invalidates the other. Falling back to a fixed dev value (rather than throwing) matches
  // how JWT_ACCESS_SECRET/JWT_REFRESH_SECRET behave below: safe to boot locally without full prod
  // config, loud in production because it's obviously not a real secret.
  GITHUB_TOKEN_ENCRYPTION_KEY: readFirstString(
    ['INFRAFLOW_GITHUB_TOKEN_ENCRYPTION_KEY', 'GITHUB_TOKEN_ENCRYPTION_KEY'],
    'dev-github-token-encryption-key-change-me',
  ),
  // "Continue with Google / GitHub" on the login page (controllers/oauthController.js). Each provider
  // is switched on only when both its client id and secret are set — GET /auth/oauth/providers tells
  // the login page which buttons to render, so an unconfigured provider simply never appears.
  GOOGLE_CLIENT_ID: readString('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: readString('GOOGLE_CLIENT_SECRET'),
  // Deliberately a separate GitHub OAuth app from GITHUB_CLIENT_ID above: that one asks for
  // repo+workflow so it can push Terraform, while signing in only needs read:user user:email — and a
  // GitHub OAuth app has exactly one callback URL, which is already the repo-connection callback.
  GITHUB_LOGIN_CLIENT_ID: readString('GITHUB_LOGIN_CLIENT_ID'),
  GITHUB_LOGIN_CLIENT_SECRET: readString('GITHUB_LOGIN_CLIENT_SECRET'),
  // Public base URL of this API including /api/v1 (e.g. https://api.example.com/api/v1). Provider
  // callbacks become <base>/auth/oauth/<provider>/callback and must match the redirect URI registered
  // with Google/GitHub byte for byte. Empty = derived from the incoming request's protocol + host.
  OAUTH_CALLBACK_BASE_URL: readString('OAUTH_CALLBACK_BASE_URL').replace(/\/+$/, ''),
  // Signs the short-lived cookie that carries one sign-in attempt's state/nonce/PKCE verifier between
  // /oauth/<provider>/start and its callback. Its own secret, like the others here, so rotating it
  // only abandons sign-ins that are in flight at that moment.
  OAUTH_STATE_SECRET: readString('OAUTH_STATE_SECRET', DEV_OAUTH_STATE_SECRET),
  // Selects which runner NEW deployments are created with (src/services/deploymentExecutorDispatch.js).
  // Read once, at deployment-creation time only — Deployment.executor then pins that single record to
  // whichever value was in effect at that moment, for its entire lifecycle. Flipping this later never
  // moves an already-created deployment onto a different executor.
  DEPLOYMENT_EXECUTOR: readString('DEPLOYMENT_EXECUTOR', 'local'),
  // Our own platform repo that generated Terraform gets pushed to for the github-actions executor —
  // not the end user's repo (that's a separate, future "Option B" idea, out of scope here).
  DEPLOYMENT_GITHUB_OWNER: readString('DEPLOYMENT_GITHUB_OWNER'),
  DEPLOYMENT_GITHUB_REPO: readString('DEPLOYMENT_GITHUB_REPO'),
  DEPLOYMENT_GITHUB_BRANCH: readString('DEPLOYMENT_GITHUB_BRANCH', 'main'),
  // Platform-owned token for pushing to / dispatching workflows on our own repo above. Deliberately
  // NOT the requesting customer's own GitHub OAuth token: a real third-party signup has no reason to
  // have write/workflow-dispatch access to our private deploy-runner repo, so authenticating this step
  // as them would fail for every customer except us. A fine-grained PAT (or GitHub App installation
  // token) scoped to just DEPLOYMENT_GITHUB_OWNER/REPO with Contents + Actions write is what belongs
  // here. The customer's own AWS session is still what the dispatched workflow acts under — see
  // assumeAwsRole() in githubTerraformRunner.js — this token only ever gets that AWS session in front
  // of a runner, never substitutes for it.
  DEPLOYMENT_GITHUB_TOKEN: readString('DEPLOYMENT_GITHUB_TOKEN'),
  // Authenticates the workflow's own callback POST (see terraformDeployCallbackController.js) back to
  // this API with its run's outcome/outputs — a shared secret, not a user credential, since the caller
  // is a GitHub Actions job, not a logged-in user.
  DEPLOYMENT_CALLBACK_SECRET: readString('DEPLOYMENT_CALLBACK_SECRET'),
  // Vault for sensitive Terraform output values (SSH private keys, DB endpoints) captured after a
  // deploy — see secretRedaction.js/secretsManagerService.js. Off by default (readString(...) ===
  // 'true' only) so a fresh checkout keeps working with no AWS setup; sensitive outputs just stay in
  // deployment.outputs as they always have until this is turned on. Uses the platform's OWN AWS
  // identity (makeEnvCredentials(), same as the STS-assume-role calls in awsRoleCredentials.js) rather
  // than the customer's assumed role, since these are the app's own secrets about a customer's
  // deployment, not resources inside the customer's account, and a customer's IAM role has no reason
  // to grant secretsmanager:* permissions.
  SECRETS_MANAGER_ENABLED: readString('SECRETS_MANAGER_ENABLED') === 'true',
  SECRETS_MANAGER_REGION: readString('SECRETS_MANAGER_REGION') || readString('AWS_REGION', 'us-east-1'),
  // Optional — omitted, Secrets Manager encrypts with its own AWS-managed default key
  // (aws/secretsmanager). Set to a customer-managed KMS key ARN/id for stricter key control.
  SECRETS_MANAGER_KMS_KEY_ID: readString('SECRETS_MANAGER_KMS_KEY_ID'),
  // Folders the landing page's Progress Timeline / changelog blog (services/timelineScanner.js)
  // scans for .pdf/.md/.docx to turn into blog entries. Defaults to a few in-repo folders plus a
  // machine-local notes folder that only exists on this dev machine — the scanner silently skips
  // any directory that isn't there, so the feature degrades gracefully (repo folders only) on any
  // other machine/deployment rather than erroring.
  TIMELINE_SOURCE_DIRS: readList(
    'TIMELINE_SOURCE_DIRS',
    [
      path.join(repoRoot, 'docs'),
      path.join(repoRoot, 'output', 'pdf'),
      path.join(repoRoot, 'generated'),
      path.join(repoRoot, 'reports'),
      'D:\\Notes\\InfraFlow Docs',
    ].join(','),
  ),
  // How long a scan's results are reused before the next request triggers a fresh one. Short
  // enough that dropping a new file into a source folder shows up on the blog within a minute,
  // long enough that parsing PDFs/docx isn't redone on every single page load.
  TIMELINE_CACHE_TTL_MS: readNumber('TIMELINE_CACHE_TTL_MS', 60_000),
};

if (!env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Add it to IAAS backend/.env before running the API.');
}

if (env.AGENT_TOOL_SECRET === 'dev-agent-tool-secret-change-me') {
  console.warn(
    'AGENT_TOOL_SECRET is not set — falling back to a shared, publicly-known dev value. ' +
      'Set AGENT_TOOL_SECRET to a real secret (matching services/agents/.env) before any real deployment.',
  );
}

if (env.GITHUB_TOKEN_ENCRYPTION_KEY === 'dev-github-token-encryption-key-change-me') {
  console.warn(
    'GITHUB_TOKEN_ENCRYPTION_KEY is not set — falling back to a shared, publicly-known dev value. ' +
      'Every stored GitHub token is encrypted with this key; set INFRAFLOW_GITHUB_TOKEN_ENCRYPTION_KEY ' +
      'to a real secret before any real user connects GitHub.',
  );
}

// Fails closed, but only for social sign-in: on a real deployment a publicly-known state secret
// switches every provider off (services/oauthProviders.js) instead of throwing here, so a missing
// OAuth setting can't take the rest of the API — password login included — down with it.
export const oauthStateSecretUsable = !(env.IS_DEPLOYED && env.OAUTH_STATE_SECRET === DEV_OAUTH_STATE_SECRET);

if (
  env.OAUTH_STATE_SECRET === DEV_OAUTH_STATE_SECRET &&
  ((env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) || (env.GITHUB_LOGIN_CLIENT_ID && env.GITHUB_LOGIN_CLIENT_SECRET))
) {
  if (oauthStateSecretUsable) {
    console.warn(
      'OAUTH_STATE_SECRET is not set — falling back to a shared, publicly-known dev value. ' +
        'Set OAUTH_STATE_SECRET to a real secret before enabling Google/GitHub sign-in anywhere real.',
    );
  } else {
    console.error(
      'OAUTH_STATE_SECRET is not set on a deployed environment — Google/GitHub sign-in is DISABLED ' +
        'until it is set to a real secret. Password login is unaffected.',
    );
  }
}

if (env.STORAGE_MODE === 's3' && !env.STORAGE_S3_BUCKET) {
  throw new Error('STORAGE_S3_BUCKET is required when STORAGE_MODE=s3.');
}

if (env.AGENT_INVOKE_MODE === 'lambda' && !env.AGENT_LAMBDA_FUNCTION) {
  throw new Error('AGENT_LAMBDA_FUNCTION (the agent Lambda name or ARN) is required when AGENT_INVOKE_MODE=lambda.');
}

if (env.DEPLOYMENT_EXECUTOR === 'github-actions') {
  if (!env.DEPLOYMENT_GITHUB_OWNER || !env.DEPLOYMENT_GITHUB_REPO) {
    throw new Error('DEPLOYMENT_GITHUB_OWNER and DEPLOYMENT_GITHUB_REPO are required when DEPLOYMENT_EXECUTOR=github-actions.');
  }
  if (!env.DEPLOYMENT_CALLBACK_SECRET) {
    throw new Error('DEPLOYMENT_CALLBACK_SECRET is required when DEPLOYMENT_EXECUTOR=github-actions.');
  }
  if (!env.DEPLOYMENT_GITHUB_TOKEN) {
    throw new Error('DEPLOYMENT_GITHUB_TOKEN is required when DEPLOYMENT_EXECUTOR=github-actions — a platform-owned token with write+workflow access to DEPLOYMENT_GITHUB_OWNER/REPO, not a customer credential.');
  }
  if (env.STORAGE_MODE !== 's3') {
    throw new Error(
      'DEPLOYMENT_EXECUTOR=github-actions requires STORAGE_MODE=s3 — a GitHub-hosted runner has no access to this server\'s local disk, so Terraform state cannot live there. Set STORAGE_MODE=s3 (and STORAGE_S3_BUCKET/STORAGE_DYNAMODB_LOCK_TABLE) first.',
    );
  }
}
