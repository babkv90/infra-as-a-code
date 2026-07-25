import { Deployment } from '../models/Deployment.js';
import * as localRunner from './terraformDeploymentRunner.js';
import * as githubRunner from './githubTerraformRunner.js';

// The one place that looks at a deployment's pinned `executor` and routes to the matching runner.
// Both runners implement the same runTerraformDeployment/runTerraformDestroy contract (same
// signatures, same Deployment.status/logs/outputs side effects) and share deploymentGuards.js for
// the safety-critical decision logic — this dispatcher only ever picks which one to call, it never
// duplicates any of their behavior.
async function resolveRunner(deploymentId) {
  const deployment = await Deployment.findById(deploymentId).select('executor');
  return deployment?.executor === 'github-actions' ? githubRunner : localRunner;
}

export async function runTerraformDeployment(deploymentId, options) {
  const runner = await resolveRunner(deploymentId);
  return runner.runTerraformDeployment(deploymentId, options);
}

export async function runTerraformDestroy(deploymentId, options) {
  const runner = await resolveRunner(deploymentId);
  return runner.runTerraformDestroy(deploymentId, options);
}
