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
  const populatedNodes = nodes.map(populateEc2Ami);

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

function populateEc2Ami(node) {
  if (node?.data?.serviceId !== 'ec2') return node;

  const config = node.data?.config ?? {};
  if (String(config.ami ?? '').trim()) return node;

  return {
    ...node,
    data: {
      ...node.data,
      config: {
        ...config,
        ami: latestAmazonLinux2023Ami,
      },
    },
  };
}
