import type { AwsEdge, AwsNode, DiagramDetailMode, DiagramViewMode, EdgeConnectionType } from '../types';

export type SemanticEdgeCategory = Exclude<EdgeConnectionType, 'data' | 'event'>;

const containmentLabels = ['in vpc', 'placed in', 'inside subnet', 'instance of', 'vpc subnet', 'associate'];
// Every id in src/data/awsServices.ts should appear in exactly one of these sets (or fall into the
// deliberate default below) so any service from the palette lands in a sensible column/layer —
// nothing should end up there just because it was never classified.
const networkServiceIds = new Set(['vpc', 'subnet', 'igw', 'nat', 'route-table', 'route', 'route-association', 'security-group']);
const edgeServiceIds = new Set(['route53', 'cloudfront', 'waf']);
const loadBalancingServiceIds = new Set(['alb', 'apigw', 'lb-listener', 'lb-target-group', 'lb-target-attachment']);
const computeServiceIds = new Set(['ec2', 'lambda', 'ecs', 'eks', 'beanstalk']);
const dataServiceIds = new Set(['rds', 'docdb', 'docdb-instance', 'docdb-subnet-group', 'dynamodb', 'elasticache', 'redshift', 'efs', 'ebs', 's3']);
const supportingServiceIds = new Set(['iam', 'kms', 'secrets', 'cognito', 'sqs', 'sns', 'eventbridge', 'kinesis', 'cloudwatch', 'xray', 'ecr', 'codebuild', 'codepipeline']);

export function semanticEdgeCategory(edge: AwsEdge, nodes: AwsNode[] = []): SemanticEdgeCategory {
  const explicit = edge.data?.connectionType;
  if (explicit && explicit !== 'data' && explicit !== 'event') return explicit;

  const label = (edge.data?.label ?? '').toLowerCase();
  const protocol = (edge.data?.protocol ?? '').toLowerCase();
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const sourceId = source?.data.serviceId ?? '';
  const targetId = target?.data.serviceId ?? '';

  if (containmentLabels.some((term) => label.includes(term))) return 'containment';
  if (protocol === 'terraform' || label === 'reference') return 'dependency';
  if (explicit === 'event') return 'data-flow';
  if (label.includes('deploy') || protocol.includes('terraform') || protocol.includes('github')) return 'deployment';
  if (label.includes('iam') || protocol.includes('iam') || sourceId === 'iam' || sourceId === 'security-group' || targetId === 'security-group' || targetId === 'kms') return 'security';
  if (label.includes('metric') || label.includes('alarm') || sourceId === 'cloudwatch' || targetId === 'cloudwatch') return 'monitoring';
  if (label.includes('route') || label.includes('network') || protocol.includes('vpc') || networkServiceIds.has(sourceId) || networkServiceIds.has(targetId)) return 'network-routing';
  return 'data-flow';
}

export function shouldRenderEdge(edge: AwsEdge, nodes: AwsNode[], activeView: DiagramViewMode, detailMode: DiagramDetailMode): boolean {
  const category = semanticEdgeCategory(edge, nodes);
  // Containment edges (e.g. "in VPC", "placed in") are only redundant with the diagram when the
  // relationship is already implied visually by group-box nesting. Flat templates that never use
  // group boxes have no other way to show that relationship, so hiding these unconditionally left
  // foundational nodes (VPC, subnets, route tables...) with no visible edges at all in every view.
  // Full Topology is the one mode meant to hide nothing, so let it through there.
  if (category === 'containment' && detailMode !== 'full-topology') return false;

  if (detailMode === 'overview' && !['data-flow', 'network-routing'].includes(category)) return false;
  if (detailMode === 'architecture' && ['deployment', 'monitoring'].includes(category)) return false;

  if (activeView === 'application-flow' || activeView === 'topology') return category === 'data-flow' || isEssentialNetworkEdge(edge, nodes);
  if (activeView === 'network') return category === 'network-routing' || category === 'data-flow';
  if (activeView === 'security') return category === 'security';
  if (activeView === 'monitoring') return category === 'monitoring';
  if (activeView === 'deployment') return category === 'deployment' || category === 'dependency';
  if (activeView === 'dependencies') return true;
  return true;
}

export function shouldRenderNode(node: AwsNode, visibleEdges: AwsEdge[], detailMode: DiagramDetailMode): boolean {
  if (node.type === 'groupBox' || node.type === 'labelNode') return detailMode !== 'overview';
  if (detailMode === 'full-topology') return true;

  const serviceId = node.data.serviceId ?? '';
  if (detailMode === 'overview') {
    return edgeServiceIds.has(serviceId) || loadBalancingServiceIds.has(serviceId) || computeServiceIds.has(serviceId) || dataServiceIds.has(serviceId);
  }

  if (supportingServiceIds.has(serviceId)) {
    return visibleEdges.some((edge) => edge.source === node.id || edge.target === node.id);
  }

  return true;
}

