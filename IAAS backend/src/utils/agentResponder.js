import { getMockAwsInsights } from './awsInsightsMock.js';

export function answerCloudQuestion(question) {
  const normalized = question.toLowerCase();
  const insights = getMockAwsInsights();

  if (normalized.includes('bill') || normalized.includes('cost') || normalized.includes('spend')) {
    return `Your monthly AWS spend is $${insights.billing.monthlySpend.toFixed(
      2,
    )}. No live AWS billing sync is available yet, so I cannot identify real service drivers until an AWS account is connected.`;
  }

  if (normalized.includes('security') || normalized.includes('iam') || normalized.includes('risk')) {
    return 'I found 0 security warnings because no live AWS account has been synced yet. Connect an AWS account to run IAM, S3, encryption, and CloudWatch checks.';
  }

  if (normalized.includes('lambda') || normalized.includes('failing') || normalized.includes('error')) {
    return `I found ${insights.resources.failedInvocations} failed Lambda invocations. Connect AWS to load real Lambda and CloudWatch error data.`;
  }

  if (normalized.includes('unused') || normalized.includes('idle')) {
    return `I found ${insights.resources.idleResources} idle or unused resources. Connect AWS to discover real idle EC2, EBS, RDS, and log-retention opportunities.`;
  }

  return 'I can help with billing, resource inventory, Lambda health, IAM risk, Terraform drift, and architecture optimization. Ask a specific AWS operations question to continue.';
}
