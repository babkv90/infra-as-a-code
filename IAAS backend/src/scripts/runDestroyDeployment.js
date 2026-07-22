import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { runTerraformDestroy } from '../services/terraformDeploymentRunner.js';

const deploymentId = process.argv[2];

if (!deploymentId) {
  console.error('Usage: node src/scripts/runDestroyDeployment.js <deploymentId>');
  process.exit(1);
}

try {
  await mongoose.connect(env.MONGODB_URI);
  await runTerraformDestroy(deploymentId);
  console.log(JSON.stringify({ deploymentId, completed: true }));
} finally {
  await mongoose.disconnect();
}
