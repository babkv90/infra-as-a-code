import type { AwsEdge, AwsNode } from '../types';
import { buildEdgeCategoryMap } from './diagramSemantics';

// Deterministic ordering for auto-layout (Fix 3): three pure properties of the model — lane, tier,
// and a sibling sort key — so the same stack always produces the same diagram regardless of the
// order resources were added on the canvas. None of this touches semanticLayerForNode/
// buildSemanticColumnGroups, which stay exactly as they are for the (separately protected)
// Architecture View lane rendering.

const edgeDnsServiceIds = new Set(['route53', 'cloudfront', 'waf']);
const ingressServiceIds = new Set(['alb', 'apigw', 'lb-listener', 'lb-target-group', 'lb-target-attachment']);
// Services with no meaningful VPC placement at all — the "global services" lane. Deliberately not
// derived from deriveContainment's `externalLane` flag: that flag means "resolved no vpc_id/subnet_id
// edge", which is also true of perfectly regional plumbing this scheme hasn't modelled containment
// for yet (route, route-association, nat, lb-listener, lb-target-attachment) — a different thing
// entirely from "this service doesn't live in a VPC".
const globalServiceIds = new Set([
  's3', 'dynamodb', 'sns', 'sqs', 'eventbridge', 'kinesis',
  'iam', 'kms', 'secrets', 'cognito',
  'cloudwatch', 'xray',
  'ecr', 'codebuild', 'codepipeline',
]);

export const LANE_EDGE_DNS = 1;
export const LANE_INGRESS = 2;
export const LANE_REGION = 3;
export const LANE_GLOBAL_SERVICES = 4;

/** Outside-in band along the flow axis. Checked most-specific first: ALB/API Gateway must land in
 * the ingress lane even though nothing in the model marks them as VPC-contained. */
export function laneForNode(node: AwsNode): number {
  const serviceId = node.data.serviceId ?? '';
  if (edgeDnsServiceIds.has(serviceId)) return LANE_EDGE_DNS;
  if (ingressServiceIds.has(serviceId)) return LANE_INGRESS;
  if (globalServiceIds.has(serviceId)) return LANE_GLOBAL_SERVICES;
  return LANE_REGION;
}

// loadbalancer < compute < cache < database < storage — a static fallback ordering so a stack with
// zero traffic edges still sorts into a sensible left-to-right arrangement instead of a single tie.
const typeRankGroups: Array<{ rank: number; serviceIds: Set<string> }> = [
  { rank: 0, serviceIds: new Set(['alb', 'apigw']) },
  { rank: 1, serviceIds: new Set(['ec2', 'lambda', 'ecs', 'eks', 'beanstalk']) },
  { rank: 2, serviceIds: new Set(['elasticache']) },
  { rank: 3, serviceIds: new Set(['rds', 'docdb', 'docdb-instance', 'dynamodb', 'redshift']) },
  { rank: 4, serviceIds: new Set(['s3', 'efs', 'ebs']) },
];
const defaultTypeRank = 1;

export function staticTypeRank(serviceId: string | undefined): number {
  if (!serviceId) return defaultTypeRank;
  return typeRankGroups.find((group) => group.serviceIds.has(serviceId))?.rank ?? defaultTypeRank;
}

function isIngressNode(node: AwsNode): boolean {
  return laneForNode(node) === LANE_INGRESS;
}

/**
 * Tier: longest path from the nearest ingress node, along 'data-flow' edges only (the category
 * typed ALB/API Gateway -> compute -> cache/database/storage connections fall into by default — see
 * categorizeServicePair). Standard longest-path DAG layering: ingress nodes are tier 0, every other
 * node is 1 + max(tier of its data-flow predecessors), relaxed to a fixed point. A node unreachable
 * from any ingress (an unedged stack, or a disconnected component) falls back to its static type
 * rank instead — chosen so the fallback numbers land in the same range real path lengths would
 * (loadbalancer=0 reads like "at the ingress", compute=1 like "one hop in", and so on).
 */
