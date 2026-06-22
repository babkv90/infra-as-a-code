import { generateTerraform } from './terraformGenerator.js';
import { validateDiagram } from './diagramValidator.js';
import { validateGeneratedTerraform } from './terraformValidator.js';

export function buildDeploymentPlan(diagram) {
  const nodes = diagram.nodes ?? [];
  const edges = diagram.edges ?? [];
  const terraform = generateTerraform(nodes, edges, {
    region: diagram.activeRegion,
    suffix: diagram._id?.toString?.() ?? diagram.name,
  });
  const issues = [...validateDiagram(nodes, edges), ...validateGeneratedTerraform(terraform)];
  const resourceCount = nodes.filter((node) => node?.type === 'awsService' && node?.data?.serviceId).length;
  const blockers = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  return {
    resourceCount,
    connectionCount: edges.length,
    terraform,
    validationIssues: issues,
    plan: {
      blockers,
      warnings,
      steps: [
        { label: 'Validate diagram', status: blockers ? 'blocked' : warnings ? 'warning' : 'ready' },
        { label: 'Generate Terraform', status: resourceCount ? 'ready' : 'blocked' },
        { label: 'Create plan artifact', status: resourceCount ? 'ready' : 'blocked' },
        { label: 'Wait for approval', status: blockers ? 'blocked' : 'ready' },
        { label: 'Deploy to AWS', status: blockers ? 'blocked' : 'ready' },
      ],
    },
  };
}
