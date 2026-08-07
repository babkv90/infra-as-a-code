import { groupStyles, serviceById } from '../data/awsServices';
import type { AwsEdge, AwsNode, GroupKind } from '../types';
import { canContainNode, createAbsolutePositionResolver } from './topologySemantics';
import { measuredNodeSize } from './nodeMetrics';
import { isPublicSubnetViaRouting } from './topologyOrdering';

const containerPadding = 32;
const headerAllowance = 36;
const minBoxWidth = 220;
const minBoxHeight = 140;

// The only two `edgeResolvable` fields (shared/resourceRegistry.json) that describe a resource
// nesting inside a single parent. Plural fields on the same registry (`subnets`, `subnet_ids`) mean
// a resource spans several subnets — that's membership, not containment, and is deliberately not
// treated as a parenting signal here.
const containmentFieldToContainerServiceId: Record<string, string> = {
  vpc_id: 'vpc',
  subnet_id: 'subnet',
};

function derivedBoxId(containerId: string): string {
  return `derived-container-${containerId}`;
}

function isContainerRole(node: AwsNode): boolean {
  return node.type === 'awsService' && serviceById[node.data.serviceId ?? '']?.renderRole === 'container';
}

function isDerivedBoxId(nodeId: string | undefined, nodesById: Map<string, AwsNode>): boolean {
  if (!nodeId) return false;
  return Boolean(nodesById.get(nodeId)?.data.derivedContainer);
}

function groupKindForContainer(node: AwsNode, nodes: AwsNode[], edges: AwsEdge[]): GroupKind {
  if (node.data.serviceId === 'vpc') return 'VPC';
  // Public/private derived from the actual routing model (subnet -> route-association -> route-table
  // -> route -> igw) — not the subnet's name, and not the map_public_ip_on_launch convenience flag
  // either, which reflects instance-launch behaviour rather than what makes the subnet routable.
  return isPublicSubnetViaRouting(node.id, nodes, edges) ? 'Public Subnet' : 'Private Subnet';
}

export type ContainmentPlan = {
  containerIds: Set<string>;
  eligibleContainerIds: Set<string>;
  /** containerId -> [container's own card, ...resolved+canContainNode-validated leaf children].
   * Never includes a nested sub-container — that relationship lives in parentContainerId instead. */
  cardChildrenById: Map<string, AwsNode[]>;
  /** nested containerId -> the containerId it sits inside (box-in-box, e.g. subnet -> vpc). */
  parentContainerId: Map<string, string>;
  groupKindById: Map<string, GroupKind>;
};

/**
 * The "which node belongs inside which vpc/subnet" resolution, factored out so elkLayout.ts can lay
 * candidates out with real containment-aware clustering (a hierarchical ELK graph) instead of a flat
 * one that has no idea two nodes are meant to end up sharing a box. deriveContainment below is the
 * only thing that turns this plan into actual groupBox nodes/positions — this function only answers
 * "what contains what", using the exact same edge-resolution and canContainNode validity rules.
 */
