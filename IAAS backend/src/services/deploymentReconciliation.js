import { Deployment } from '../models/Deployment.js';
import { failDeployment } from './deploymentGuards.js';

const ACTIVE_STATUSES = ['deploying', 'destroying'];

// Run once, at server startup (and once per fresh Lambda container — see lambda.js), after the
// database connection is ready. Any deployment still sitting in deploying/destroying at the moment a
// fresh process boots was — by definition — interrupted: no in-flight async work survives a process
// restart, so nothing could still be legitimately "in progress" from this backend's point of view the
// instant it starts up.
//
// What "interrupted" means differs by executor, and that's the whole reason this isn't a single
// blanket fix:
//   - local executor: the actual `terraform` child process was a child of this same Node process —
//     it's gone. There's no way to resume it, only to find out what state it left behind. Always
//     marked interrupted.
//   - github-actions executor: the actual Terraform run happens on GitHub's infrastructure,
//     independent of this backend, and reports back via its own callback request
//     (terraformDeployCallbackController.js) whenever it finishes — regardless of whether this
//     backend process is still the one that dispatched it. If activeRun.githubRunId is set, a real
//     run was confirmed dispatched before whatever interrupted this process, so its callback is still
//     coming; touching the deployment now would race that callback for no reason. Only a deployment
//     with NO confirmed githubRunId — meaning the dispatch itself never got to that point — has
//     nothing to wait for and is treated the same as local: marked interrupted.
//
// Deliberately conservative for anything that can't be resumed: marks it failed and says so clearly,
// but never attempts an automatic destroy here. Reconciliation can't reliably tell an interrupted
// *update* (where auto-destroying would tear down infrastructure that was working before the update
// started) from an interrupted first-time create, and guessing wrong in that direction is exactly the
// kind of mistake the whole auto-destroy-on-failure design has always been careful to avoid. A human
// should look at these using "Verify resources in AWS" before deciding what to do next.
export async function reconcileInterruptedDeployments() {
  const stuck = await Deployment.find({ status: { $in: ACTIVE_STATUSES } });
  if (!stuck.length) return { reconciled: 0, skipped: 0, markedInterrupted: 0 };

  let skipped = 0;
  let markedInterrupted = 0;

  for (const deployment of stuck) {
    try {
      if (deployment.executor === 'github-actions' && deployment.activeRun?.githubRunId) {
        skipped += 1;
        continue;
      }

      await markInterrupted(deployment);
      markedInterrupted += 1;
    } catch (error) {
      // A failure while reconciling one deployment must never stop the others (or the server) from
      // starting — log and move on. It's still sitting in deploying/destroying, which the next boot
      // will try to reconcile again.
      console.error(`Failed to reconcile deployment ${deployment._id}:`, error.message ?? error);
    }
  }

  return { reconciled: stuck.length, skipped, markedInterrupted };
}

async function markInterrupted(deployment) {
  const wasDeploying = deployment.status === 'deploying';
  const action = deployment.activeRun?.action ?? (wasDeploying ? 'apply' : 'destroy');
  const isUpdate = Boolean(deployment.activeRun?.isUpdate);

  const context = isUpdate
    ? 'This was updating already-deployed infrastructure — nothing was automatically destroyed, since prior infrastructure may still be running.'
    : action === 'destroy'
      ? 'This was tearing down infrastructure — some AWS resources may have been partially removed.'
      : 'This was creating new infrastructure — some AWS resources may have been partially created.';

  await failDeployment(
    deployment,
    `This deployment was interrupted by a backend restart before it could finish (was "${deployment.status}"). ${context} No automatic cleanup was attempted — use "Verify resources in AWS" to check real AWS state before retrying.`,
    action === 'destroy' ? 'destroy' : isUpdate ? 'update' : 'deploy',
  );
}
