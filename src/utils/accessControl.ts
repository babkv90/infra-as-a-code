import { awsServices } from '../data/awsServices';
import type { AuthUser } from '../auth/authClient';
import type { AwsNode } from '../types';
import type { ValidationIssue } from './validate';

export type AccessPlan = 'demo' | 'free' | 'pro' | 'enterprise';

const allServiceIds = awsServices.map((service) => service.id);

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

const roleRank: Record<string, number> = {
  viewer: 1,
  devops: 2,
  architect: 3,
  admin: 4,
  owner: 5,
  superadmin: 6,
};

export function getAccessPlan(user?: AuthUser | null): AccessPlan {
  return (user?.workspacePlan || user?.accessPlan || 'free') as AccessPlan;
}

export function isSuperAdmin(user?: AuthUser | null) {
  return user?.role === 'superadmin';
}

// Single source of truth for "unlimited or has a spendable balance" — mirrors the backend's
// utils/credits.js hasCredits() exactly. While true, a user gets full access to every module except
// the Super Admin console (which stays hard role-gated, unaffected by credits).
export function hasCredits(user?: AuthUser | null) {
  return isSuperAdmin(user) || Number(user?.demoCredits ?? 0) > 0;
}

// Mirrors the backend's authorize(roles.DEVOPS) check on every deployment-mutating route
// (IAAS backend/src/routes/deploymentRoutes.js) — rank >= devops. Frontend-only UX gate; the backend
// remains the real enforcement regardless of what this returns.
export function canDeployByRole(user?: AuthUser | null) {
  return (roleRank[user?.role ?? 'viewer'] ?? 0) >= roleRank.devops;
}

export function canUseAiAgent(user?: AuthUser | null) {
  const plan = getAccessPlan(user);
  return hasCredits(user) || plan === 'pro' || plan === 'enterprise';
}

export function canUseApplicationPipelines(user?: AuthUser | null) {
  return hasCredits(user) || getAccessPlan(user) === 'enterprise';
}

// While a user has credits (or is superadmin), they get the full AWS service catalog regardless of
// role or workspace plan — role/plan only decide the fallback tier once credits hit 0.
export function allowedServiceIdsForUser(user?: AuthUser | null) {
  if (hasCredits(user)) return new Set(allServiceIds);

  const plan = getAccessPlan(user);
  if (plan === 'demo' || plan === 'free') return new Set(basicServiceIds);
  if (plan === 'pro') return new Set(intermediateServiceIds);

  const rank = roleRank[user?.role ?? 'viewer'] ?? 0;
  if (rank >= roleRank.architect) return new Set(allServiceIds);
  if (rank >= roleRank.devops) return new Set(intermediateServiceIds);
  return new Set(basicServiceIds);
}

export function serviceAccessTierForUser(user?: AuthUser | null) {
  if (isSuperAdmin(user)) return 'Super admin';
  if (hasCredits(user)) return 'Credits';

  const plan = getAccessPlan(user);
  if (plan === 'demo') return 'Demo basic';
  if (plan === 'free') return 'Free basic';
  if (plan === 'pro') return 'Pro intermediate + AI';
  return 'Enterprise role-based';
}

export function isServiceAllowedForUser(serviceId: string, user?: AuthUser | null) {
  return allowedServiceIdsForUser(user).has(serviceId);
}

export function validateServiceAccess(nodes: AwsNode[], user?: AuthUser | null): ValidationIssue[] {
  const allowed = allowedServiceIdsForUser(user);
  const tier = serviceAccessTierForUser(user);

  return nodes
    .filter((node) => node.type === 'awsService' && node.data.serviceId && !allowed.has(node.data.serviceId))
    .map((node) => ({
      nodeId: node.id,
      severity: 'error' as const,
      message: `${node.data.label || node.data.serviceName} is not available on ${tier}. Upgrade the workspace plan or use an allowed service.`,
    }));
}
