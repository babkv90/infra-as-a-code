import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { app } from './app.js';
import { reconcileInterruptedDeployments } from './services/deploymentReconciliation.js';
import { startDailyBillingTracker } from './services/awsDailyBillingTracker.js';
import { cleanupOrphanedLambdaZipUploads } from './services/lambdaZipCleanup.js';

const LAMBDA_ZIP_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runLambdaZipCleanup() {
  cleanupOrphanedLambdaZipUploads()
    .then(({ scanned, deleted }) => {
      if (deleted > 0) {
        console.log(`Lambda zip cleanup: removed ${deleted} of ${scanned} uploaded zip(s) no longer referenced by any deployment or diagram.`);
      }
    })
    .catch((error) => {
      console.error('Lambda zip cleanup failed to run', error);
    });
}

async function startServer() {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`IAAS backend running on port ${env.PORT}`);
  });

  // Not awaited — a github-actions resume can poll for as long as the original run would have taken,
  // and the API shouldn't wait on that to start accepting requests. Any deployment this finds was
  // already stuck before this process started, so a few extra seconds before it's picked up here
  // changes nothing.
  reconcileInterruptedDeployments()
    .then(({ reconciled, resumed, markedInterrupted }) => {
      if (reconciled > 0) {
        console.log(`Reconciled ${reconciled} interrupted deployment(s): ${resumed} resumed, ${markedInterrupted} marked failed for manual review.`);
      }
    })
    .catch((error) => {
      console.error('Deployment reconciliation failed to run', error);
    });

  // Runs once at startup (dev restarts are the main way this ever gets swept today) and then every
  // few hours for long-running production processes that never restart.
  runLambdaZipCleanup();
  setInterval(runLambdaZipCleanup, LAMBDA_ZIP_CLEANUP_INTERVAL_MS);

  startDailyBillingTracker();
}

startServer().catch((error) => {
  console.error('Failed to start IAAS backend', error);
  process.exit(1);
});
