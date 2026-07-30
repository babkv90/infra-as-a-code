import { AwsAccount } from '../models/AwsAccount.js';
import { mergeTrackedDailyBilling } from './awsBillingHistory.js';
import { syncAwsAccountData } from './awsLiveSync.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function nextUtcMidnightDelay() {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1000, nextMidnight.getTime() - now.getTime());
}

export async function runDailyBillingTracking() {
  const accounts = await AwsAccount.find({ status: 'connected' });
  let updated = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      account.syncSummary = await syncAwsAccountData(account);
      mergeTrackedDailyBilling(account, account.syncSummary);
      account.accountId = account.syncSummary.identity?.accountId ?? account.accountId;
      account.lastSyncAt = new Date();
      account.lastError = undefined;
      await account.save();
      updated += 1;
    } catch (error) {
      account.lastError = `Daily billing tracking failed: ${error.message}`;
      await account.save();
      failed += 1;
    }
  }

  return { scanned: accounts.length, updated, failed };
}

export function startDailyBillingTracker() {
  const scheduleNextRun = () => {
    setTimeout(() => {
      runDailyBillingTracking()
        .then(({ scanned, updated, failed }) => {
          if (scanned > 0) {
            console.log(`Daily AWS billing tracking: ${updated}/${scanned} account(s) updated, ${failed} failed.`);
          }
        })
        .catch((error) => {
          console.error('Daily AWS billing tracking failed to run', error);
        })
        .finally(() => {
          setInterval(() => {
            runDailyBillingTracking().catch((error) => {
              console.error('Daily AWS billing tracking failed to run', error);
            });
          }, DAY_MS);
        });
    }, nextUtcMidnightDelay());
  };

  scheduleNextRun();
}
