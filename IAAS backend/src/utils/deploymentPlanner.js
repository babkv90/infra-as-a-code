import { generateTerraform, lambdaZipUploadIdsFromNodes } from './terraformGenerator.js';
import { validateDiagram } from './diagramValidator.js';
import { validateGeneratedTerraform } from './terraformValidator.js';
import { validateTerraformWithCli } from '../services/terraformCliValidator.js';

export async function buildDeploymentPlan(diagram, { deploymentId, remoteStateBackend = false } = {}) {
  const nodes = diagram.nodes ?? [];
  const edges = diagram.edges ?? [];
  const terraform = generateTerraform(nodes, edges, {
    region: diagram.activeRegion,
    suffix: diagram._id?.toString?.() ?? diagram.name,
    remoteStateBackend,
    deploymentId,
  });
  const structuralIssues = [...validateDiagram(nodes, edges, diagram.activeRegion), ...validateGeneratedTerraform(terraform)];
  const resourceCount = nodes.filter((node) => node?.type === 'awsService' && node?.data?.serviceId).length;

  // Layer 2 of the deployment validation pipeline: real `terraform validate` against the generated
  // HCL. Skipped when the cheaper structural checks above already found a blocking error — no point
  // shelling out to Terraform for a config we already know is going to be rejected, and it keeps
  // "obviously broken diagram" feedback instant instead of waiting on a CLI round trip.
  const alreadyBlocked = structuralIssues.some((issue) => issue.severity === 'error');
  const cliIssues = !alreadyBlocked && resourceCount > 0 ? await validateTerraformWithCli(terraform, lambdaZipUploadIdsFromNodes(nodes)) : [];
  const issues = [...structuralIssues, ...cliIssues];

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
        { label: 'Validate required resource fields', status: alreadyBlocked ? 'blocked' : 'ready' },
        { label: 'Validate diagram rules and security', status: alreadyBlocked ? 'blocked' : warnings ? 'warning' : 'ready' },
        { label: 'Generate Terraform', status: resourceCount ? 'ready' : 'blocked' },
        { label: 'Run terraform validate', status: alreadyBlocked ? 'blocked' : cliIssues.length ? 'blocked' : 'ready' },
        { label: 'Create plan and resource info artifacts', status: resourceCount ? 'ready' : 'blocked' },
        { label: 'Wait for approval', status: blockers ? 'blocked' : 'ready' },
        { label: 'Deploy to AWS', status: blockers ? 'blocked' : 'ready' },
      ],
    },
  };
}
