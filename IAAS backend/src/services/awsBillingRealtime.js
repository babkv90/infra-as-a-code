import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { assumeAwsRole } from './awsRoleCredentials.js';

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function monthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function dayLabelFromDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  return date.toLocaleString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export async function getRealtimeDailyBilling(account) {
  const credentials = await assumeAwsRole(account);
  const costExplorer = new CostExplorerClient({ region: 'us-east-1', credentials });
  const { start, end } = monthRange();
  const response = await costExplorer.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
    }),
  );

  const dailyTrend =
    response.ResultsByTime?.map((result) => {
      const startDate = result.TimePeriod?.Start ?? '';
      const endDate = result.TimePeriod?.End ?? '';
      const cost = roundCurrency(result.Total?.UnblendedCost?.Amount);

      return {
        date: startDate,
        label: dayLabelFromDate(startDate),
        start: startDate,
        end: endDate,
        cost,
      };
    }) ?? [];

  return {
    updatedAt: new Date().toISOString(),
    start,
    end,
    total: roundCurrency(dailyTrend.reduce((sum, item) => sum + item.cost, 0)),
    dailyTrend,
  };
}
