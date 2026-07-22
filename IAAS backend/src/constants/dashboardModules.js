import { hasRoleAtLeast, roles } from './roles.js';

export const dashboardModules = Object.freeze([
  {
    id: 'overview',
    label: 'Overview',
    description: 'Workspace counts, recent activity, and cloud health summary.',
    minimumRole: roles.VIEWER,
    permissions: ['dashboard:read'],
  },
  {
    id: 'builder',
    label: 'Visual Builder',
    description: 'Create and update AWS architecture diagrams.',
    minimumRole: roles.ARCHITECT,
    permissions: ['diagrams:read', 'diagrams:create', 'diagrams:update', 'terraform:export'],
  },
  {
    id: 'terraform',
    label: 'Terraform Export',
    description: 'Review and export generated Terraform for workspace diagrams.',
    minimumRole: roles.VIEWER,
    permissions: ['diagrams:read', 'terraform:export'],
  },
  {
    id: 'ai-agent',
    label: 'AI Cloud Agent',
    description: 'Ask cloud, cost, security, and architecture questions.',
    minimumRole: roles.VIEWER,
    permissions: ['agent:read', 'agent:chat'],
    badge: 'AI',
  },
  {
    id: 'aws-insights',
    label: 'AWS Insights',
    description: 'View synced AWS inventory, events, billing, and resource health.',
    minimumRole: roles.VIEWER,
    permissions: ['aws:insights:read', 'aws:accounts:read'],
  },
  {
    id: 'deployments',
    label: 'Deployments',
    description: 'Create deployment plans, queue Terraform, and apply infrastructure changes.',
    minimumRole: roles.DEVOPS,
    permissions: ['deployments:read', 'deployments:create', 'deployments:queue', 'deployments:apply'],
  },
  {
    id: 'app-pipeline',
    label: 'Application Pipeline',
    description: 'Generate GitHub push-based CI/CD for applications deployed onto created infrastructure.',
    minimumRole: roles.VIEWER,
    permissions: ['pipelines:read', 'pipelines:create'],
  },
  {
    id: 'security',
    label: 'Security Review',
    description: 'Review IAM, encryption, public exposure, and audit findings.',
    minimumRole: roles.VIEWER,
    permissions: ['aws:insights:read', 'security:read'],
  },
  {
    id: 'cost',
    label: 'Cost Optimizer',
    description: 'View spend, service costs, and optimization recommendations.',
    minimumRole: roles.VIEWER,
    permissions: ['aws:insights:read', 'cost:read'],
  },
  {
    id: 'connect-aws',
    label: 'Connect AWS',
    description: 'Create AWS account connections and manage workspace cloud access.',
    minimumRole: roles.ADMIN,
    permissions: ['aws:accounts:read', 'aws:accounts:create', 'aws:accounts:sync'],
  },
  {
    id: 'super-admin',
    label: 'Super Admin',
    description: 'Manage all users, credits, roles, and platform activity.',
    minimumRole: roles.SUPER_ADMIN,
    permissions: ['superadmin:read', 'superadmin:users:update', 'superadmin:credits:grant'],
  },
]);

export function getDashboardModulesForRole(role) {
  return dashboardModules.filter((module) => hasRoleAtLeast(role, module.minimumRole)).map(serializeDashboardModule);
}

export function getDashboardPermissionsForRole(role) {
  return Array.from(new Set(getDashboardModulesForRole(role).flatMap((module) => module.permissions))).sort();
}

export function serializeDashboardModule(module) {
  return {
    id: module.id,
    label: module.label,
    description: module.description,
    minimumRole: module.minimumRole,
    permissions: module.permissions,
    ...(module.badge ? { badge: module.badge } : {}),
  };
}
