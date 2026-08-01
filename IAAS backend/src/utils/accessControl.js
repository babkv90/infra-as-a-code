import { roles } from '../constants/roles.js';
import { ApiError } from './ApiError.js';
import { hasCredits } from './credits.js';

const allServiceIds = [
  'ec2',
  'lambda',
  'ecs',
  'eks',
  'beanstalk',
  'vpc',
  'subnet',
  'igw',
  'route-table',
  'route',
  'route-association',
  'security-group',
  'alb',
  'lb-target-group',
  'lb-target-attachment',
  'lb-listener',
  'apigw',
  'cloudfront',
  'route53',
  'waf',
  'nat',
  's3',
  'efs',
  'ebs',
  'rds',
  'docdb-subnet-group',
  'docdb',
  'docdb-instance',
  'dynamodb',
  'elasticache',
  'redshift',
  'sqs',
  'sns',
  'eventbridge',
  'kinesis',
  'iam',
  'secrets',
  'kms',
  'cognito',
  'codepipeline',
  'codebuild',
  'ecr',
  'cloudwatch',
  'xray',
];

const basicServiceIds = [
  'ec2',
  'vpc',
  'subnet',
  'igw',
  'route-table',
  'route',
  'route-association',
  'security-group',
  's3',
  'cloudwatch',
];

const intermediateServiceIds = [
  ...basicServiceIds,
  'lambda',
  'apigw',
  'rds',
  'dynamodb',
  'sqs',
  'sns',
  'eventbridge',
  'efs',
  'alb',
  'lb-target-group',
  'lb-listener',
  'ecr',
  'ecs',
  'iam',
  'secrets',
  'kms',
];

const accessRank = {
  [roles.VIEWER]: 1,
  [roles.DEVOPS]: 2,
  [roles.ARCHITECT]: 3,
  [roles.ADMIN]: 4,
  [roles.OWNER]: 5,
  [roles.SUPER_ADMIN]: 6,
};

export function normalizeAccessPlan(workspace) {
  return workspace?.plan || 'free';
}

export function canUseAiAgent(user, workspace) {
  const plan = normalizeAccessPlan(workspace);
  return hasCredits(user) || plan === 'pro' || plan === 'enterprise';
}

export function canUseApplicationPipelines(user, workspace) {
  return hasCredits(user) || normalizeAccessPlan(workspace) === 'enterprise';
}

// While a user has credits (or is superadmin), they get the full AWS service catalog regardless of
// role or workspace plan — role/plan only decide the fallback tier once credits hit 0.
export function allowedServiceIdsForAccess(user, workspace) {
  if (hasCredits(user)) return new Set(allServiceIds);

  const plan = normalizeAccessPlan(workspace);
  if (plan === 'demo' || plan === 'free') return new Set(basicServiceIds);
  if (plan === 'pro') return new Set(intermediateServiceIds);

  const rank = accessRank[user?.role] ?? 0;
  if (rank >= accessRank[roles.ARCHITECT]) return new Set(allServiceIds);
  if (rank >= accessRank[roles.DEVOPS]) return new Set(intermediateServiceIds);
  return new Set(basicServiceIds);
}

export function serviceAccessTier(user, workspace) {
  if (user?.role === roles.SUPER_ADMIN) return 'Super admin';
  if (hasCredits(user)) return 'Credits';
  const plan = normalizeAccessPlan(workspace);
  if (plan === 'demo') return 'Demo basic';
  if (plan === 'free') return 'Free basic';
  if (plan === 'pro') return 'Pro intermediate + AI';
  return 'Enterprise role-based';
}

export function assertDiagramServiceAccess({ user, workspace, nodes = [] }) {
  const allowed = allowedServiceIdsForAccess(user, workspace);
  const blocked = nodes
    .filter((node) => node?.type === 'awsService' && node?.data?.serviceId && !allowed.has(node.data.serviceId))
    .map((node) => node.data?.label ?? node.data?.serviceName ?? node.data?.serviceId);

  if (blocked.length) {
    throw new ApiError(403, `${serviceAccessTier(user, workspace)} cannot deploy these services: ${blocked.join(', ')}`);
  }
}
