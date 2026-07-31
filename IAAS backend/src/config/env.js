import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export const env = {
  NODE_ENV: readString('NODE_ENV', 'development'),
  PORT: readNumber('PORT', 4000),
  MONGODB_URI: readString('MONGODB_URI'),
  JWT_ACCESS_SECRET: readString('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: readString('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  JWT_ACCESS_EXPIRES_IN: readString('JWT_ACCESS_EXPIRES_IN', '6h'),
  JWT_REFRESH_EXPIRES_IN: readString('JWT_REFRESH_EXPIRES_IN', '7d'),
  CLIENT_ORIGINS: readMergedList(
    ['CLIENT_ORIGIN', 'CLIENT_ORIGINS'],
    'http://127.0.0.1:5173,http://localhost:5173,https://v72gcv51pi.execute-api.ap-south-1.amazonaws.com,https://d3pgg5abvvdatt.cloudfront.net',
  ),
  BCRYPT_ROUNDS: readNumber('BCRYPT_ROUNDS', 12),
  RATE_LIMIT_WINDOW_MS: readNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber('RATE_LIMIT_MAX', 300),
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
};

if (!env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Add it to IAAS backend/.env before running the API.');
}

if (env.GITHUB_TOKEN_ENCRYPTION_KEY === 'dev-github-token-encryption-key-change-me') {
  console.warn(
    'GITHUB_TOKEN_ENCRYPTION_KEY is not set — falling back to a shared, publicly-known dev value. ' +
      'Every stored GitHub token is encrypted with this key; set INFRAFLOW_GITHUB_TOKEN_ENCRYPTION_KEY ' +
      'to a real secret before any real user connects GitHub.',
  );
}

if (env.STORAGE_MODE === 's3' && !env.STORAGE_S3_BUCKET) {
  throw new Error('STORAGE_S3_BUCKET is required when STORAGE_MODE=s3.');
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
