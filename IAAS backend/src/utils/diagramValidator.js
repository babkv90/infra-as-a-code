export function validateDiagram(nodes = [], edges = []) {
  const issues = [];
  const serviceIds = new Set(nodes.map((node) => node?.data?.serviceId).filter(Boolean));
  const serviceNodes = nodes.filter((node) => node?.type === 'awsService' && node?.data?.serviceId);

  if (!serviceNodes.length) {
    issues.push({ severity: 'error', message: 'Diagram must contain at least one AWS service node.' });
  }

  for (const node of serviceNodes) {
    const serviceId = node.data.serviceId;

    if (serviceId === 'lambda' && !serviceIds.has('iam')) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: 'Lambda should be connected to an IAM Role before deployment.',
      });
    }

    if (serviceId === 'rds') {
      const hasPrivateSubnet = nodes.some((candidate) => candidate?.data?.groupKind === 'Private Subnet');
      if (!hasPrivateSubnet) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          message: 'RDS should be placed in a private subnet boundary.',
        });
      }
    }

    if (serviceId === 's3' && !serviceIds.has('kms')) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: 'Consider adding KMS encryption for S3.',
      });
    }
  }

  for (const edge of edges) {
    if (!edge.source || !edge.target) {
      issues.push({ severity: 'error', edgeId: edge.id, message: 'Connection is missing source or target.' });
    }
  }

  return issues;
}
