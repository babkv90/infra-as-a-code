import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { latestAmazonLinux2023Ami } from '../utils/terraformGenerator.js';

export const receiveTerraformPayloadSchema = z.object({
  body: z.object({
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
    activeRegion: z.string().optional(),
  }),
});

export const receiveTerraformPayload = asyncHandler(async (req, res) => {
  const { nodes, edges, activeRegion } = req.validated.body;
  const populatedNodes = nodes.map((node) => populateEc2Config(node, nodes, edges));

  res.json({
    success: true,
    message: 'terraform payload received',
    data: {
      nodes: populatedNodes,
      edges,
      activeRegion,
    },
  });
});

function populateEc2Config(node, nodes, edges) {
  if (node?.data?.serviceId !== 'ec2') return node;

  const config = node.data?.config ?? {};
  const nextConfig = { ...config };
  const securityGroupIds = securityGroupIdsForEc2(node, nodes, edges);

  if (!String(nextConfig.ami ?? '').trim()) {
    nextConfig.ami = latestAmazonLinux2023Ami;
  }

  if (!String(nextConfig.vpc_security_group_ids ?? '').trim() && securityGroupIds.length) {
    nextConfig.vpc_security_group_ids = `[${securityGroupIds.join(', ')}]`;
  }

  if (nextConfig === config || shallowEqual(config, nextConfig)) return node;

  return {
    ...node,
    data: {
      ...node.data,
      config: nextConfig,
    },
  };
}

function securityGroupIdsForEc2(node, nodes, edges) {
  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  const refs = [];

  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;

    const otherId = edge.source === node.id ? edge.target : edge.source;
    const otherNode = nodeById[otherId];
    if (otherNode?.data?.serviceId !== 'security-group') continue;

    refs.push(`aws_security_group.${sanitizeName(otherNode.data?.label ?? otherNode.data?.serviceName ?? otherNode.id)}.id`);
  }

  return Array.from(new Set(refs));
}

function shallowEqual(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Array.from(keys).every((key) => left[key] === right[key]);
}

function sanitizeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'resource';
}
