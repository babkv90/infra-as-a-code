import { spawn } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { assumeAwsRole } from './awsRoleCredentials.js';
import { assertDeployable, failDeployment, handleDeployFailureCleanup, stripAnsi } from './deploymentGuards.js';
import { getLambdaZipUploadMetadata } from './lambdaZipUploads.js';
import { createNotification } from './notificationService.js';
import { storage } from '../storage/index.js';

const runningDeployments = new Set();

export async function runTerraformDeployment(deploymentId, { isUpdate = false } = {}) {
  const id = String(deploymentId);
  if (runningDeployments.has(id)) return;
  runningDeployments.add(id);

  try {
    const deployment = await Deployment.findById(id).populate('awsAccount');
    if (!deployment) return;

    const canProceed = await assertDeployable(deployment, {
      applyEnabled: env.TERRAFORM_APPLY_ENABLED,
      disabledMessage: 'Terraform apply is disabled. Set TERRAFORM_APPLY_ENABLED=true in IAAS backend/.env to run real AWS deployments.',
      phase: isUpdate ? 'update' : 'deploy',
    });
    if (!canProceed) return;

    const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
    if (!account) {
      await failDeployment(deployment, 'AWS account not found for deployment.', isUpdate ? 'update' : 'deploy');
      return;
    }

    deployment.status = 'deploying';
    deployment.startedAt = new Date();
    deployment.activeRun = { action: 'apply', isUpdate, startedAt: new Date() };
    deployment.logs.push({ message: isUpdate ? 'Starting Terraform update runner.' : 'Starting Terraform deployment runner.', level: 'info' });
    await deployment.save();

    const credentials = await assumeAwsRole(account);
    const workDir = await getOrCreateWorkDir(deployment, id);
    await writeFile(path.join(workDir, 'main.tf'), deployment.terraform, 'utf8');
    deployment.terraformWorkDir = workDir;
    await deployment.save();

    await stageLambdaZipUploads(deployment.lambdaZipUploadIds, workDir);
    await writeLambdaSourceHashTfvars(deployment, workDir);

    if (deployment.terraform.includes('lambda_stub.zip')) {
      await writeFile(path.join(workDir, 'lambda_stub.zip'), createLambdaStubZip());
    }

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

    await runTerraformCommand(deployment, workDir, ['init', '-input=false'], terraformEnv);

    // Layer 3 of the deployment validation pipeline: `plan` already runs before `apply` below it, and
    // runTerraformCommand/runProcess already reject on a non-zero exit code — so a plan that
    // genuinely errors (not one that simply shows resource changes; plan exits 0 for that) already
    // throws here and `apply` is never reached, same as it always has. The only change is making that
    // outcome unambiguous to whoever reads the failure: wrapped so the message is explicit that this
    // was caught at the plan stage, before anything touched AWS, rather than looking identical to an
    // apply-time failure once it reaches failDeployment.
    try {
      await runTerraformCommand(deployment, workDir, ['plan', '-input=false', '-out=tfplan'], terraformEnv);
    } catch (error) {
      throw new Error(`Terraform plan failed — nothing was changed in AWS. ${error.message ?? String(error)}`);
    }

    await runTerraformCommand(deployment, workDir, ['apply', '-input=false', '-auto-approve', 'tfplan'], terraformEnv);
    deployment.outputs = await readTerraformOutputs(deployment, workDir, terraformEnv);

    deployment.status = 'deployed';
    deployment.finishedAt = new Date();
    deployment.activeRun = undefined;
    deployment.logs.push({
      message: isUpdate
        ? 'Terraform update completed. Only the changed resources were touched; everything else was left as-is.'
        : 'Terraform apply completed. AWS resources should now be visible in the target account console.',
      level: 'info',
    });
    await deployment.save();

    // A sitting-deployed deployment doesn't need the downloaded provider binaries (600MB+) on disk
    // until its next update or destroy, and TF_PLUGIN_CACHE_DIR means that next `terraform init`
    // just re-copies from the already-warm shared cache in seconds — no re-download.
    await removeProviderCache(workDir);

    await createNotification({
      workspace: deployment.workspace,
      type: 'deployment',
      status: 'success',
      title: isUpdate ? `Update to "${deployment.name}" succeeded` : `Deployment "${deployment.name}" succeeded`,
      message: isUpdate
        ? `Infrastructure updated to match the edited diagram (${deployment.resourceCount} resource${deployment.resourceCount === 1 ? '' : 's'}).`
        : `${deployment.resourceCount} resource${deployment.resourceCount === 1 ? '' : 's'} applied to AWS.`,
      resourceType: 'Deployment',
      resourceId: deployment._id,
      resourceName: deployment.name,
    });
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await failDeployment(deployment, error.message ?? 'Terraform deployment failed.', isUpdate ? 'update' : 'deploy');

      await handleDeployFailureCleanup({
        deployment,
        isUpdate,
        hasRealState: () => (deployment.terraformWorkDir ? hasTerraformState(deployment.terraformWorkDir) : false),
        runAutoDestroy: () => runTerraformDestroy(id, { force: true, auto: true }),
        cleanupArtifacts: () => (deployment.terraformWorkDir ? removeProviderCache(deployment.terraformWorkDir) : Promise.resolve()),
      });
    }
  } finally {
    runningDeployments.delete(id);
  }
}

