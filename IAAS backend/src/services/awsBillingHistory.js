function utcDayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date = new Date()) {
  return utcDayStart(date).toISOString().slice(0, 10);
}

export function mergeTrackedDailyBilling(account, syncSummary) {
  if (!syncSummary?.billing) return syncSummary;

  if (!account.dailyBillingStartedAt) {
    account.dailyBillingStartedAt = utcDayStart();
  }

  const startDate = isoDate(account.dailyBillingStartedAt);
  const existingHistory = Array.isArray(account.dailyBillingHistory) ? account.dailyBillingHistory : [];
  const historyByDate = new Map(
    existingHistory
      .filter((item) => item?.date && item.date >= startDate)
      .map((item) => [
        item.date,
        {
          date: item.date,
          label: item.label,
          start: item.start,
          end: item.end,
          cost: Number(item.cost ?? 0),
          recordedAt: item.recordedAt ?? new Date(),
        },
      ]),
  );

  for (const item of syncSummary.billing.dailyTrend ?? []) {
    if (!item?.date || item.date < startDate) continue;
    historyByDate.set(item.date, {
      date: item.date,
      label: item.label,
      start: item.start,
      end: item.end,
      cost: Number(item.cost ?? 0),
      recordedAt: new Date(),
    });
  }

  const dailyBillingHistory = [...historyByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  account.dailyBillingHistory = dailyBillingHistory;
  syncSummary.billing.dailyTrend = dailyBillingHistory.map(({ date, label, start, end, cost }) => ({ date, label, start, end, cost }));

  account.markModified?.('dailyBillingHistory');
  account.markModified?.('syncSummary');

  return syncSummary;
}

export function withTrackedDailyBilling(account) {
  const syncSummary = account?.syncSummary ?? {};
  const dailyBillingHistory = Array.isArray(account?.dailyBillingHistory) ? account.dailyBillingHistory : [];
  if (!dailyBillingHistory.length || !syncSummary.billing) return syncSummary;

  return {
    ...syncSummary,
    billing: {
      ...syncSummary.billing,
      dailyTrend: dailyBillingHistory.map(({ date, label, start, end, cost }) => ({ date, label, start, end, cost })),
    },
  };
}