export function buildVisibleGraph(
  nodes: AwsNode[],
  edges: AwsEdge[],
  activeView: DiagramViewMode,
  detailMode: DiagramDetailMode,
  isolatedNodeId?: string,
): { nodes: AwsNode[]; edges: AwsEdge[] } {
  const isolatedPath = isolatedNodeId ? buildIsolatedPath(isolatedNodeId, nodes, edges) : undefined;
  const nodeCandidates = nodes
    .filter((node) => !isolatedPath || isolatedPath.nodeIds.has(node.id) || node.id === isolatedNodeId || node.type === 'groupBox')
    .filter((node) => shouldRenderNode(node, edges, detailMode));
  const candidateNodeIds = new Set(nodeCandidates.map((node) => node.id));
  const visibleEdges = edges
    .filter((edge) => shouldRenderEdge(edge, nodes, activeView, detailMode))
    .filter((edge) => !isolatedPath || isolatedPath.edgeIds.has(edge.id))
    .filter((edge) => candidateNodeIds.has(edge.source) && candidateNodeIds.has(edge.target));
  const connectedNodeIds = new Set<string>();
  visibleEdges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });
  const serviceNodes = nodeCandidates.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode');
  const visibleServiceNodes = serviceNodes.filter((node) => connectedNodeIds.has(node.id) || shouldKeepUnconnectedNode(activeView, detailMode));
  const visibleServiceNodeIds = new Set(visibleServiceNodes.map((node) => node.id));
  const visibleNodes = nodeCandidates.filter((node) => {
    if (node.type === 'labelNode') return activeView === 'dependencies';
    if (node.type === 'groupBox') return groupContainsVisibleService(node, visibleServiceNodes);
    return visibleServiceNodeIds.has(node.id);
  });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  return {
    nodes: visibleNodes,
    edges: visibleEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
  };
}

export function semanticLayerForNode(node: AwsNode): number {
  const serviceId = node.data.serviceId ?? '';
  if (node.type === 'groupBox') return 2;
  if (edgeServiceIds.has(serviceId)) return 1;
  if (networkServiceIds.has(serviceId)) return 2;
  if (loadBalancingServiceIds.has(serviceId)) return 3;
  if (computeServiceIds.has(serviceId)) return 4;
  if (dataServiceIds.has(serviceId)) return 5;
  if (supportingServiceIds.has(serviceId)) return 6;
  return 6;
}

export function semanticLayerLabel(layer: number): string {
  return ['Client', 'Edge/CDN', 'Network', 'Load Balancing', 'Compute', 'Data', 'Supporting Services'][layer] ?? 'Supporting Services';
}

export function buildIsolatedPath(nodeId: string, nodes: AwsNode[], edges: AwsEdge[]): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const renderableEdges = edges.filter((edge) => semanticEdgeCategory(edge, nodes) !== 'containment');
  const upstream = traverse(nodeId, renderableEdges, 'upstream');
  const downstream = traverse(nodeId, renderableEdges, 'downstream');
  const nodeIds = new Set([nodeId, ...upstream.nodeIds, ...downstream.nodeIds]);
  const edgeIds = new Set([...upstream.edgeIds, ...downstream.edgeIds]);
  return { nodeIds, edgeIds };
}

export function hasSavedPositions(nodes: AwsNode[]): boolean {
  return nodes.some((node) => Boolean(node.data.visual) || Math.abs(node.position.x) > 1 || Math.abs(node.position.y) > 1);
}

export function essentialNetworkEdgeIds(nodes: AwsNode[], edges: AwsEdge[]): Set<string> {
  return new Set(edges.filter((edge) => isEssentialNetworkEdge(edge, nodes)).map((edge) => edge.id));
}

function isEssentialNetworkEdge(edge: AwsEdge, nodes: AwsNode[]): boolean {
  if (semanticEdgeCategory(edge, nodes) !== 'network-routing') return false;
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const serviceIds = new Set([source?.data.serviceId, target?.data.serviceId]);
  return serviceIds.has('cloudfront') || serviceIds.has('waf') || serviceIds.has('route53') || serviceIds.has('alb') || serviceIds.has('apigw') || serviceIds.has('igw');
}

function shouldKeepUnconnectedNode(activeView: DiagramViewMode, detailMode: DiagramDetailMode): boolean {
  return activeView === 'dependencies' && detailMode === 'full-topology';
}

function groupContainsVisibleService(group: AwsNode, serviceNodes: AwsNode[]): boolean {
  const width = Number(group.width ?? group.style?.width ?? 520);
  const height = Number(group.height ?? group.style?.height ?? 340);
  return serviceNodes.some((node) => {
    if (node.parentNode === group.id) return true;
    const nodeWidth = Number(node.width ?? node.style?.width ?? node.data.visual?.width ?? 142);
    const nodeHeight = Number(node.height ?? node.style?.height ?? node.data.visual?.height ?? 92);
    const centerX = node.position.x + nodeWidth / 2;
    const centerY = node.position.y + nodeHeight / 2;
    return centerX >= group.position.x && centerX <= group.position.x + width && centerY >= group.position.y && centerY <= group.position.y + height;
  });
}

function traverse(startId: string, edges: AwsEdge[], direction: 'upstream' | 'downstream'): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const matches = direction === 'upstream' ? edge.target === current : edge.source === current;
      if (!matches || edgeIds.has(edge.id)) continue;
      edgeIds.add(edge.id);
      const next = direction === 'upstream' ? edge.source : edge.target;
      if (!nodeIds.has(next)) {
        nodeIds.add(next);
        queue.push(next);
      }
    }
  }

  return { nodeIds, edgeIds };
}