export async function runTerraformDestroy(deploymentId, { force = false, auto = false } = {}) {
  const id = String(deploymentId);
  if (runningDeployments.has(id) && !force) return;
  runningDeployments.add(id);

  try {
    const deployment = await Deployment.findById(id).populate('awsAccount');
    if (!deployment) return;

    if (!env.TERRAFORM_APPLY_ENABLED) {
      await failDeployment(deployment, 'Terraform apply is disabled. Set TERRAFORM_APPLY_ENABLED=true in IAAS backend/.env to run real AWS destroy operations.', 'destroy');
      return;
    }

    const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
    if (!account) {
      await failDeployment(deployment, 'AWS account not found for deployment destroy.', 'destroy');
      return;
    }

    const workDir = deployment.terraformWorkDir || (await storage.getWorkingDirectory(id));
    const statePath = path.join(workDir, 'terraform.tfstate');
    if (!(await pathExists(statePath))) {
      if (force) {
        deployment.status = auto ? 'failed' : 'cancelled';
        deployment.finishedAt = new Date();
        deployment.activeRun = undefined;
        deployment.logs.push({
          message: auto
            ? 'No Terraform state was found, so no AWS resources needed to be cleaned up after the failed deployment.'
            : 'Force destroy requested. No Terraform state was found for this deployment, so there is nothing to remove from AWS. Marked as cancelled.',
          level: 'warning',
        });
        await deployment.save();
        return;
      }
      await failDeployment(
        deployment,
        'Terraform state was not found for this deployment. Destroy can only run for infrastructure deployed by infraflow after state tracking was enabled.',
        'destroy',
      );
      return;
    }

    await writeFile(path.join(workDir, 'main.tf'), deployment.terraform, 'utf8');

    deployment.status = 'destroying';
    deployment.startedAt = deployment.startedAt ?? new Date();
    deployment.finishedAt = undefined;
    deployment.activeRun = { action: 'destroy', isUpdate: false, startedAt: new Date() };
    deployment.logs.push({
      message: auto
        ? 'Automatically destroying AWS resources created before this deployment failed.'
        : force
          ? 'Force destroy requested by user. Proceeding even though the deployment may still be running elsewhere; Terraform state locking will safely reject this run if that is the case.'
          : 'Starting Terraform destroy runner.',
      level: 'warning',
    });
    await deployment.save();

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

    await emptyS3BucketsFromTerraformState(deployment, workDir, terraformEnv, credentials, account.defaultRegion);
    await runTerraformCommand(deployment, workDir, ['init', '-input=false'], terraformEnv);
    await runTerraformCommand(deployment, workDir, ['destroy', '-input=false', '-auto-approve'], terraformEnv);

    deployment.status = auto ? 'failed' : 'destroyed';
    deployment.finishedAt = new Date();
    deployment.activeRun = undefined;
    deployment.logs.push({
      message: auto
        ? 'Automatic cleanup completed. All AWS resources created before the failure have been destroyed.'
        : 'Terraform destroy completed. The infrastructure from this deployment has been removed.',
      level: 'info',
    });
    await deployment.save();

    // A destroyed deployment will never run `apply` again, so its downloaded provider binaries
    // (600MB+ per deployment) serve no further purpose. Reclaim the disk space; terraform.tfstate
    // and main.tf are left in place since they're tiny and useful for audit history.
    //
    // NOTE (storage-abstraction Step 6): in s3 storage mode this SHOULD eventually delete the whole
    // working directory instead of just .terraform/, since nothing local needs to survive once
    // artifacts and state both live remotely. It doesn't yet, deliberately — Terraform state is
    // still 100% local in both modes until the Step 4 remote-backend migration lands (explicitly
    // gated pending review). Deleting the working directory today would delete a deployment's only
    // copy of its state. Wire full-directory cleanup for s3 mode in together with Step 4, not before.
    await removeProviderCache(workDir);

    await createNotification({
      workspace: deployment.workspace,
      type: 'destroy',
      status: 'success',
      title: auto ? `Cleaned up "${deployment.name}" after failed deployment` : `Infrastructure "${deployment.name}" destroyed`,
      message: auto
        ? 'The deployment failed partway through. Resources it had already created in AWS were automatically destroyed, so nothing is left running or billing.'
        : 'Terraform destroy completed successfully.',
      resourceType: 'Deployment',
      resourceId: deployment._id,
      resourceName: deployment.name,
    });
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await failDeployment(deployment, error.message ?? 'Terraform destroy failed.', 'destroy', { auto });

      // A failed destroy still leaves the provider cache behind — it's just as unneeded here as it
      // is on any other terminal path (the deploy-failure path already cleans this up via
      // deploymentGuards.js). Without this, every failed destroy permanently leaks 600MB+. Resolves
      // the work dir the same way the destroy flow itself does, so this still finds it even for a
      // record where terraformWorkDir was never explicitly saved.
      await removeProviderCache(deployment.terraformWorkDir || (await storage.getWorkingDirectory(id)));
    }
  } finally {
    runningDeployments.delete(id);
  }
}

