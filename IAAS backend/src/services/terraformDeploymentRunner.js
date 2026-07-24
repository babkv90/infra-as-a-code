import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { assumeAwsRole } from './awsRoleCredentials.js';
import { createNotification } from './notificationService.js';

const runningDeployments = new Set();

export async function runTerraformDeployment(deploymentId, { isUpdate = false } = {}) {
  const id = String(deploymentId);
  if (runningDeployments.has(id)) return;
  runningDeployments.add(id);

  try {
    const deployment = await Deployment.findById(id).populate('awsAccount');
    if (!deployment) return;

    if (!env.TERRAFORM_APPLY_ENABLED) {
      await failDeployment(deployment, 'Terraform apply is disabled. Set TERRAFORM_APPLY_ENABLED=true in IAAS backend/.env to run real AWS deployments.', isUpdate ? 'update' : 'deploy');
      return;
    }

    if (deployment.validationIssues.some((issue) => issue.severity === 'error')) {
      await failDeployment(deployment, 'Deployment has blocking validation errors.', isUpdate ? 'update' : 'deploy');
      return;
    }

    const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
    if (!account) {
      await failDeployment(deployment, 'AWS account not found for deployment.', isUpdate ? 'update' : 'deploy');
      return;
    }

    deployment.status = 'deploying';
    deployment.startedAt = new Date();
    deployment.logs.push({ message: isUpdate ? 'Starting Terraform update runner.' : 'Starting Terraform deployment runner.', level: 'info' });
    await deployment.save();

    const credentials = await assumeAwsRole(account);
    const workDir = await getOrCreateWorkDir(deployment, id);
    await writeFile(path.join(workDir, 'main.tf'), deployment.terraform, 'utf8');
    deployment.terraformWorkDir = workDir;
    await deployment.save();

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
    await runTerraformCommand(deployment, workDir, ['plan', '-input=false', '-out=tfplan'], terraformEnv);
    await runTerraformCommand(deployment, workDir, ['apply', '-input=false', '-auto-approve', 'tfplan'], terraformEnv);
    deployment.outputs = await readTerraformOutputs(deployment, workDir, terraformEnv);

    deployment.status = 'deployed';
    deployment.finishedAt = new Date();
    deployment.logs.push({
      message: isUpdate
        ? 'Terraform update completed. Only the changed resources were touched; everything else was left as-is.'
        : 'Terraform apply completed. AWS resources should now be visible in the target account console.',
      level: 'info',
    });
    await deployment.save();

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

      // Auto-destroy-on-failure only makes sense for a first-time create: there's nothing working
      // yet to protect. For an update to already-running infrastructure, a failed apply must NOT
      // trigger a full teardown — that would destroy resources that were working fine before this
      // update was attempted. Leave it in `failed` status and let the user decide what to do next.
      const createdRealState = deployment.terraformWorkDir && (await hasTerraformState(deployment.terraformWorkDir));
      if (!isUpdate && createdRealState) {
        deployment.logs.push({
          message: 'Automatically destroying any AWS resources created before this failure, to avoid leaving orphaned infrastructure behind.',
          level: 'warning',
        });
        await deployment.save();
        await runTerraformDestroy(id, { force: true, auto: true });
      } else if (isUpdate) {
        deployment.logs.push({
          message: 'This update failed. Nothing was automatically destroyed since infrastructure from before this update may still be running — check Terraform state and the AWS console before retrying.',
          level: 'warning',
        });
        await deployment.save();
      } else if (deployment.terraformWorkDir) {
        // Failed before creating any real AWS resource, so runTerraformDestroy never runs for this
        // one — clean up the downloaded provider binaries directly, since they'd otherwise sit
        // there unused forever.
        await removeProviderCache(deployment.terraformWorkDir);
      }
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

    const workDir = deployment.terraformWorkDir || path.join(env.TERRAFORM_WORK_DIR || path.join(tmpdir(), 'infraflow-deployments'), id);
    const statePath = path.join(workDir, 'terraform.tfstate');
    if (!(await pathExists(statePath))) {
      if (force) {
        deployment.status = auto ? 'failed' : 'cancelled';
        deployment.finishedAt = new Date();
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

    await emptyS3BucketsFromTerraformState(deployment, workDir, credentials, account.defaultRegion);
    await runTerraformCommand(deployment, workDir, ['init', '-input=false'], terraformEnv);
    await runTerraformCommand(deployment, workDir, ['destroy', '-input=false', '-auto-approve'], terraformEnv);

    deployment.status = auto ? 'failed' : 'destroyed';
    deployment.finishedAt = new Date();
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
    }
  } finally {
    runningDeployments.delete(id);
  }
}

async function getOrCreateWorkDir(deployment, deploymentId) {
  if (deployment.terraformWorkDir) {
    await mkdir(deployment.terraformWorkDir, { recursive: true });
    return deployment.terraformWorkDir;
  }

  const baseDir = env.TERRAFORM_WORK_DIR || path.join(tmpdir(), 'infraflow-deployments');
  await mkdir(baseDir, { recursive: true });
  const workDir = path.join(baseDir, deploymentId);
  await mkdir(workDir, { recursive: true });
  return workDir;
}

// Every deployment gets its own work directory (so each has its own state), but without a shared
// plugin cache, Terraform re-downloads the full AWS provider binary (600MB+) into every single one
// of them. Pointing TF_PLUGIN_CACHE_DIR at one shared directory means every run after the first
// just hardlinks to the already-downloaded copy instead of re-fetching it.
async function getPluginCacheDir() {
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

async function hasTerraformState(workDir) {
  const statePath = path.join(workDir, 'terraform.tfstate');
  if (!(await pathExists(statePath))) return false;

  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return Array.isArray(state.resources) && state.resources.length > 0;
  } catch {
    return false;
  }
}

async function emptyS3BucketsFromTerraformState(deployment, workDir, credentials, region) {
  const buckets = await s3BucketsFromTerraformState(workDir);
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

async function s3BucketsFromTerraformState(workDir) {
  const state = JSON.parse(await readFile(path.join(workDir, 'terraform.tfstate'), 'utf8'));
  const buckets = new Set();

  for (const resource of state.resources ?? []) {
    if (resource.type !== 'aws_s3_bucket') continue;
    for (const instance of resource.instances ?? []) {
      const bucket = instance.attributes?.bucket ?? instance.attributes?.id;
      if (bucket) buckets.add(JSON.stringify({ bucket: String(bucket), bucketRegion: instance.attributes?.region ? String(instance.attributes.region) : '' }));
    }
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

function runProcess(command, args, cwd, commandEnv) {
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

async function failDeployment(deployment, message, phase = 'deploy', { auto = false } = {}) {
  const finalMessage = addPermissionHint(stripAnsi(message));
  deployment.status = 'failed';
  deployment.finishedAt = new Date();
  deployment.logs.push({ message: finalMessage, level: 'error' });
  await deployment.save();

  await createNotification({
    workspace: deployment.workspace,
    type: phase === 'destroy' ? 'destroy' : 'deployment',
    status: 'failed',
    title:
      phase === 'destroy'
        ? auto
          ? `Automatic cleanup failed for "${deployment.name}" - resources may still exist in AWS`
          : `Destroy failed for "${deployment.name}"`
        : phase === 'update'
          ? `Update failed for "${deployment.name}" - previous infrastructure was left untouched`
          : `Deployment "${deployment.name}" failed`,
    message: auto ? `Automatic cleanup after the failed deployment did not finish: ${finalMessage.slice(0, 220)}` : finalMessage.slice(0, 300),
    errorLog: finalMessage,
    resourceType: 'Deployment',
    resourceId: deployment._id,
    resourceName: deployment.name,
  });
}

function stripAnsi(value = '') {
  return String(value).replace(/\u001b\[[0-9;]*m/g, '');
}

function addPermissionHint(message) {
  if (message.includes('ec2:DescribeInstanceAttribute')) {
    return `${message}\n\nFix: add ec2:DescribeInstanceAttribute to the IAM policy attached to the connected AWS role, then rerun deployment. Terraform creates the EC2 instance first, then reads this attribute to complete state refresh.`;
  }

  if (message.includes('ec2:DescribeVpcAttribute')) {
    return `${message}\n\nFix: add ec2:DescribeVpcAttribute to the IAM policy attached to the connected AWS role, then rerun deployment. Terraform reads default VPC DNS attributes while planning resources that reference data.aws_vpc.default.`;
  }

  if (message.includes('iam:GetRole')) {
    return `${message}\n\nFix: add iam:GetRole to the IAM policy attached to the connected AWS role, then rerun deployment. EC2 deployments with an IAM role need Terraform to read that role before creating or attaching an instance profile. You will also need iam:PassRole and instance-profile permissions if the EC2 node uses an IAM role.`;
  }

  if (message.includes('iam:CreateInstanceProfile')) {
    return `${message}\n\nFix: add iam:CreateInstanceProfile to the IAM policy attached to the connected AWS role, then rerun deployment. EC2 deployments with an IAM role need Terraform to create an instance profile before attaching the role to the instance. You will also need iam:AddRoleToInstanceProfile and iam:PassRole.`;
  }

  if (message.includes('ec2:CreateSecurityGroup')) {
    return `${message}\n\nFix: add ec2:CreateSecurityGroup to the IAM policy attached to the connected AWS role, then rerun deployment. If Terraform manages security group rules, also allow ec2:AuthorizeSecurityGroupIngress, ec2:AuthorizeSecurityGroupEgress, ec2:RevokeSecurityGroupIngress, ec2:RevokeSecurityGroupEgress, and ec2:DeleteSecurityGroup.`;
  }

  return message;
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