export function planContainment(nodes: AwsNode[], edges: AwsEdge[]): ContainmentPlan {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const containerNodes = nodes.filter(isContainerRole);
  const containerIds = new Set(containerNodes.map((node) => node.id));

  const derivableIds = new Set(
    nodes
      .filter((node) => node.type === 'awsService' && (!node.parentNode || isDerivedBoxId(node.parentNode, nodesById)))
      .map((node) => node.id),
  );

  const resolvedChildren = new Map<string, AwsNode[]>();
  for (const edge of edges) {
    const containerServiceId = edge.data?.resolvesField ? containmentFieldToContainerServiceId[edge.data.resolvesField] : undefined;
    if (!containerServiceId) continue;
    const parent = nodesById.get(edge.source);
    const child = nodesById.get(edge.target);
    if (!parent || !child || parent.id === child.id) continue;
    if (parent.data.serviceId !== containerServiceId) continue;
    if (!derivableIds.has(child.id)) continue;
    const bucket = resolvedChildren.get(parent.id) ?? [];
    bucket.push(child);
    resolvedChildren.set(parent.id, bucket);
  }

  const eligibleContainers = containerNodes.filter((node) => derivableIds.has(node.id));
  const groupKindById = new Map(eligibleContainers.map((node) => [node.id, groupKindForContainer(node, nodes, edges)]));
  const parentContainerId = new Map<string, string>();
  const cardChildrenById = new Map<string, AwsNode[]>();

  for (const container of eligibleContainers) {
    const groupKind = groupKindById.get(container.id)!;
    const boundaryStub: AwsNode = { ...container, type: 'groupBox', data: { ...container.data, groupKind } };
    const cardChildren: AwsNode[] = [container];

    for (const candidate of resolvedChildren.get(container.id) ?? []) {
      if (containerIds.has(candidate.id)) {
        if (derivableIds.has(candidate.id)) parentContainerId.set(candidate.id, container.id);
        continue;
      }
      if (canContainNode(boundaryStub, candidate)) cardChildren.push(candidate);
    }

    cardChildrenById.set(container.id, cardChildren);
  }

  return { containerIds, eligibleContainerIds: new Set(eligibleContainers.map((node) => node.id)), cardChildrenById, parentContainerId, groupKindById };
}

type AbsoluteRect = { x: number; y: number; width: number; height: number };

function boundsForAbsolute(
  children: AwsNode[],
  nestedBoxRects: AbsoluteRect[],
  resolveAbsolute: (nodeId: string) => { x: number; y: number },
): AbsoluteRect {
  const rects: AbsoluteRect[] = [
    ...children.map((child) => {
      const absolute = resolveAbsolute(child.id);
      const size = measuredNodeSize(child);
      return { x: absolute.x, y: absolute.y, width: size.width, height: size.height };
    }),
    ...nestedBoxRects,
  ];
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX - containerPadding,
    y: minY - containerPadding - headerAllowance,
    width: Math.max(minBoxWidth, maxX - minX + containerPadding * 2),
    height: Math.max(minBoxHeight, maxY - minY + containerPadding * 2 + headerAllowance),
  };
}

// Parents must precede children in the returned array (a React Flow requirement) and box-in-box
// nesting (subnet inside vpc) means a box's own parentNode may be another derived box.
function topoOrderContainers(ids: string[], parentOf: Map<string, string>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();

  function visit(id: string, visiting: Set<string>) {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const parentId = parentOf.get(id);
    if (parentId && parentId !== id) visit(parentId, visiting);
    visited.add(id);
    result.push(id);
  }

  ids.forEach((id) => visit(id, new Set()));
  return result;
}

/**
 * Projects `parentNode`/`extent` onto the graph from the relationship model already recorded on
 * edges (`resolvesField`, written by onConnect — see connectionRules.ts) rather than re-resolving
 * containment from scratch. Synthesizes a `groupBox` per container instance (vpc/subnet); the
 * container's own service-node card becomes a child of its own box, same as any other nested
 * resource. Manually-drawn boundaries (`data.derivedContainer` unset) are never read or written —
 * a node already manually parented into one is left exactly as it is.
 */