// Answers "is this actually gone from AWS, or still sitting there (and billing)?" — the question
// that matters most right after a failed destroy, where Terraform's local state may not match
// reality. Uses `terraform plan -refresh-only`, which only reads real AWS state and reports drift;
// it never proposes or applies a change, so this is safe to run at any time regardless of a
// deployment's current status. Synchronous (unlike deploy/destroy) since a refresh is comparatively
// fast — no resources are being created or destroyed, only described.
export async function verifyDeploymentResources(deploymentId) {
  const id = String(deploymentId);
  const deployment = await Deployment.findById(id).populate('awsAccount');
  if (!deployment) throw new Error('Deployment not found.');

  const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
  if (!account) throw new Error('AWS account not found for this deployment.');

  const outputs = deployment.outputs && typeof deployment.outputs === 'object' ? deployment.outputs : {};
  const regionConsoleUrl = `https://${encodeURIComponent(account.defaultRegion)}.console.aws.amazon.com/console/home?region=${encodeURIComponent(account.defaultRegion)}`;

  if (!deployment.terraform) {
    return {
      checkedAt: new Date().toISOString(),
      region: account.defaultRegion,
      regionConsoleUrl,
      resources: [],
      error: 'No Terraform configuration was saved for this deployment, so there is nothing to check it against.',
    };
  }

  const workDir = deployment.terraformWorkDir || (await storage.getWorkingDirectory(id));

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(path.join(workDir, 'main.tf'), deployment.terraform, 'utf8');

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

    await runProcess(env.TERRAFORM_BIN, ['init', '-input=false'], workDir, terraformEnv);
    await runProcess(env.TERRAFORM_BIN, ['plan', '-input=false', '-refresh-only', '-out=refresh.tfplan'], workDir, terraformEnv);
    const showOutput = await runProcess(env.TERRAFORM_BIN, ['show', '-json', 'refresh.tfplan'], workDir, terraformEnv);
    const planJson = JSON.parse(showOutput || '{}');

    // planned_values reflects what's currently tracked in state (stable, documented field on every
    // `terraform show -json` plan output). resource_drift lists only what refresh found different
    // from state — an address with a "delete" drift action means refresh discovered AWS no longer
    // has it, i.e. it's gone from the real account even though (or because) Terraform once created
    // it.
    const trackedAddresses = new Set((planJson.planned_values?.root_module?.resources ?? []).map((resource) => resource.address));
    const missingAddresses = new Set(
      (planJson.resource_drift ?? [])
        .filter((item) => Array.isArray(item.change?.actions) && item.change.actions.includes('delete'))
        .map((item) => item.address),
    );

    const resources = Object.entries(outputs).map(([name, info]) => describeVerifiedResource(name, info, account, missingAddresses, trackedAddresses, regionConsoleUrl));

    return { checkedAt: new Date().toISOString(), region: account.defaultRegion, regionConsoleUrl, resources };
  } catch (error) {
    const resources = Object.entries(outputs).map(([name, info]) => describeVerifiedResource(name, info, account, new Set(), null, regionConsoleUrl));
    return {
      checkedAt: new Date().toISOString(),
      region: account.defaultRegion,
      regionConsoleUrl,
      resources,
      error: `Automatic verification could not complete: ${stripAnsi(error.message ?? String(error)).slice(0, 500)}. Check the resources below directly in the AWS Console instead.`,
    };
  } finally {
    await removeProviderCache(workDir);
  }
}