export function computeTiers(candidates: AwsNode[], edges: AwsEdge[], allNodes: AwsNode[]): Map<string, number> {
  const candidateIds = new Set(candidates.map((node) => node.id));
  const categories = buildEdgeCategoryMap(edges, allNodes);
  const trafficEdges = edges.filter(
    (edge) => categories.get(edge.id) === 'data-flow' && candidateIds.has(edge.source) && candidateIds.has(edge.target) && edge.source !== edge.target,
  );

  const tier = new Map<string, number>();
  for (const node of candidates) tier.set(node.id, isIngressNode(node) ? 0 : -1);

  for (let pass = 0; pass < candidates.length; pass += 1) {
    let changed = false;
    for (const edge of trafficEdges) {
      const sourceTier = tier.get(edge.source) ?? -1;
      if (sourceTier < 0) continue;
      const candidateTier = sourceTier + 1;
      if (candidateTier > (tier.get(edge.target) ?? -1)) {
        tier.set(edge.target, candidateTier);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const node of candidates) {
    if ((tier.get(node.id) ?? -1) < 0) tier.set(node.id, staticTypeRank(node.data.serviceId));
  }

  return tier;
}

/**
 * Whether a subnet is genuinely public: it associates (via a route-association) to a route table
 * that has a route to an Internet Gateway. Derived from the actual routing model, per the brief —
 * never from the subnet's name, and not from the `map_public_ip_on_launch` convenience flag either,
 * which reflects instance-launch behaviour rather than what makes a subnet routable to the internet.
 */
export function isPublicSubnetViaRouting(subnetId: string, nodes: AwsNode[], edges: AwsEdge[]): boolean {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const resolvedBy = (field: string) => edges.filter((edge) => edge.data?.resolvesField === field);

  const routeTableIds = new Set(
    resolvedBy('subnet_id')
      .filter((edge) => edge.source === subnetId && nodesById.get(edge.target)?.data.serviceId === 'route-association')
      .flatMap((association) =>
        resolvedBy('route_table_id')
          .filter((edge) => edge.target === association.target && nodesById.get(edge.source)?.data.serviceId === 'route-table')
          .map((edge) => edge.source),
      ),
  );
  if (!routeTableIds.size) return false;

  return resolvedBy('route_table_id')
    .filter((edge) => routeTableIds.has(edge.source) && nodesById.get(edge.target)?.data.serviceId === 'route')
    .some((routeEdge) => resolvedBy('gateway_id').some((edge) => edge.target === routeEdge.target && nodesById.get(edge.source)?.data.serviceId === 'igw'));
}

/** Nearest ancestor boundary's subnet visibility, or undefined if the node isn't nested in a subnet
 * boundary at all (manual or derived — both stamp `groupKind` the same way). */
function ancestorSubnetVisibility(node: AwsNode, nodesById: Map<string, AwsNode>): 'public' | 'private' | undefined {
  let current: AwsNode | undefined = node;
  const seen = new Set<string>();
  while (current?.parentNode && !seen.has(current.parentNode)) {
    seen.add(current.parentNode);
    const parent = nodesById.get(current.parentNode);
    if (!parent) return undefined;
    if (parent.data.groupKind === 'Public Subnet') return 'public';
    if (parent.data.groupKind === 'Private Subnet') return 'private';
    current = parent;
  }
  return undefined;
}

export type SiblingSortKey = readonly [visibilityRank: number, az: string, typeRank: number, name: string];

/**
 * 1. subnet visibility (public before private, unplaced last) 2. AZ ascending 3. static type rank
 * 4. name lexicographic. Never insertion order — a tuple compared element-by-element is what makes
 * the same set of resources sort identically no matter what order they were added on the canvas.
 */
export function siblingSortKey(node: AwsNode, nodesById: Map<string, AwsNode>): SiblingSortKey {
  const visibility = ancestorSubnetVisibility(node, nodesById);
  const visibilityRank = visibility === 'public' ? 0 : visibility === 'private' ? 1 : 2;
  const az = String(node.data.config?.availability_zone ?? '');
  return [visibilityRank, az, staticTypeRank(node.data.serviceId), node.data.label ?? ''] as const;
}

export function compareSiblingKeys(a: SiblingSortKey, b: SiblingSortKey): number {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Sorts nodes by (lane, tier, sibling key) — the single deterministic order everything else in this
 * module builds toward. Feeding this order into ELK, rather than whatever order the nodes array
 * happens to be in, is what makes layout insertion-order-independent: ELK's own crossing-minimization
 * otherwise uses input order as an implicit tie-break.
 */
export function computeDeterministicOrder(candidates: AwsNode[], edges: AwsEdge[], allNodes: AwsNode[]): AwsNode[] {
  const nodesById = new Map(allNodes.map((node) => [node.id, node]));
  const tiers = computeTiers(candidates, edges, allNodes);
  const keyed = candidates.map((node) => ({
    node,
    lane: laneForNode(node),
    tier: tiers.get(node.id) ?? staticTypeRank(node.data.serviceId),
    sibling: siblingSortKey(node, nodesById),
  }));

  keyed.sort((left, right) => {
    if (left.lane !== right.lane) return left.lane - right.lane;
    if (left.tier !== right.tier) return left.tier - right.tier;
    return compareSiblingKeys(left.sibling, right.sibling);
  });

  return keyed.map((entry) => entry.node);
}
