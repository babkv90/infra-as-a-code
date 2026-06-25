import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { assumeAwsRole } from './awsRoleCredentials.js';

const runningDeployments = new Set();

export async function runTerraformDeployment(deploymentId) {
  const id = String(deploymentId);
  if (runningDeployments.has(id)) return;
  runningDeployments.add(id);

  try {
    const deployment = await Deployment.findById(id).populate('awsAccount');
    if (!deployment) return;

    if (!env.TERRAFORM_APPLY_ENABLED) {
      await failDeployment(deployment, 'Terraform apply is disabled. Set TERRAFORM_APPLY_ENABLED=true in IAAS backend/.env to run real AWS deployments.');
      return;
    }

    if (deployment.validationIssues.some((issue) => issue.severity === 'error')) {
      await failDeployment(deployment, 'Deployment has blocking validation errors.');
      return;
    }

    const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
    if (!account) {
      await failDeployment(deployment, 'AWS account not found for deployment.');
      return;
    }

    deployment.status = 'deploying';
    deployment.startedAt = new Date();
    deployment.logs.push({ message: 'Starting Terraform deployment runner.', level: 'info' });
    await deployment.save();

    const credentials = await assumeAwsRole(account);
    const workDir = await createWorkDir(id);
    await writeFile(path.join(workDir, 'main.tf'), deployment.terraform, 'utf8');

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
    };

    await runTerraformCommand(deployment, workDir, ['init', '-input=false'], terraformEnv);
    await runTerraformCommand(deployment, workDir, ['plan', '-input=false', '-out=tfplan'], terraformEnv);
    await runTerraformCommand(deployment, workDir, ['apply', '-input=false', '-auto-approve', 'tfplan'], terraformEnv);

    deployment.status = 'deployed';
    deployment.finishedAt = new Date();
    deployment.logs.push({ message: 'Terraform apply completed. AWS resources should now be visible in the target account console.', level: 'info' });
    await deployment.save();
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await failDeployment(deployment, error.message ?? 'Terraform deployment failed.');
    }
  } finally {
    runningDeployments.delete(id);
  }
}

async function createWorkDir(deploymentId) {
  const baseDir = env.TERRAFORM_WORK_DIR || path.join(tmpdir(), 'infraflow-deployments');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(path.join(baseDir, `${deploymentId}-`));
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

async function failDeployment(deployment, message) {
  deployment.status = 'failed';
  deployment.finishedAt = new Date();
  deployment.logs.push({ message: addPermissionHint(stripAnsi(message)), level: 'error' });
  await deployment.save();
}

function stripAnsi(value = '') {
  return String(value).replace(/\u001b\[[0-9;]*m/g, '');
}

function addPermissionHint(message) {
  if (message.includes('ec2:DescribeInstanceAttribute')) {
    return `${message}\n\nFix: add ec2:DescribeInstanceAttribute to the IAM policy attached to the connected AWS role, then rerun deployment. Terraform creates the EC2 instance first, then reads this attribute to complete state refresh.`;
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