function describeVerifiedResource(name, info, account, missingAddresses, trackedAddresses, regionConsoleUrl) {
  const address = info?.terraform_address ?? '';
  const status = !address || !trackedAddresses ? 'unknown' : missingAddresses.has(address) ? 'missing' : trackedAddresses.has(address) ? 'present' : 'destroyed';

  return {
    name,
    label: info?.label ?? name,
    service: info?.service ?? '',
    terraformAddress: address,
    status,
    consoleUrl: buildAwsConsoleUrl({ service: info?.service, region: account.defaultRegion, info }) ?? regionConsoleUrl,
  };
}

// Best-effort deep links into the AWS Console for the resource types this app most commonly
// generates. Deliberately not exhaustive — anything unmapped (or missing the identifier it needs)
// falls back to the region's console home in the caller, which is still a real starting point for
// manual verification even without a direct link to the specific resource.
function buildAwsConsoleUrl({ service, region, info }) {
  if (!region) return null;
  const r = encodeURIComponent(region);

  switch (service) {
    case 's3':
      return info?.id ? `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(info.id)}` : null;
    case 'lambda':
      return info?.function_name ? `https://${r}.console.aws.amazon.com/lambda/home?region=${r}#/functions/${encodeURIComponent(info.function_name)}` : null;
    case 'ec2':
      return info?.id ? `https://${r}.console.aws.amazon.com/ec2/home?region=${r}#InstanceDetails:instanceId=${encodeURIComponent(info.id)}` : null;
    case 'rds':
      return info?.resource_id ? `https://${r}.console.aws.amazon.com/rds/home?region=${r}#database:id=${encodeURIComponent(info.resource_id)}` : null;
    case 'dynamodb':
      return info?.id ? `https://${r}.console.aws.amazon.com/dynamodbv2/home?region=${r}#table?name=${encodeURIComponent(info.id)}` : null;
    case 'iam':
      return info?.name ? `https://console.aws.amazon.com/iam/home#/roles/details/${encodeURIComponent(info.name)}` : null;
    case 'cloudfront':
      return info?.id ? `https://console.aws.amazon.com/cloudfront/v3/home#/distributions/${encodeURIComponent(info.id)}` : null;
    case 'security-group':
      return info?.id ? `https://${r}.console.aws.amazon.com/ec2/home?region=${r}#SecurityGroup:groupId=${encodeURIComponent(info.id)}` : null;
    case 'vpc':
      return info?.id ? `https://${r}.console.aws.amazon.com/vpcconsole/home?region=${r}#VpcDetails:VpcId=${encodeURIComponent(info.id)}` : null;
    case 'sqs':
      return info?.url ? `https://${r}.console.aws.amazon.com/sqs/v2/home?region=${r}#/queues/${encodeURIComponent(info.url)}` : null;
    case 'secrets':
      return info?.name ? `https://${r}.console.aws.amazon.com/secretsmanager/home?region=${r}#/secret?name=${encodeURIComponent(info.name)}` : null;
    case 'kms':
      return info?.key_id ? `https://${r}.console.aws.amazon.com/kms/home?region=${r}#/kms/keys/${encodeURIComponent(info.key_id)}` : null;
    case 'waf':
      return `https://${r}.console.aws.amazon.com/wafv2/homev2/web-acls?region=${r}`;
    default:
      return null;
  }
}

