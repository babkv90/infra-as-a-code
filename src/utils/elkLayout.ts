import { MarkerType } from 'reactflow';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { AwsEdge, AwsNode } from '../types';
import { buildEdgeCategoryMap, hasSavedPositions, semanticLayerForNode, semanticLayerLabel } from './diagramSemantics';
import { planContainment, type ContainmentPlan } from './deriveContainment';
import { measuredNodeSize as measureNode } from './nodeMetrics';
import { createAbsolutePositionResolver, withTopologySemantics } from './topologySemantics';
import { computeDeterministicOrder, computeTiers } from './topologyOrdering';

// Spacing is relative to the node box: the resource card is wider and taller than the old tile, so
// fixed gaps that looked generous around a 142x92 node read as cramped around a 218x124 one.
const layerSpacing = 150;
const verticalSpacing = 68;
const groupPadding = 42;
// deriveContainment pads every derived box by containerPadding(32) + headerAllowance(36) = 68px on
// top of wherever its children actually sit. If two top-level clusters (a container's contents, or
// an uncontained leaf) were only spaced by the ordinary verticalSpacing, that per-box padding growing
// outward on both sides could close the gap entirely — this spacing is for root-level siblings only,
// generous enough that two boxes can never touch after deriveContainment pads them out.
const topLevelClusterSpacing = 200;
// Matches Canvas.tsx's snapGrid={[24, 24]} — automatic and manual placement need to land on the same
// grid or a node nudged by hand and one placed by layout drift out of alignment with each other.
const positionGrid = 24;

function isManualGroupBox(node: AwsNode): boolean {
  return node.type === 'groupBox' && !node.data.derivedContainer && !node.data.generated;
}

function snapToGrid(value: number): number {
  return Math.round(value / positionGrid) * positionGrid;
}

