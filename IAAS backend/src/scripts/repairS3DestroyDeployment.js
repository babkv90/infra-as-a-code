import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Deployment } from '../models/Deployment.js';

const deploymentId = process.argv[2];

if (!deploymentId) {
  console.error('Usage: node src/scripts/repairS3DestroyDeployment.js <deploymentId>');
  process.exit(1);
}

function addS3ForceDestroy(terraform) {
  return terraform.replace(
    /(resource "aws_s3_bucket" "[^"]+" \{\r?\n(?:\s+(?:bucket|bucket_prefix)\s*=\s*[^\r\n]+\r?\n))(?!\s+force_destroy\s*=)/g,
    '$1  force_destroy = true\n',
  );
}

try {
  await mongoose.connect(env.MONGODB_URI);
  const deployment = await Deployment.findById(deploymentId);
  if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

  const updatedTerraform = addS3ForceDestroy(deployment.terraform ?? '');
  const changed = updatedTerraform !== deployment.terraform;

  if (changed) {
    deployment.terraform = updatedTerraform;
    deployment.logs.push({
      level: 'info',
      message: 'Updated saved Terraform to allow S3 bucket cleanup during destroy.',
    });
    await deployment.save();
  }

  if (deployment.terraformWorkDir) {
    await writeFile(path.join(deployment.terraformWorkDir, 'main.tf'), deployment.terraform, 'utf8');
  }

  console.log(
    JSON.stringify({
      deploymentId: String(deployment._id),
      changed,
      status: deployment.status,
      terraformWorkDir: deployment.terraformWorkDir,
    }),
  );
} finally {
  await mongoose.disconnect();
}