// Lambda nodes deployed via an uploaded zip (see FilePathField in PropertiesPanel.tsx) reference
// their package by upload id. In local storage mode, terraformGenerator.js emits
// `filename = "<uploadId>.zip"`, so the file has to physically exist under that exact name in the
// working directory before `terraform` reads it — both for a real `apply` run here, and for Layer
// 2's `terraform validate` scratch directory (terraformCliValidator.js), which calls this same
// function so filebase64sha256() doesn't fail validate with "file not found" for a correctly
// uploaded zip that just hasn't been staged into that particular directory yet. In s3 storage mode,
// terraformGenerator.js instead emits `s3_bucket`/`s3_key` directly, so Terraform reads the object
// straight from S3 and there is nothing to stage locally — resolveArtifactReference tells us which
// case we're in without this function needing to know about STORAGE_MODE itself.
export async function stageLambdaZipUploads(uploadIds, workDir) {
  for (const uploadId of uploadIds ?? []) {
    const key = `lambda-zips/${uploadId}.zip`;
    const ref = storage.resolveArtifactReference(key);
    if (ref.type !== 'local') continue;

    if (!(await storage.exists(key))) {
      throw new Error(
        `Uploaded Lambda deployment package (${uploadId}.zip) was not found on the server. Re-upload the zip from the Lambda node's "Deployment zip path" field and redeploy.`,
      );
    }
    await writeFile(path.join(workDir, ref.filename), await storage.readFile(key));
  }
}

// s3 storage mode only: filebase64sha256() can't read an S3 object, so source_code_hash comes from
// a hash computed once at upload time (see lambdaZipUploads.js) instead. terraformGenerator.js emits
// `lookup(var.lambda_source_code_hashes, "<uploadId>", null)` for each such Lambda resource; this
// writes the matching values as a Terraform auto-loaded tfvars file so no extra CLI flags are needed
// and `terraform init`/`plan`/`apply`/`destroy` args stay exactly as they were before this existed.
async function writeLambdaSourceHashTfvars(deployment, workDir) {
  if (storage.mode !== 's3') return;

  const hashes = {};
  for (const uploadId of deployment.lambdaZipUploadIds ?? []) {
    const metadata = await getLambdaZipUploadMetadata(uploadId);
    if (metadata) hashes[uploadId] = metadata.sourceCodeHash;
  }

  await writeFile(
    path.join(workDir, 'infraflow_lambda_hashes.auto.tfvars.json'),
    JSON.stringify({ lambda_source_code_hashes: hashes }),
    'utf8',
  );
}

async function getOrCreateWorkDir(deployment, deploymentId) {
  if (deployment.terraformWorkDir) {
    await mkdir(deployment.terraformWorkDir, { recursive: true });
    return deployment.terraformWorkDir;
  }

  return storage.getWorkingDirectory(deploymentId);
}