export function deriveContainment(nodes: AwsNode[], edges: AwsEdge[]): AwsNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const { containerIds, eligibleContainerIds, cardChildrenById, parentContainerId, groupKindById } = planContainment(nodes, edges);
  if (!containerIds.size) return nodes;

  const resolveAbsolute = createAbsolutePositionResolver(nodes);
  const eligibleContainers = nodes.filter((node) => eligibleContainerIds.has(node.id));

  // Box-in-box (subnet inside vpc): a parent container's bounds must include its nested child
  // container's *box* footprint, not just its own direct card children — otherwise the vpc box gets
  // sized only from stragglers like an igw/route-table, and the subnet box (with everything inside
  // it) renders outside the vpc's drawn rectangle despite being correctly parented. Computed
  // child-before-parent so each parent has its children's already-computed bounds to fold in.
  const boundsOrder = [...topoOrderContainers(eligibleContainers.map((node) => node.id), parentContainerId)].reverse();
  const boxAbsolute = new Map<string, AbsoluteRect>();
  const nestedBoxRectsByParentId = new Map<string, AbsoluteRect[]>();
  for (const containerId of boundsOrder) {
    const bounds = boundsForAbsolute(cardChildrenById.get(containerId)!, nestedBoxRectsByParentId.get(containerId) ?? [], resolveAbsolute);
    boxAbsolute.set(containerId, bounds);
    const parentId = parentContainerId.get(containerId);
    if (!parentId) continue;
    const siblingRects = nestedBoxRectsByParentId.get(parentId) ?? [];
    siblingRects.push(bounds);
    nestedBoxRectsByParentId.set(parentId, siblingRects);
  }

  const boxNodes = new Map<string, AwsNode>();
  for (const container of eligibleContainers) {
    const groupKind = groupKindById.get(container.id)!;
    const bounds = boxAbsolute.get(container.id)!;
    const parentId = parentContainerId.get(container.id);
    const parentBounds = parentId ? boxAbsolute.get(parentId) : undefined;
    const position = parentBounds ? { x: bounds.x - parentBounds.x, y: bounds.y - parentBounds.y } : { x: bounds.x, y: bounds.y };

    boxNodes.set(container.id, {
      id: derivedBoxId(container.id),
      type: 'groupBox',
      position,
      parentNode: parentId ? derivedBoxId(parentId) : undefined,
      extent: parentId ? 'parent' : undefined,
      width: bounds.width,
      height: bounds.height,
      style: { width: bounds.width, height: bounds.height },
      zIndex: -1,
      selectable: true,
      draggable: true,
      data: {
        serviceName: groupKind,
        label: container.data.label || container.data.serviceName,
        region: container.data.region,
        arn: '',
        status: 'unknown',
        color: groupStyles[groupKind].color,
        icon: 'BoxSelect',
        subLabel: 'derived boundary',
        ports: { inputs: [], outputs: [] },
        config: {},
        groupKind,
        derivedContainer: true,
      },
    });
  }

  const repositionedCards = new Map<string, AwsNode>();
  for (const container of eligibleContainers) {
    const box = boxNodes.get(container.id)!;
    const bounds = boxAbsolute.get(container.id)!;
    for (const card of cardChildrenById.get(container.id)!) {
      const absolute = resolveAbsolute(card.id);
      repositionedCards.set(card.id, {
        ...card,
        parentNode: box.id,
        extent: 'parent',
        position: { x: absolute.x - bounds.x, y: absolute.y - bounds.y },
      });
    }
  }

  const orderedBoxes = topoOrderContainers(eligibleContainers.map((node) => node.id), parentContainerId).map(
    (id) => boxNodes.get(id)!,
  );

  const rest: AwsNode[] = [];
  for (const node of nodes) {
    if (node.type !== 'awsService') {
      rest.push(node);
      continue;
    }
    const repositioned = repositionedCards.get(node.id);
    if (repositioned) {
      rest.push(repositioned);
      continue;
    }
    if (node.parentNode && isDerivedBoxId(node.parentNode, nodesById)) {
      // Was nested under a derived box on a previous pass; this pass no longer resolves it anywhere
      // (its containment edge was removed/rewired) — release it rather than leave it pinned to a
      // parent it's no longer inside.
      rest.push({ ...node, parentNode: undefined, extent: undefined, position: resolveAbsolute(node.id) });
      continue;
    }
    rest.push(node);
  }

  return [...orderedBoxes, ...rest].map((node) => {
    if (node.type !== 'awsService' || containerIds.has(node.id)) return node;
    const isExternal = !node.parentNode;
    if (isExternal === Boolean(node.data.externalLane)) return node;
    return { ...node, data: { ...node.data, externalLane: isExternal || undefined } };
  });
}
