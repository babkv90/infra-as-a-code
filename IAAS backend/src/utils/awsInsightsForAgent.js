import { AwsAccount } from '../models/AwsAccount.js';
import { withTrackedDailyBilling } from '../services/awsBillingHistory.js';

// Cache-first, matching the Cost agent's plan requirement (§1.5): reuses the exact same query
// getInsights() (awsController.js) already runs — never a fresh AWS API call. Returns a trimmed
// {monthlySpend, byService} shape rather than the whole syncSummary blob, since that's all the
// Cost agent's DSL projection needs.
export async function getCachedAwsInsightsForWorkspace(workspaceId) {
  const account = await AwsAccount.findOne({ workspace: workspaceId, status: 'connected' }).sort({ lastSyncAt: -1 });
  if (!account) return null;

  const insights = withTrackedDailyBilling(account);
  if (!insights?.billing) return null;

  return {
    monthlySpend: insights.billing.monthlySpend,
    byService: insights.billing.byService ?? [],
  };
}
