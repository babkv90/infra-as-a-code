export function getMockAwsInsights() {
  return {
    billing: {
      monthlySpend: 0,
      estimatedSavings: 0,
      trend: [0, 0, 0, 0, 0, 0, 0],
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
  };
}