export async function applyElkLayeredLayout(nodes: AwsNode[], edges: AwsEdge[]): Promise<AwsNode[]> {
  const serviceNodes = nodes.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode');
  const labelNodes = nodes.filter((node) => node.type === 'labelNode');
  if (!serviceNodes.length) return nodes;

  const resolveAbsolute = createAbsolutePositionResolver(nodes);
  const manualBoxes = nodes.filter(isManualGroupBox);
  const manualBoxById = new Map(manualBoxes.map((box) => [box.id, box]));

  // A node manually parented into a hand-drawn boundary has a position meaningful only relative to
  // that boundary, which ELK has no notion of — both must pass through untouched together rather
  // than have ELK silently re-home the child to a fresh absolute position outside it.
  const manuallyContainedIds = new Set(
    serviceNodes.filter((node) => node.parentNode && manualBoxById.has(node.parentNode)).map((node) => node.id),
  );
  // An explicit pin (set on manual drag — see diagramStore's pinNode) is resolved to an absolute
  // position and unparented up front: its previous parent, if any, was a *derived* box this pass is
  // about to discard (derived boxes are rebuilt fresh by deriveContainment afterward), so leaving a
  // stale parent-relative position in place would get misread as absolute once that parent is gone.
  const pinnedIds = new Set(
    serviceNodes.filter((node) => node.data.pinned && !manuallyContainedIds.has(node.id)).map((node) => node.id),
  );
  const fixedIds = new Set([...manuallyContainedIds, ...pinnedIds]);
  const layoutCandidates = serviceNodes.filter((node) => !fixedIds.has(node.id));

  // Every service node is fixed in place (all pinned, or all manually contained) — nothing for ELK
  // to compute, and "pinned nodes stay put" means literally untouched, not re-snapped.
  if (!layoutCandidates.length) return nodes;

  const layoutCandidateIds = new Set(layoutCandidates.map((node) => node.id));
  const categories = buildEdgeCategoryMap(edges, nodes);
  const layoutEdges = edges.filter((edge) => categories.get(edge.id) !== 'containment');

  // Feeding each candidate's current absolute position back in, and switching ELK's layering/
  // crossing-minimization to interactive mode when a prior layout exists, keeps that layout as a
  // strong hint instead of solving from scratch every run — the difference between "adding one
  // resource nudges the diagram" and "adding one resource reshuffles it".
  const isIncrementalPass = hasSavedPositions(layoutCandidates);

  // Deterministic ordering (Fix 3): sort candidates by (lane, tier, sibling key) before they ever
  // reach ELK. semanticLayerForNode still owns the coarse layer id — Architecture View's column
  // boxes are computed from it and that must stay exactly as it was — but ELK's own crossing
  // minimization otherwise uses input array order as an implicit, insertion-order-dependent
  // tie-break, which is the actual source of "same stack, different build order, different diagram".
  // Tier (longest path from the nearest ingress node) refines position *within* a semantic layer, so
  // traffic still reads in one direction without touching which layer a node's column box belongs to.
  const orderedCandidates = computeDeterministicOrder(layoutCandidates, edges, nodes);
  const tiers = computeTiers(layoutCandidates, edges, nodes);

  // Containment-aware clustering: resolve the exact same "what contains what" plan deriveContainment
  // will use a moment later, and lay contained resources out as nested ELK compound nodes instead of
  // a flat graph that has no idea a subnet's ec2 instances are meant to end up sharing its box. Without
  // this, ELK positions every node purely by traffic tier — a vpc's own children can scatter across
  // the diagram and land anywhere relative to another vpc's, or an unrelated leaf, which is what let
  // derived boundaries overlap other content that was never nested inside them.
  const plan = planContainment(nodes, edges);
  const hierarchyContainerIds = new Set([...plan.eligibleContainerIds].filter((id) => layoutCandidateIds.has(id)));
  const containedIds = buildContainedIdSet(plan, hierarchyContainerIds, layoutCandidateIds);
  const topLevelContainerIds = [...hierarchyContainerIds].filter((id) => {
    const parentId = plan.parentContainerId.get(id);
    return !parentId || !hierarchyContainerIds.has(parentId);
  });

  function elkLeafNode(node: AwsNode): ElkNode {
    const size = measuredNodeSize(node);
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      layoutOptions: {
        'elk.layered.layering.layerId': String(semanticLayerForNode(node) * 1000 + (tiers.get(node.id) ?? 0)),
        'elk.portConstraints': 'FIXED_SIDE',
      },
    };
  }

  function elkContainerNode(containerId: string): ElkNode {
    const directChildren = (plan.cardChildrenById.get(containerId) ?? []).filter((node) => layoutCandidateIds.has(node.id));
    const nestedContainerIds = [...hierarchyContainerIds].filter((id) => plan.parentContainerId.get(id) === containerId);
    return {
      id: `elk-cluster-${containerId}`,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        // ELK requires every hierarchy level to declare the same hierarchy-aware processors as the
        // root (crossing minimization and layering strategy) — a mismatch here throws
        // UnsupportedGraphException, which was happening on every real layout run.
        'elk.interactiveLayout': String(isIncrementalPass),
        'elk.layered.crossingMinimization.strategy': isIncrementalPass ? 'INTERACTIVE' : 'LAYER_SWEEP',
        'elk.layered.layering.strategy': isIncrementalPass ? 'INTERACTIVE' : 'NETWORK_SIMPLEX',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.spacing.nodeNode': String(verticalSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
        'elk.padding': '[top=44,left=20,bottom=20,right=20]',
      },
      children: [...directChildren.map(elkLeafNode), ...nestedContainerIds.map(elkContainerNode)],
    };
  }

  const uncontainedCandidates = orderedCandidates.filter((node) => !containedIds.has(node.id));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.interactiveLayout': String(isIncrementalPass),
      'elk.layered.crossingMinimization.strategy': isIncrementalPass ? 'INTERACTIVE' : 'LAYER_SWEEP',
      'elk.layered.layering.strategy': isIncrementalPass ? 'INTERACTIVE' : 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.spacing.nodeNode': String(topLevelClusterSpacing),
      'elk.spacing.componentComponent': String(topLevelClusterSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing + topLevelClusterSpacing - verticalSpacing),
      'elk.spacing.edgeNode': '25',
      'elk.padding': '[top=80,left=80,bottom=80,right=80]',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    },
    children: [...topLevelContainerIds.map(elkContainerNode), ...uncontainedCandidates.map(elkLeafNode)],
    edges: layoutEdges
      .filter((edge) => layoutCandidateIds.has(edge.source) && layoutCandidateIds.has(edge.target) && edge.source !== edge.target)
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };

  const elk = await getElk();
  const result = await elk.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  collectAbsolutePositions(result, 0, 0, layoutCandidateIds, positions);

  // Pinned nodes and manually-drawn boundaries are excluded from ELK's graph entirely (their
  // position is user-locked, not something ELK should ever move) — which also means ELK has zero
  // awareness they exist, and the fresh layout it just computed for everything else can freely land
  // right on top of them. Every manual drag pins the node it moves (see diagramStore's pinNode), so
  // this is not a rare case: touch one node, then add another resource, and the auto-layout that
  // follows had no idea the first one was there. Reserve their combined space and, if the fresh
  // layout actually overlaps it, shift the whole fresh layout clear rather than any single node.
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const reservedRects: Rect[] = [
    ...manualBoxes.map((box) => ({ ...measuredNodeSize(box), x: box.position.x, y: box.position.y })),
    ...[...pinnedIds].map((id) => {
      const absolute = resolveAbsolute(id);
      const size = measuredNodeSize(nodesById.get(id)!);
      return { ...size, x: absolute.x, y: absolute.y };
    }),
  ];
  if (reservedRects.length && positions.size) {
    const reserved = unionRect(reservedRects);
    const fresh = unionRect(
      [...positions.entries()].map(([id, position]) => ({ ...measuredNodeSize(nodesById.get(id)!), ...position })),
    );
    if (rectsIntersect(reserved, fresh)) {
      const shiftY = reserved.y + reserved.height + topLevelClusterSpacing - fresh.y;
      for (const [id, position] of positions) positions.set(id, { x: position.x, y: position.y + shiftY });
    }
  }

  const rawPlacedServices = serviceNodes.map((node) => {
    if (manuallyContainedIds.has(node.id)) return withTopologySemantics(node, manualBoxById.get(node.parentNode!));

    const size = measuredNodeSize(node);
    if (pinnedIds.has(node.id)) {
      // Pinned means untouched: resolve to absolute (its previous parent, if any, was a derived box
      // this pass is discarding) but never round/re-snap — it was already grid-aligned by React
      // Flow's own snapToGrid at drag time, so re-snapping here would just be a silent extra nudge.
      const absolute = resolveAbsolute(node.id);
      return withTopologySemantics({
        ...node,
        parentNode: undefined,
        extent: undefined,
        position: absolute,
        width: size.width,
        height: size.height,
        style: { ...node.style, width: size.width, height: size.height },
      });
    }
    const position = positions.get(node.id) ?? resolveAbsolute(node.id);
    return withTopologySemantics({
      ...node,
      parentNode: undefined,
      extent: undefined,
      position: { x: snapToGrid(position.x), y: snapToGrid(position.y) },
      width: size.width,
      height: size.height,
      style: { ...node.style, width: size.width, height: size.height },
    });
  });
  // Containers and uncontained leaves are now real siblings in one ELK graph (see the hierarchical
  // build above), so ELK's own layered algorithm already guarantees none of them overlap — forcibly
  // snapping every node in a semantic category onto one shared x used to "clean up" a flat layout,
  // but once containment clustering is real, that shared-x scheme has no idea where the clusters
  // ended up and was overwriting perfectly good, non-overlapping positions with colliding ones. ELK's
  // own x (already grid-snapped above) is trusted as-is.
  const placedServices = rawPlacedServices;
  // Semantic-column boxes are a separate, decorative grouping for Architecture View's lane display —
  // a node already inside a real derived (or manual) container shouldn't also be swept into one of
  // these, which is what put an always-visible "Compute" box on top of the actual VPC/Subnet boxes.
  const columnCandidates = placedServices.filter((node) => !manuallyContainedIds.has(node.id) && !containedIds.has(node.id));

  return [...manualBoxes, ...buildSemanticColumnGroups(columnCandidates), ...labelNodes, ...placedServices];
}

