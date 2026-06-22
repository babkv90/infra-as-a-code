import type { AwsEdge, AwsNode } from '../types';

export type ValidationIssue = {
  nodeId?: string;
  edgeId?: string;
  severity: 'warning' | 'error';
  message: string;
};

export function validateDiagram(nodes: AwsNode[], edges: AwsEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const serviceIds = new Set(nodes.map((node) => node.data.serviceId));
  const connectedPairs = edges.map((edge) => [nodes.find((node) => node.id === edge.source), nodes.find((node) => node.id === edge.target)] as const);

  for (const node of nodes) {
    if (node.type === 'groupBox') continue;

    if (node.data.serviceId === 'rds') {
      const hasPrivateSubnet = nodes.some((candidate) => candidate.type === 'groupBox' && candidate.data.groupKind === 'Private Subnet');
      if (!hasPrivateSubnet) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'RDS should be placed in a private subnet boundary.' });
      }
    }

    if (node.data.serviceId === 'lambda' && !connectedPairs.some(([source, target]) => [source?.data.serviceId, target?.data.serviceId].includes('iam'))) {
      issues.push({ nodeId: node.id, severity: 'warning', message: 'Lambda has no visible IAM Role connection.' });
    }

    if (node.data.serviceId === 's3' && !serviceIds.has('kms')) {
      issues.push({ nodeId: node.id, severity: 'warning', message: 'Consider adding KMS encryption for S3.' });
    }

    if (['ec2', 'ecs', 'eks'].includes(node.data.serviceId ?? '') && !serviceIds.has('cloudwatch')) {
      issues.push({ nodeId: node.id, severity: 'warning', message: 'Compute workloads should emit metrics/logs to CloudWatch.' });
    }

    for (const binding of node.data.bindings ?? []) {
      if (!binding.targetPath.trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Binding target is missing.' });
      }

      if (binding.source.kind === 'secret') {
        const sourceNode = nodes.find((candidate) => candidate.id === binding.source.id);
        if (!sourceNode) {
          issues.push({ nodeId: node.id, severity: 'error', message: `Secret binding "${binding.targetPath}" points to a missing Secrets Manager node.` });
        } else if (sourceNode.data.serviceId !== 'secrets') {
          issues.push({ nodeId: node.id, severity: 'warning', message: `Secret binding "${binding.targetPath}" should point to a Secrets Manager node.` });
        }

        const hasIamConnection = connectedPairs.some(([source, target]) => {
          const ids = [source?.id, target?.id];
          const serviceNames = [source?.data.serviceId, target?.data.serviceId];
          return ids.includes(node.id) && serviceNames.includes('iam');
        });
        if (!hasIamConnection && !serviceIds.has('iam')) {
          issues.push({ nodeId: node.id, severity: 'warning', message: `Node consumes secret "${binding.targetPath}" but no IAM role is modeled for read access.` });
        }
      }

      if (binding.sensitive && binding.source.kind === 'local') {
        issues.push({ nodeId: node.id, severity: 'warning', message: `Sensitive binding "${binding.targetPath}" should use Secrets Manager, SSM SecureString, or a sensitive variable instead of a local.` });
      }

      if (binding.sensitive && /password|secret|token|key/i.test(String(node.data.config[binding.targetPath] ?? ''))) {
        issues.push({ nodeId: node.id, severity: 'error', message: `Sensitive binding "${binding.targetPath}" appears to have a raw value in node config.` });
      }
    }
  }

  for (const edge of edges) {
    if (edge.data?.connectionType === 'security' && !edge.data.port) {
      issues.push({ edgeId: edge.id, severity: 'warning', message: 'Security connection should declare a port.' });
    }
  }

  return issues;
}