// Every deployment gets its own work directory (so each has its own state), but without a shared
// plugin cache, Terraform re-downloads the full AWS provider binary (600MB+) into every single one
// of them. Pointing TF_PLUGIN_CACHE_DIR at one shared directory means every run after the first
// just hardlinks to the already-downloaded copy instead of re-fetching it.
export async function getPluginCacheDir() {
  const baseDir = env.TERRAFORM_WORK_DIR || path.join(tmpdir(), 'infraflow-deployments');
  const cacheDir = path.join(baseDir, '.plugin-cache');
  await mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

async function removeProviderCache(workDir) {
  try {
    await rm(path.join(workDir, '.terraform'), { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — a failure here shouldn't affect the destroy result the user sees.
  }
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Reads Terraform's own view of state via the CLI instead of parsing terraform.tfstate's raw JSON
// directly — this keeps working once state moves behind a remote backend (Step 4): `show` reads
// through whatever backend main.tf currently configures, local or remote, without this file needing
// to know which. Requires an initialized working directory; init is safe/cheap to re-run here since
// TF_PLUGIN_CACHE_DIR keeps it from re-downloading anything. This app never generates `module`
// blocks, so only root_module.resources is read — revisit if that ever changes.
async function terraformStateResources(workDir, terraformEnv) {
  await runProcess(env.TERRAFORM_BIN, ['init', '-input=false'], workDir, terraformEnv);
  const output = await runProcess(env.TERRAFORM_BIN, ['show', '-json'], workDir, terraformEnv);
  const parsed = JSON.parse(output || '{}');
  return parsed.values?.root_module?.resources ?? [];
}

// A minimal env for read-only state checks that can happen before AWS credentials exist yet (e.g.
// the deploy-failure handler, if assumeAwsRole itself is what failed). No AWS credentials needed
// today since init/show against the local backend never call AWS — only true once Step 4 adds a
// remote backend that init itself must authenticate to.
async function readOnlyTerraformEnv() {
  return {
    ...process.env,
    TF_IN_AUTOMATION: 'true',
    TF_PLUGIN_CACHE_DIR: await getPluginCacheDir(),
  };
}

async function hasTerraformState(workDir) {
  try {
    const resources = await terraformStateResources(workDir, await readOnlyTerraformEnv());
    return resources.length > 0;
  } catch {
    // Must never throw: this runs inside runTerraformDeployment's own catch block. Matches the old
    // behavior exactly — no state, no init yet, terraform binary missing, malformed output, all
    // collapse to "false," same as before.
    return false;
  }
}

async function emptyS3BucketsFromTerraformState(deployment, workDir, terraformEnv, credentials, region) {
  const buckets = await s3BucketsFromTerraformState(workDir, terraformEnv);
  if (!buckets.length) return;

  for (const { bucket, bucketRegion } of buckets) {
    const s3 = new S3Client({ region: bucketRegion || region, credentials });
    try {
      deployment.logs.push({ message: `Emptying S3 bucket ${bucket} before Terraform destroy.`, level: 'warning' });
      await deployment.save();
      await deleteCurrentS3Objects(s3, bucket);
      try {
        await deleteVersionedS3Objects(s3, bucket);
      } catch (error) {
        if (!isAwsAccessDenied(error)) throw error;
        deployment.logs.push({
          message: `Skipped versioned-object cleanup for ${bucket}; the AWS role does not allow listing object versions.`,
          level: 'warning',
        });
      }
      deployment.logs.push({ message: `S3 bucket ${bucket} is empty and ready for Terraform destroy.`, level: 'info' });
      await deployment.save();
    } catch (error) {
      if (error?.name === 'NoSuchBucket') {
        deployment.logs.push({ message: `S3 bucket ${bucket} no longer exists; continuing Terraform destroy.`, level: 'warning' });
        await deployment.save();
        continue;
      }

      throw new Error(
        `Unable to empty S3 bucket ${bucket} before destroy: ${stripAnsi(error.message ?? String(error))}. ` +
          'Ensure the connected AWS role has s3:ListBucket, s3:ListBucketVersions, s3:DeleteObject, and s3:DeleteObjectVersion.',
      );
    }
  }
}

// Unlike hasTerraformState, failures here are NOT swallowed — matches the pre-existing behavior of
// surfacing a destroy-blocking error rather than silently skipping bucket-emptying and letting
// `terraform destroy` fail later with a less actionable "BucketNotEmpty" AWS error.
async function s3BucketsFromTerraformState(workDir, terraformEnv) {
  let resources;
  try {
    resources = await terraformStateResources(workDir, terraformEnv);
  } catch (error) {
    throw new Error(
      `Unable to read Terraform state before destroy: ${stripAnsi(error.message ?? String(error))}. ` +
        'Check that the Terraform binary is reachable and the working directory is not corrupted.',
    );
  }

  const buckets = new Set();
  for (const resource of resources) {
    if (resource.type !== 'aws_s3_bucket') continue;
    const bucket = resource.values?.bucket ?? resource.values?.id;
    if (bucket) buckets.add(JSON.stringify({ bucket: String(bucket), bucketRegion: resource.values?.region ? String(resource.values.region) : '' }));
  }

  return Array.from(buckets).map((item) => JSON.parse(item));
}

async function deleteVersionedS3Objects(s3, bucket) {
  let keyMarker;
  let versionIdMarker;

  do {
    const response = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    const objects = [...(response.Versions ?? []), ...(response.DeleteMarkers ?? [])]
      .filter((item) => item.Key)
      .map((item) => ({ Key: item.Key, VersionId: item.VersionId }));

    await deleteS3Objects(s3, bucket, objects);
    keyMarker = response.NextKeyMarker;
    versionIdMarker = response.NextVersionIdMarker;
  } while (keyMarker || versionIdMarker);
}

async function deleteCurrentS3Objects(s3, bucket) {
  let continuationToken;

  do {
    const response = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    const objects = (response.Contents ?? []).filter((item) => item.Key).map((item) => ({ Key: item.Key }));

    await deleteS3Objects(s3, bucket, objects);
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
}

async function deleteS3Objects(s3, bucket, objects) {
  for (let index = 0; index < objects.length; index += 1000) {
    const batch = objects.slice(index, index + 1000);
    if (!batch.length) continue;
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
  }
}

function isAwsAccessDenied(error) {
  const value = `${error?.name ?? ''} ${error?.Code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return value.includes('accessdenied') || value.includes('access denied');
}

async function runTerraformCommand(deployment, cwd, args, commandEnv) {
  deployment.logs.push({ message: `terraform ${args.join(' ')}`, level: 'info' });
  await deployment.save();

  const output = await runProcess(env.TERRAFORM_BIN, args, cwd, commandEnv);
  for (const line of stripAnsi(output).split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(-80)) {
    deployment.logs.push({ message: line.slice(0, 1800), level: line.toLowerCase().includes('error') ? 'error' : 'info' });
  }
  await deployment.save();
}

async function readTerraformOutputs(deployment, cwd, commandEnv) {
  try {
    const output = await runProcess(env.TERRAFORM_BIN, ['output', '-json', 'infraflow_resource_outputs'], cwd, commandEnv);
    const parsed = JSON.parse(output || '{}');
    deployment.logs.push({ message: 'Captured Terraform resource outputs for one-time resource info download.', level: 'info' });
    await deployment.save();
    return parsed;
  } catch (error) {
    deployment.logs.push({
      message: `Terraform apply completed, but resource outputs could not be captured: ${stripAnsi(error.message ?? String(error)).slice(0, 1200)}`,
      level: 'warning',
    });
    await deployment.save();
    return {};
  }
}

export function runProcess(command, args, cwd, commandEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: commandEnv,
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output || `${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

function createLambdaStubZip() {
  const content = Buffer.from(
    "exports.handler = async () => ({ statusCode: 200, body: JSON.stringify({ ok: true, source: 'infraflow' }) });\n",
    'utf8',
  );
  return zipSingleFile('index.js', content);
}

function zipSingleFile(fileName, content) {
  const fileNameBuffer = Buffer.from(fileName, 'utf8');
  const crc = crc32(content);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(fileNameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(content.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(fileNameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralSize = centralHeader.length + fileNameBuffer.length;
  const centralOffset = localHeader.length + fileNameBuffer.length + content.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, fileNameBuffer, content, centralHeader, fileNameBuffer, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
