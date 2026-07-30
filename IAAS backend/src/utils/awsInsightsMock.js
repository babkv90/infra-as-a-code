export function getMockAwsInsights() {
  return {
    billing: {
      monthlySpend: 0,
      estimatedSavings: 0,
      trend: [0, 0, 0, 0, 0, 0],
      monthlyTrend: [
        { month: '2026-02-01', label: 'Feb 26', start: '2026-02-01', end: '2026-03-01', cost: 0 },
        { month: '2026-03-01', label: 'Mar 26', start: '2026-03-01', end: '2026-04-01', cost: 0 },
        { month: '2026-04-01', label: 'Apr 26', start: '2026-04-01', end: '2026-05-01', cost: 0 },
        { month: '2026-05-01', label: 'May 26', start: '2026-05-01', end: '2026-06-01', cost: 0 },
        { month: '2026-06-01', label: 'Jun 26', start: '2026-06-01', end: '2026-07-01', cost: 0 },
        { month: '2026-07-01', label: 'Jul 26', start: '2026-07-01', end: '2026-07-30', cost: 0 },
      ],
      dailyTrend: [
        { date: '2026-07-01', label: '01 Jul', start: '2026-07-01', end: '2026-07-02', cost: 0 },
        { date: '2026-07-02', label: '02 Jul', start: '2026-07-02', end: '2026-07-03', cost: 0 },
        { date: '2026-07-03', label: '03 Jul', start: '2026-07-03', end: '2026-07-04', cost: 0 },
        { date: '2026-07-04', label: '04 Jul', start: '2026-07-04', end: '2026-07-05', cost: 0 },
        { date: '2026-07-05', label: '05 Jul', start: '2026-07-05', end: '2026-07-06', cost: 0 },
        { date: '2026-07-06', label: '06 Jul', start: '2026-07-06', end: '2026-07-07', cost: 0 },
      ],
      byService: [
        { service: 'EC2', cost: 0 },
        { service: 'RDS', cost: 0 },
        { service: 'Lambda', cost: 0 },
        { service: 'CloudWatch', cost: 0 },
        { service: 'S3', cost: 0 },
      ],
    },
    resources: {
      lambdaFunctions: 0,
      ec2Instances: 0,
      s3Buckets: 0,
      rdsInstances: 0,
      idleResources: 0,
      failedInvocations: 0,
      securityWarnings: 0,
    },
    recommendations: [],
    securityFindings: [],
    inventory: [
      { service: 'Lambda', count: 0, health: 'no live sync', spend: 0 },
      { service: 'EC2', count: 0, health: 'no live sync', spend: 0 },
      { service: 'S3', count: 0, health: 'no live sync', spend: 0 },
      { service: 'RDS', count: 0, health: 'no live sync', spend: 0 },
      { service: 'CloudWatch', count: 0, health: 'no live sync', spend: 0 },
    ],
    lambdaMetrics: {
      totalInvocations: 0,
      totalErrors: 0,
      daily: [
        { date: '2026-07-01', label: '01 Jul', invocations: 0, errors: 0 },
        { date: '2026-07-02', label: '02 Jul', invocations: 0, errors: 0 },
        { date: '2026-07-03', label: '03 Jul', invocations: 0, errors: 0 },
        { date: '2026-07-04', label: '04 Jul', invocations: 0, errors: 0 },
        { date: '2026-07-05', label: '05 Jul', invocations: 0, errors: 0 },
        { date: '2026-07-06', label: '06 Jul', invocations: 0, errors: 0 },
      ],
    },
  };
}