type Rect = { x: number; y: number; width: number; height: number };

function unionRect(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

/** Every node id that will end up nested somewhere in the containment hierarchy this pass builds —
 * a container's own card, its resolved leaf children, and (transitively) nested sub-containers. */
function buildContainedIdSet(plan: ContainmentPlan, hierarchyContainerIds: Set<string>, layoutCandidateIds: Set<string>): Set<string> {
  const containedIds = new Set<string>();
  for (const containerId of hierarchyContainerIds) {
    containedIds.add(containerId);
    for (const child of plan.cardChildrenById.get(containerId) ?? []) {
      if (layoutCandidateIds.has(child.id)) containedIds.add(child.id);
    }
  }
  return containedIds;
}

/** Walks ELK's output tree (which mirrors the hierarchical input) accumulating each ancestor's x/y
 * so every real AwsNode id — leaf or a container's own card, at any nesting depth — ends up with an
 * absolute position, the same convention createAbsolutePositionResolver uses for the stored graph. */
function collectAbsolutePositions(
  elkNode: ElkNode,
  originX: number,
  originY: number,
  realNodeIds: Set<string>,
  out: Map<string, { x: number; y: number }>,
): void {
  const absoluteX = originX + (elkNode.x ?? 0);
  const absoluteY = originY + (elkNode.y ?? 0);
  if (realNodeIds.has(elkNode.id)) out.set(elkNode.id, { x: absoluteX, y: absoluteY });
  for (const child of elkNode.children ?? []) {
    collectAbsolutePositions(child, absoluteX, absoluteY, realNodeIds, out);
  }
}

let elkInstancePromise: Promise<ELK> | undefined;

async function getElk(): Promise<ELK> {
  elkInstancePromise ??= createElkInstance();
  return elkInstancePromise;
}

// A layout pass can run for tens to low-hundreds of ms on a large graph — worth keeping off the main
// thread. Falls back to the synchronous in-thread bundle under environments with no global `Worker`
// (SSR, the test runner) rather than relying on elk-api's own worker-unavailable handling, which
// assumes a Node `web-worker` polyfill package this project doesn't install.
async function createElkInstance(): Promise<ELK> {
  if (typeof Worker !== 'undefined') {
    const { default: ElkApi } = await import('elkjs/lib/elk-api.js');
    return new ElkApi({ workerUrl: elkWorkerUrl });
  }
  const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js');
  return new ElkBundled();
}

export function buildSemanticColumnGroups(nodes: AwsNode[]): AwsNode[] {
  const groups: AwsNode[] = [];
  const byLayer = new Map<number, AwsNode[]>();
  for (const node of nodes) {
    const layer = semanticLayerForNode(node);
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), node]);
  }

  for (const [layer, layerNodes] of byLayer.entries()) {
    if (!layerNodes.length) continue;
    const bounds = boundsForNodes(layerNodes, groupPadding);
    groups.push({
      id: `semantic-column-${layer}`,
      type: 'groupBox',
      position: { x: bounds.x, y: bounds.y },
      width: bounds.width,
      height: bounds.height,
      style: { width: bounds.width, height: bounds.height },
      zIndex: -50,
      selectable: true,
      draggable: true,
      data: {
        serviceName: semanticLayerLabel(layer),
        label: semanticLayerLabel(layer),
        region: '',
        arn: '',
        status: 'unknown',
        color: '#64748b',
        icon: 'Columns3',
        subLabel: 'architecture column',
        ports: { inputs: [], outputs: [] },
        config: { generated_group: 'true', semantic_layer: layer },
        groupKind: 'Module',
        generated: true,
        resourceCount: layerNodes.length,
      },
    });
  }

  return groups.sort((left, right) => left.position.x - right.position.x);
}

export function normalizeSemanticEdges(edges: AwsEdge[], nodes: AwsNode[]): AwsEdge[] {
  const categories = buildEdgeCategoryMap(edges, nodes);
  return edges.map((edge) => ({
    ...edge,
    type: 'flowEdge',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      label: edge.data?.label ?? '',
      protocol: edge.data?.protocol ?? '',
      port: edge.data?.port ?? '',
      ...edge.data,
      connectionType: categories.get(edge.id)!,
    },
  }));
}

function measuredNodeSize(node: AwsNode): { width: number; height: number } {
  return measureNode(node);
}

function boundsForNodes(nodes: AwsNode[], padding: number): { x: number; y: number; width: number; height: number } {
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + measuredNodeSize(node).width));
  const maxY = Math.max(...nodes.map((node) => node.position.y + measuredNodeSize(node).height));
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(240, maxX - minX + padding * 2),
    height: Math.max(180, maxY - minY + padding * 2),
  };
}
