import type { AwsEdge, AwsNode } from '../types';
import type { ValidationIssue } from './validate';

export type DeploymentPlan = {
  name: string;
  resourceCount: number;
  connectionCount: number;
  regions: string[];
  warnings: number;
  blockers: number;
  steps: Array<{
    label: string;
    status: 'ready' | 'warning' | 'blocked';
  }>;
};

export function createDeploymentPlan(nodes: AwsNode[], edges: AwsEdge[], issues: ValidationIssue[]): DeploymentPlan {
  const resources = nodes.filter((node) => node.type === 'awsService' && node.data.serviceId);
  const regions = Array.from(new Set(resources.map((node) => node.data.region).filter(Boolean)));
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const blockers = issues.filter((issue) => issue.severity === 'error').length;

  return {
    name: 'Current visual infrastructure',
    resourceCount: resources.length,
    connectionCount: edges.length,
    regions: regions.length ? regions : ['ap-south-1'],
    warnings,
    blockers,
    steps: [
      { label: 'Validate required resource fields', status: blockers ? 'blocked' : 'ready' },
      { label: 'Validate diagram rules and security', status: blockers ? 'blocked' : warnings ? 'warning' : 'ready' },
      { label: 'Generate Terraform resources', status: resources.length ? 'ready' : 'blocked' },
      { label: 'Create deployment and resource info artifacts', status: resources.length ? 'ready' : 'blocked' },
      { label: 'Run plan approval checks', status: warnings ? 'warning' : 'ready' },
      { label: 'Deploy to AWS account', status: blockers || !resources.length ? 'blocked' : 'ready' },
    ],
  };
}
