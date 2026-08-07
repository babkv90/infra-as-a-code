import type { AwsEdge, AwsNode, DiagramDetailMode, DiagramViewMode, EdgeConnectionType } from '../types';
import { measuredNodeSize } from './nodeMetrics';

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

export type ServiceIdLookup = Map<string, string>;

export function buildServiceIdLookup(nodes: AwsNode[]): ServiceIdLookup {
  return new Map(nodes.map((node) => [node.id, node.data.serviceId ?? '']));
}

// Categorising an edge only ever needs the *service ids* of its two endpoints, never the node
// objects. Callers that classify many edges at once should build the lookup once and use
// categorizeEdge/buildEdgeCategoryMap — the array-scanning `semanticEdgeCategory` below is O(N) per
// call, which turns into O(E*N) the moment it runs over a whole graph.
export function buildEdgeCategoryMap(edges: AwsEdge[], nodes: AwsNode[]): Map<string, SemanticEdgeCategory> {
  const services = buildServiceIdLookup(nodes);
  return new Map(edges.map((edge) => [edge.id, categorizeEdge(edge, services)]));
}

export function semanticEdgeCategory(edge: AwsEdge, nodes: AwsNode[] = []): SemanticEdgeCategory {
  return categorizeEdge(edge, buildServiceIdLookup(nodes));
}

export function categorizeEdge(edge: AwsEdge, services: ServiceIdLookup): SemanticEdgeCategory {
  const explicit = edge.data?.connectionType;
  if (explicit && explicit !== 'data' && explicit !== 'event') return explicit;

  return categorizeServicePair(services.get(edge.source) ?? '', services.get(edge.target) ?? '', {
    label: edge.data?.label ?? '',
    protocol: edge.data?.protocol ?? '',
    isEvent: explicit === 'event',
  });
}

/**
 * Classify a relationship from its two endpoint services. Split out of categorizeEdge so a
 * connection can be categorised at the moment it is drawn — before an edge object exists — instead
 * of being guessed back out of label/protocol strings afterwards.
 */
export function categorizeServicePair(
  sourceId: string,
  targetId: string,
  hints: { label?: string; protocol?: string; isEvent?: boolean } = {},
): SemanticEdgeCategory {
  const label = (hints.label ?? '').toLowerCase();
  const protocol = (hints.protocol ?? '').toLowerCase();

  if (containmentLabels.some((term) => label.includes(term))) return 'containment';
  if (protocol === 'terraform' || label === 'reference') return 'dependency';
  if (hints.isEvent) return 'data-flow';
  if (label.includes('deploy') || protocol.includes('terraform') || protocol.includes('github')) return 'deployment';
  if (label.includes('iam') || protocol.includes('iam') || sourceId === 'iam' || sourceId === 'security-group' || targetId === 'security-group' || targetId === 'kms') return 'security';
  if (label.includes('metric') || label.includes('alarm') || sourceId === 'cloudwatch' || targetId === 'cloudwatch') return 'monitoring';
  if (label.includes('route') || label.includes('network') || protocol.includes('vpc') || networkServiceIds.has(sourceId) || networkServiceIds.has(targetId)) return 'network-routing';
  return 'data-flow';
}

export function shouldRenderEdge(edge: AwsEdge, nodes: AwsNode[], activeView: DiagramViewMode, detailMode: DiagramDetailMode): boolean {
  const services = buildServiceIdLookup(nodes);
  return shouldRenderEdgeWithCategory(edge, categorizeEdge(edge, services), services, activeView, detailMode);
}

function shouldRenderEdgeWithCategory(
  edge: AwsEdge,
  category: SemanticEdgeCategory,
  services: ServiceIdLookup,
  activeView: DiagramViewMode,
  detailMode: DiagramDetailMode,
): boolean {
  // Containment is nesting now (deriveContainment projects it into parentNode/extent — see Fix 1),
  // so the edge is redundant with the diagram in every view, including Full Topology: drawing both
  // the box and a line for the same relationship is exactly the duplication Fix 1 exists to remove.
  if (category === 'containment') return false;

  if (detailMode === 'overview' && !['data-flow', 'network-routing'].includes(category)) return false;
  if (detailMode === 'architecture' && ['deployment', 'monitoring'].includes(category)) return false;

  if (activeView === 'application-flow' || activeView === 'topology') return category === 'data-flow' || isEssentialNetworkEdgeWithCategory(edge, category, services);
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
  const services = buildServiceIdLookup(nodes);
  const categories = new Map(edges.map((edge) => [edge.id, categorizeEdge(edge, services)]));
  const isolatedPath = isolatedNodeId ? buildIsolatedPathWithCategories(isolatedNodeId, edges, categories) : undefined;
  const nodeCandidates = nodes
    .filter((node) => !isolatedPath || isolatedPath.nodeIds.has(node.id) || node.id === isolatedNodeId || node.type === 'groupBox')
    .filter((node) => shouldRenderNode(node, edges, detailMode));
  const candidateNodeIds = new Set(nodeCandidates.map((node) => node.id));
  const visibleEdges = edges
    .filter((edge) => shouldRenderEdgeWithCategory(edge, categories.get(edge.id)!, services, activeView, detailMode))
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
  return buildIsolatedPathWithCategories(nodeId, edges, buildEdgeCategoryMap(edges, nodes));
}

function buildIsolatedPathWithCategories(
  nodeId: string,
  edges: AwsEdge[],
  categories: Map<string, SemanticEdgeCategory>,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const renderableEdges = edges.filter((edge) => categories.get(edge.id) !== 'containment');
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
  const services = buildServiceIdLookup(nodes);
  return new Set(
    edges.filter((edge) => isEssentialNetworkEdgeWithCategory(edge, categorizeEdge(edge, services), services)).map((edge) => edge.id),
  );
}

function isEssentialNetworkEdgeWithCategory(edge: AwsEdge, category: SemanticEdgeCategory, services: ServiceIdLookup): boolean {
  if (category !== 'network-routing') return false;
  const serviceIds = new Set([services.get(edge.source), services.get(edge.target)]);
  return serviceIds.has('cloudfront') || serviceIds.has('waf') || serviceIds.has('route53') || serviceIds.has('alb') || serviceIds.has('apigw') || serviceIds.has('igw');
}

function shouldKeepUnconnectedNode(activeView: DiagramViewMode, detailMode: DiagramDetailMode): boolean {
  return activeView === 'dependencies' && detailMode === 'full-topology';
}

function groupContainsVisibleService(group: AwsNode, serviceNodes: AwsNode[]): boolean {
  const { width, height } = measuredNodeSize(group);
  return serviceNodes.some((node) => {
    if (node.parentNode === group.id) return true;
    const { width: nodeWidth, height: nodeHeight } = measuredNodeSize(node);
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
