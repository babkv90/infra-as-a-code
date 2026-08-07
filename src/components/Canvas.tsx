import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus, X } from 'lucide-react';
import ReactFlow, {
  type Connection,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  MarkerType,
  MiniMap,
  Panel,
  SelectionMode,
  useNodesInitialized,
  useReactFlow,
  useViewport,
  type NodeTypes,
  type EdgeTypes,
} from 'reactflow';
import FlowEdge from './edges/FlowEdge';
import AwsServiceNode from './nodes/AwsServiceNode';
import GroupBoxNode from './nodes/GroupBoxNode';
import LabelNode from './nodes/LabelNode';
import { EdgeGeometryContext, LodBandContext, RelationshipBadgeContext, lodBandForZoom } from './canvasGraphContext';
import { useDiagramStore } from '../store/diagramStore';
import type { AwsEdge, AwsNode } from '../types';
import { getStoredUser } from '../auth/authClient';
import { isServiceAllowedForUser } from '../utils/accessControl';
import { buildHandleId, getLayerDerivedConnectionSides, getOptimalConnectionSides, readHandlePort } from '../utils/connectionRouting';
import { buildEdgeCategoryMap, buildVisibleGraph, semanticLayerForNode, type SemanticEdgeCategory } from '../utils/diagramSemantics';
import { evaluateConnection } from '../utils/connectionRules';
import { buildObstacleRects, buildRelationshipBadgeCounts } from '../utils/graphIndex';
import { measuredNodeSize } from '../utils/nodeMetrics';
import { canContainNode, createAbsolutePositionResolver } from '../utils/topologySemantics';
import { computeTiers } from '../utils/topologyOrdering';

const nodeTypes: NodeTypes = {
  awsService: AwsServiceNode,
  groupBox: GroupBoxNode,
  labelNode: LabelNode,
};

const edgeTypes: EdgeTypes = {
  flowEdge: FlowEdge,
};

type EdgeBundleSlot = { index: number; size: number };

type ConnectTargetStatus = 'typed' | 'reversed' | 'reference';

type ConnectOrigin = { nodeId: string; serviceId?: string; label: string };

type BoundaryCandidate = { id: string; x: number; y: number; width: number; height: number; area: number; accepts: boolean; kind: string };

type BoundaryDropTarget = { groupId: string; accepted: boolean; message: string };

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

/**
 * Only genuinely modal surfaces should swallow Delete. The docked inspector used to count here,
 * which was fine while it opened on double-click — now that a single click opens it, treating it as
 * modal would mean Delete never reached the canvas again. Typing inside it is already handled by
 * isTextInputTarget.
 */
function isModalSurfaceOpen(): boolean {
  return Boolean(document.querySelector('.modal-backdrop, .diagram-delete-dialog-backdrop, .context-menu, .bx-palette-backdrop'));
}

function Canvas() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastViewportFitVersionRef = useRef<number | null>(null);
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const { zoom } = useViewport();
  // Throttled to the three LOD bands (not the raw zoom) so this only changes identity — and only
  // triggers a re-render of consuming cards — when a band boundary is actually crossed.
  const lodBand = useMemo(() => lodBandForZoom(zoom), [zoom]);
  const [connectOrigin, setConnectOrigin] = useState<ConnectOrigin | null>(null);
  const [connectHoverNodeId, setConnectHoverNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BoundaryDropTarget | null>(null);
  // Boundary rects are snapshotted at drag start — boundaries don't move while another node is being
  // dragged — so the per-frame cost is a point-in-rect test over a handful of them, with no
  // allocation and no re-render unless the verdict actually changes.
  const boundarySnapshotRef = useRef<BoundaryCandidate[]>([]);
  const dropTargetRef = useRef<BoundaryDropTarget | null>(null);

  // Individual selectors rather than a whole-store destructure: the previous `useDiagramStore()`
  // call subscribed Canvas to every field in the store, so it re-rendered (and re-derived the whole
  // visible graph) on any state change at all.
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const mode = useDiagramStore((state) => state.mode);
  const activeView = useDiagramStore((state) => state.activeView);
  const detailMode = useDiagramStore((state) => state.detailMode);
  const isolatedNodeId = useDiagramStore((state) => state.isolatedNodeId);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const architectureViewMode = useDiagramStore((state) => state.architectureViewMode);
  const focusNodeIds = useDiagramStore((state) => state.focusNodeIds);
  const fitViewVersion = useDiagramStore((state) => state.fitViewVersion);
  const onNodesChange = useDiagramStore((state) => state.onNodesChange);
  const onEdgesChange = useDiagramStore((state) => state.onEdgesChange);
  const onConnect = useDiagramStore((state) => state.onConnect);
  const onEdgeUpdate = useDiagramStore((state) => state.onEdgeUpdate);
  const setSelection = useDiagramStore((state) => state.setSelection);
  const setFocusNodeIds = useDiagramStore((state) => state.setFocusNodeIds);
  const openInspector = useDiagramStore((state) => state.openInspector);
  const closeInspector = useDiagramStore((state) => state.closeInspector);
  const addServiceNode = useDiagramStore((state) => state.addServiceNode);
  const addGroupNode = useDiagramStore((state) => state.addGroupNode);
  const addLabelNode = useDiagramStore((state) => state.addLabelNode);
  const deleteSelection = useDiagramStore((state) => state.deleteSelection);
  const copySelection = useDiagramStore((state) => state.copySelection);
  const pasteClipboard = useDiagramStore((state) => state.pasteClipboard);
  const selectAll = useDiagramStore((state) => state.selectAll);
  const undo = useDiagramStore((state) => state.undo);
  const redo = useDiagramStore((state) => state.redo);
  const checkpoint = useDiagramStore((state) => state.checkpoint);
  const attachNodeToContainingGroup = useDiagramStore((state) => state.attachNodeToContainingGroup);
  const pinNode = useDiagramStore((state) => state.pinNode);
  const lastConnection = useDiagramStore((state) => state.lastConnection);
  const dismissLastConnection = useDiagramStore((state) => state.dismissLastConnection);

  // The receipt is a confirmation, not a log — it clears itself.
  useEffect(() => {
    if (!lastConnection) return;
    const timer = window.setTimeout(dismissLastConnection, 6000);
    return () => window.clearTimeout(timer);
  }, [dismissLastConnection, lastConnection]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const serviceId = event.dataTransfer.getData('application/aws-service');
      if (!serviceId) return;
      if (!isServiceAllowedForUser(serviceId, getStoredUser())) return;
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addServiceNode(serviceId, position);
    },
    [addServiceNode, reactFlow],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClipboard();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if (event.key === 'Delete') {
        if (isModalSurfaceOpen()) return;
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'Backspace' && wrapperRef.current?.contains(document.activeElement)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelection, deleteSelection, pasteClipboard, redo, selectAll, undo]);

  const minimapColor = useCallback((node: { type?: string; data?: { color?: string } }) => {
    if (node.type === 'groupBox') return '#94a3b8';
    if (node.type === 'labelNode') return '#64748b';
    return node.data?.color ?? '#2563eb';
  }, []);

  const defaultEdgeOptions = useMemo(() => ({ type: 'flowEdge', markerEnd: { type: MarkerType.ArrowClosed } }), []);

  // Edge categorisation and relationship badges depend on which services are on the canvas, never on
  // where they sit. Keying the memos below on this signature instead of `nodes` keeps their results
  // referentially stable while a node is being dragged.
  const serviceSignature = useMemo(() => nodes.map((node) => `${node.id}:${node.data.serviceId ?? ''}`).join('|'), [nodes]);

  const bindingEdges = useMemo<AwsEdge[]>(
    () =>
      nodes.flatMap((node) =>
        (node.data.bindings ?? [])
          .filter((binding) => nodes.some((sourceNode) => sourceNode.id === binding.source.id))
          .map((binding) => ({
            id: `binding-${binding.id}`,
            source: binding.source.id,
            target: node.id,
            type: 'flowEdge',
            markerEnd: { type: MarkerType.ArrowClosed },
            selectable: false,
            data: {
              label: binding.targetKind === 'env' ? `env:${binding.targetPath}` : binding.targetPath,
              connectionType: 'security' as const,
              protocol: binding.source.kind === 'secret' ? 'Secrets Manager' : binding.source.kind,
              port: '',
            },
            style: { strokeDasharray: '5 5', opacity: 0.64 },
          })),
      ),
    [nodes],
  );

  const graphEdges = useMemo(() => [...edges, ...bindingEdges], [bindingEdges, edges]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on serviceSignature, not `nodes`, on purpose (see above).
  const relationshipBadges = useMemo(() => buildRelationshipBadgeCounts(nodes, graphEdges), [serviceSignature, graphEdges]);

  // Stable identity, so consuming this costs no re-renders. Obstacle rects are only pulled by the
  // one edge currently showing a label, and are read at that moment rather than precomputed.
  const edgeGeometry = useMemo(() => ({ getObstacles: () => buildObstacleRects(reactFlow.getNodes()) }), [reactFlow]);

  // buildVisibleGraph's node/edge filtering depends on identity, containment (parentNode) and
  // service type — never on where anything currently sits — so keying its memo on `nodes` directly
  // meant it re-ran over the full graph on every drag pointer-tick (nodes changes every tick).
  const visibilitySignature = useMemo(
    () => nodes.map((node) => `${node.id}:${node.type ?? ''}:${node.parentNode ?? ''}:${node.data.serviceId ?? ''}`).join('|'),
    [nodes],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on visibilitySignature, not `nodes`, on purpose (see above).
  const visibleGraph = useMemo(
    () => buildVisibleGraph(nodes, graphEdges, activeView, detailMode, isolatedNodeId),
    [activeView, detailMode, graphEdges, isolatedNodeId, visibilitySignature],
  );
  const visibleEdges = visibleGraph.edges;
  // applyElkLayeredLayout always emits "semantic column" boxes (Client/Edge-CDN/Network/Compute/...)
  // alongside whatever derived VPC/Subnet containers deriveContainment produces — two independent,
  // uncoordinated box systems drawing rectangles around overlapping sets of nodes. GroupBoxNode only
  // gives them their intended lane treatment in Architecture View; outside it they fell through to
  // the normal box renderer and rendered as a second, competing set of always-visible boundaries.
  // They carry no parentNode link to anything (buildSemanticColumnGroups never sets one), so hiding
  // them here is purely a visibility change — nothing is structurally attached to them.
  const visibleNodes = useMemo(
    () => (architectureViewMode ? visibleGraph.nodes : visibleGraph.nodes.filter((node) => node.data.config?.generated_group !== 'true')),
    [architectureViewMode, visibleGraph.nodes],
  );

  // A plain, undeclared connection ("dependency ordering only" — see buildEdgeData) is the noisiest
  // edge category and rarely worth seeing by default; selecting either endpoint reveals it, matching
  // the existing focus/select affordances rather than adding a new one.
  const selectedNodeIds = useMemo(() => new Set(nodes.filter((node) => node.selected).map((node) => node.id)), [nodes]);
  const referenceRevealedEdges = useMemo(
    () => visibleEdges.filter((edge) => edge.data?.relationshipKind !== 'reference' || selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)),
    [selectedNodeIds, visibleEdges],
  );
  // Multiple edges between the exact same pair (typically re-imported/duplicated diagrams) collapse
  // into one line with a count badge rather than drawing the same connection N times.
  const mergedVisibleEdges = useMemo(() => mergeParallelEdges(referenceRevealedEdges), [referenceRevealedEdges]);

  const routingNodeById = useMemo(() => {
    const resolveAbsolutePosition = createAbsolutePositionResolver(visibleNodes);
    return new Map(
      visibleNodes.map((node) => [
        node.id,
        node.parentNode ? { ...node, position: resolveAbsolutePosition(node.id) } : node,
      ]),
    );
  }, [visibleNodes]);

  // Handle sides should come from where a node sits in the deterministic layered layout (Fix 2/3),
  // not raw geometry, which shifts attachment points on every drag. semanticLayerForNode is a pure
  // function of service id (untouched — Architecture View's own column boxes depend on it), refined
  // by tier (longest path from the nearest ingress node) for position within that layer.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on serviceSignature, not `nodes`.
  const layerById = useMemo(() => {
    const serviceNodes = nodes.filter((node) => node.type === 'awsService');
    const tiers = computeTiers(serviceNodes, graphEdges, nodes);
    return new Map(serviceNodes.map((node) => [node.id, semanticLayerForNode(node) * 1000 + (tiers.get(node.id) ?? 0)]));
  }, [serviceSignature, graphEdges]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on serviceSignature, not `nodes`, on purpose (see above).
  const edgeCategories = useMemo(() => buildEdgeCategoryMap(mergedVisibleEdges, nodes), [mergedVisibleEdges, serviceSignature]);

  // Bundle slots let parallel edges into the same target fan out instead of stacking. Computed once
  // per graph here; it used to be re-derived inside every edge, re-categorising every peer edge each
  // time, which made the whole pass roughly O(E squared * N).
  const edgeBundles = useMemo(() => {
    const slotsByKey = new Map<string, string[]>();
    for (const edge of mergedVisibleEdges) {
      const key = `${edge.target}|${edgeCategories.get(edge.id) ?? 'data-flow'}`;
      const slot = slotsByKey.get(key);
      if (slot) slot.push(edge.id);
      else slotsByKey.set(key, [edge.id]);
    }

    const bundles = new Map<string, EdgeBundleSlot>();
    for (const edgeIds of slotsByKey.values()) {
      edgeIds.forEach((edgeId, index) => bundles.set(edgeId, { index, size: edgeIds.length }));
    }
    return bundles;
  }, [edgeCategories, mergedVisibleEdges]);

  const routedVisibleEdges = useMemo(
    () =>
      mergedVisibleEdges.map((edge) =>
        withSemanticEdgeHandles(edge, routingNodeById, layerById, edgeCategories.get(edge.id) ?? 'data-flow', edgeBundles.get(edge.id)),
      ),
    [edgeBundles, edgeCategories, layerById, mergedVisibleEdges, routingNodeById],
  );

  useEffect(() => {
    if (!visibleNodes.length || !nodesInitialized) return;
    if (lastViewportFitVersionRef.current === fitViewVersion) return;
    lastViewportFitVersionRef.current = fitViewVersion;
    // Large graphs are exactly the ones that need fitting — a 76-resource stack opening mid-canvas at
    // whatever the last viewport happened to be is the opposite of what a reader needs. One fit, not
    // two: the old settled-fit timeout fired a second animation 180ms into the first.
    const frame = requestAnimationFrame(() => reactFlow.fitView({ padding: 0.12, duration: 360, maxZoom: 1.1 }));
    return () => cancelAnimationFrame(frame);
  }, [fitViewVersion, nodesInitialized, reactFlow, visibleNodes.length]);

  const focusedNodeSet = useMemo(() => new Set(focusNodeIds), [focusNodeIds]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on serviceSignature, not `nodes`.
  const serviceIdByNodeId = useMemo(() => new Map(nodes.map((node) => [node.id, node.data.serviceId])), [serviceSignature]);

  // A connection is only offered where the model says something real happens. Drawing a modelled
  // relationship backwards is rejected rather than silently accepted — under the old direction-blind
  // generator lookup, a reversed arrow produced identical Terraform, which is exactly why users read
  // connections as decoration.
  const isValidConnection = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return false;
      const verdict = evaluateConnection(serviceIdByNodeId.get(connection.source), serviceIdByNodeId.get(connection.target));
      return verdict.status === 'typed' || verdict.status === 'reference';
    },
    [serviceIdByNodeId],
  );

  const connectTargets = useMemo(() => {
    if (!connectOrigin) return null;
    const statuses = new Map<string, ConnectTargetStatus>();
    for (const node of visibleNodes) {
      if (node.type !== 'awsService' || node.id === connectOrigin.nodeId) continue;
      const verdict = evaluateConnection(connectOrigin.serviceId, node.data.serviceId);
      if (verdict.status === 'blocked') continue;
      statuses.set(node.id, verdict.status);
    }
    return statuses;
  }, [connectOrigin, visibleNodes]);

  const connectHint = useMemo(() => {
    if (!connectOrigin) return undefined;
    const hoverNode = connectHoverNodeId ? visibleNodes.find((node) => node.id === connectHoverNodeId) : undefined;

    if (hoverNode && hoverNode.id !== connectOrigin.nodeId) {
      const targetLabel = hoverNode.data.label || hoverNode.data.serviceName;
      const verdict = evaluateConnection(connectOrigin.serviceId, hoverNode.data.serviceId);
      if (verdict.status === 'typed') return `${connectOrigin.label} → ${targetLabel} · ${verdict.rule.summary}`;
      if (verdict.status === 'reversed') return `Draw this the other way — ${targetLabel} → ${connectOrigin.label} ${verdict.rule.summary}`;
      return `${connectOrigin.label} → ${targetLabel} · dependency reference only`;
    }

    const typedCount = connectTargets ? Array.from(connectTargets.values()).filter((status) => status === 'typed').length : 0;
    return typedCount
      ? `Connecting from ${connectOrigin.label} · ${typedCount} modelled target${typedCount === 1 ? '' : 's'} highlighted`
      : `Connecting from ${connectOrigin.label} · no modelled targets on this canvas`;
  }, [connectHoverNodeId, connectOrigin, connectTargets, visibleNodes]);

  const presentationNodes = useMemo(() => {
    if (!focusedNodeSet.size && !connectTargets && !dropTarget) return visibleNodes;
    return visibleNodes.map((node) => {
      const classes = [node.className ?? ''];
      if (focusedNodeSet.size) classes.push(focusedNodeSet.has(node.id) ? 'focus-hit' : 'focus-dim');
      if (connectTargets) {
        if (node.id === connectOrigin?.nodeId) classes.push('connect-origin');
        else classes.push(`connect-${connectTargets.get(node.id) ?? 'none'}`);
      }
      if (dropTarget && node.id === dropTarget.groupId) {
        classes.push(dropTarget.accepted ? 'boundary-accept' : 'boundary-reject');
      }
      return { ...node, className: classes.filter(Boolean).join(' ') };
    });
  }, [connectOrigin, connectTargets, dropTarget, focusedNodeSet, visibleNodes]);

  const presentationEdges = useMemo(() => {
    if (!focusedNodeSet.size) return routedVisibleEdges;
    return routedVisibleEdges.map((edge) => {
      const inFocus = focusedNodeSet.has(edge.source) || focusedNodeSet.has(edge.target);
      return {
        ...edge,
        className: `${edge.className ?? ''} ${inFocus ? 'focus-hit' : 'focus-dim'}`.trim(),
        data: { ...edge.data, highlighted: inFocus },
        style: { ...edge.style, opacity: inFocus ? 1 : 0.14 },
      };
    });
  }, [focusedNodeSet, routedVisibleEdges]);

  return (
    <main
      className={`canvas-shell ${whiteboardMode ? 'canvas-shell--whiteboard' : ''} ${architectureViewMode ? 'canvas-shell--architecture' : ''} ${connectOrigin ? 'canvas-shell--connecting' : ''}`}
      ref={wrapperRef}
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
    >
      <RelationshipBadgeContext.Provider value={relationshipBadges}>
        <EdgeGeometryContext.Provider value={edgeGeometry}>
          <LodBandContext.Provider value={lodBand}>
          <ReactFlow
            nodes={presentationNodes}
            edges={presentationEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onlyRenderVisibleElements
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeUpdate={onEdgeUpdate}
            isValidConnection={isValidConnection}
            onConnectStart={(_, { nodeId }) => {
              const node = nodeId ? visibleNodes.find((candidate) => candidate.id === nodeId) : undefined;
              if (!node) return;
              setConnectOrigin({ nodeId: node.id, serviceId: node.data.serviceId, label: node.data.label || node.data.serviceName });
            }}
            onConnectEnd={() => {
              setConnectOrigin(null);
              setConnectHoverNodeId(null);
            }}
            onNodeMouseEnter={(_, node) => {
              if (connectOrigin) setConnectHoverNodeId(node.id);
            }}
            onNodeMouseLeave={() => {
              if (connectOrigin) setConnectHoverNodeId(null);
            }}
            // Selection is local: it never moves the camera. Framing is an explicit command
            // ("Fit view", "Zoom to selection", "Isolate path") on the toolbar.
            // Focus dimming used to clear itself because every click re-focused something. Now that
            // clicks leave the camera alone, an ordinary click is also what dismisses a dim left over
            // from Isolate path, paste, or select-all.
            onNodeClick={(_, node) => {
              setFocusNodeIds([]);
              // Single click opens the form. The inspector is a docked column now, so opening it
              // costs nothing on screen — there is no reason to make the user double-click.
              openInspector(node.id, undefined);
            }}
            onNodeDoubleClick={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              if (node.type === 'awsService') openInspector(node.id, undefined);
            }}
            onEdgeClick={(_, edge) => {
              setFocusNodeIds([]);
              openInspector(undefined, edge.id);
            }}
            onEdgeDoubleClick={(event, edge) => {
              event.preventDefault();
              event.stopPropagation();
              openInspector(undefined, edge.id);
            }}
            onPaneClick={(event) => {
              const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
              if (mode === 'group') addGroupNode('VPC', position);
              if (mode === 'label') addLabelNode(position);
              if (mode === 'select') {
                closeInspector();
                setFocusNodeIds([]);
                setSelection(undefined, undefined);
              }
            }}
            onNodeDragStart={(_, node) => {
              // The inspector no longer overlaps the canvas, so a drag has no reason to close it.
              // Dragging with a dim still applied would rebuild every node's className each tick.
              if (focusNodeIds.length) setFocusNodeIds([]);
              boundarySnapshotRef.current = node.type === 'groupBox' ? [] : snapshotBoundaries(nodes, node as AwsNode);
              checkpoint();
            }}
            onNodeDrag={(_, node) => {
              if (!boundarySnapshotRef.current.length) return;
              const next = resolveDropTarget(boundarySnapshotRef.current, node as AwsNode);
              const current = dropTargetRef.current;
              // Only re-render when the verdict changes, not on every pointer tick.
              if (current?.groupId === next?.groupId && current?.accepted === next?.accepted) return;
              dropTargetRef.current = next;
              setDropTarget(next);
            }}
            onNodeDragStop={(_, node) => {
              boundarySnapshotRef.current = [];
              dropTargetRef.current = null;
              setDropTarget(null);
              // A manual drag is a deliberate placement — auto-layout must never undo it on the next
              // structural change, so it's pinned here regardless of node type (service card or box).
              pinNode(node.id);
              attachNodeToContainingGroup(node.id);
            }}
            snapToGrid
            snapGrid={[24, 24]}
            defaultViewport={{ x: 0, y: 0, zoom: 1.25 }}
            minZoom={0.08}
            maxZoom={2.2}
            connectionLineType={ConnectionLineType.Step}
            panOnScroll
            panOnDrag={[0, 1, 2]}
            panActivationKeyCode="Space"
            // Shift-drag falls back to React Flow's own rubber-band multi-select. A custom DOM
            // hit-test gesture used to intercept it, and its only effect was re-framing the viewport
            // on whatever the rectangle touched. Left-drag stays panning (see panOnDrag), so
            // selectionOnDrag must remain off — the key is what arms the selection box.
            selectionOnDrag={false}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode="Shift"
            deleteKeyCode={null}
            nodesConnectable={mode !== 'label'}
            edgesUpdatable
            edgeUpdaterRadius={16}
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            {!whiteboardMode && !architectureViewMode && (
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(100,116,139,0.65)" />
            )}
            {architectureViewMode && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(52,211,153,0.28)" />}
            {/* Zoom lives in the canvas corner, where the hand already is, rather than in the
                toolbar two rows away. */}
            <Panel position="bottom-left" className="canvas-zoom-cluster">
              <button onClick={() => reactFlow.zoomOut()} title="Zoom out" aria-label="Zoom out" type="button">
                <Minus size={15} />
              </button>
              <span className="canvas-zoom-cluster__readout">{Math.round(zoom * 100)}%</span>
              <button onClick={() => reactFlow.zoomIn()} title="Zoom in" aria-label="Zoom in" type="button">
                <Plus size={15} />
              </button>
              <button onClick={() => reactFlow.fitView({ padding: 0.18, duration: 260 })} title="Fit view" aria-label="Fit view" type="button">
                <Maximize size={14} />
              </button>
            </Panel>
            <MiniMap position="bottom-right" nodeColor={minimapColor} pannable zoomable maskColor="rgba(15, 23, 42, 0.48)" />
            <Panel
              position="top-center"
              className={`canvas-mode-pill ${connectHint ? 'canvas-mode-pill--connecting' : ''} ${dropTarget ? (dropTarget.accepted ? 'canvas-mode-pill--accept' : 'canvas-mode-pill--reject') : ''} ${!connectHint && !dropTarget && activeView === 'dependencies' && mergedVisibleEdges.length > HIGH_EDGE_COUNT_WARNING_THRESHOLD ? 'canvas-mode-pill--warning' : ''}`}
            >
              {dropTarget?.message ?? connectHint ?? canvasStateLabel(mode, activeView, detailMode, mergedVisibleEdges.length)}
            </Panel>

            {/* Frame 3 of the connection interaction: state what the line will actually write. */}
            {lastConnection && (
              <Panel position="bottom-center" className={`connection-receipt connection-receipt--${lastConnection.kind}`}>
                <span className="connection-receipt__kind">
                  {lastConnection.kind === 'reference' ? 'Reference' : 'Connected'}
                </span>
                {lastConnection.expression ? (
                  <code className="connection-receipt__expression">{lastConnection.expression}</code>
                ) : (
                  <span className="connection-receipt__summary">{lastConnection.summary}</span>
                )}
                <span className="connection-receipt__note">
                  {lastConnection.expression ? 'written on apply' : 'ordering only — no value passed'}
                </span>
                <button onClick={dismissLastConnection} aria-label="Dismiss" type="button">
                  <X size={13} />
                </button>
              </Panel>
            )}
            {architectureViewMode && <ArchitectureLegend />}
            {!architectureViewMode && !whiteboardMode && <DefaultEdgeLegend />}
          </ReactFlow>
          </LodBandContext.Provider>
        </EdgeGeometryContext.Provider>
      </RelationshipBadgeContext.Provider>
    </main>
  );
}

function snapshotBoundaries(nodes: AwsNode[], dragged: AwsNode): BoundaryCandidate[] {
  // Group boxes nest too (a derived subnet box inside a derived vpc box) — position is relative to
  // whatever the immediate parent is, so a candidate 2+ levels deep needs the full ancestor walk,
  // not just its own raw (parent-relative) position.
  const resolveAbsolutePosition = createAbsolutePositionResolver(nodes);
  return nodes
    .filter((node) => node.type === 'groupBox')
    .map((node) => {
      const { width, height } = measuredNodeSize(node);
      const position = resolveAbsolutePosition(node.id);
      return {
        id: node.id,
        x: position.x,
        y: position.y,
        width,
        height,
        area: width * height,
        accepts: canContainNode(node, dragged),
        kind: node.data.groupKind ?? 'boundary',
      };
    })
    .sort((left, right) => left.area - right.area);
}

function resolveDropTarget(candidates: BoundaryCandidate[], dragged: AwsNode): BoundaryDropTarget | null {
  const { width, height } = measuredNodeSize(dragged);
  // dragged comes straight from React Flow's onNodeDrag, which already exposes positionAbsolute —
  // needed here (rather than the parent-relative `position`) now that boundary candidates above are
  // themselves in absolute coordinates, so a node nested under a derived box still hit-tests correctly.
  const draggedPosition = dragged.positionAbsolute ?? dragged.position;
  const centerX = draggedPosition.x + width / 2;
  const centerY = draggedPosition.y + height / 2;

  // Candidates are pre-sorted smallest-first, so the first hit is the innermost boundary.
  const hit = candidates.find(
    (candidate) =>
      centerX >= candidate.x && centerX <= candidate.x + candidate.width && centerY >= candidate.y && centerY <= candidate.y + candidate.height,
  );
  if (!hit) return null;

  return {
    groupId: hit.id,
    accepted: hit.accepts,
    message: hit.accepts
      ? `Drop to place in ${hit.kind}`
      : `A ${hit.kind} can't contain ${dragged.data.serviceName}`,
  };
}

function ArchitectureLegend() {
  const items: Array<{ label: string; color: string; dash?: string }> = [
    { label: 'Application Flow', color: '#cbd5e1' },
    { label: 'Network Routing', color: '#22d3ee', dash: '10 6' },
    { label: 'Security', color: '#f87171', dash: '2 5' },
    { label: 'Dependency', color: '#a78bfa', dash: '8 5' },
    { label: 'Monitoring', color: '#60a5fa', dash: '2 6' },
  ];

  return <EdgeLegendPanel items={items} />;
}

// Matches FlowEdge's default (non-whiteboard, non-architecture) palette and dash pattern exactly —
// edges are colored by category in every lens now, so the key that explains what a color means has
// to follow, not just live behind the Architecture toggle.
function DefaultEdgeLegend() {
  const items: Array<{ label: string; color: string; dash?: string }> = [
    { label: 'Data flow', color: '#2563eb' },
    { label: 'Network routing', color: '#0ea5e9' },
    { label: 'Security', color: '#dc2626', dash: '7 6' },
    { label: 'Dependency', color: '#7c3aed', dash: '4 6' },
    { label: 'Monitoring', color: '#64748b', dash: '4 6' },
    { label: 'Deployment', color: '#16a34a', dash: '4 6' },
  ];

  return <EdgeLegendPanel items={items} />;
}

function EdgeLegendPanel({ items }: { items: Array<{ label: string; color: string; dash?: string }> }) {
  return (
    <Panel position="bottom-center" className="architecture-legend">
      <span className="architecture-legend__title">Legend:</span>
      {items.map((item) => (
        <span className="architecture-legend__item" key={item.label}>
          <svg aria-hidden="true" height="10" width="28">
            <line stroke={item.color} strokeDasharray={item.dash} strokeWidth={2} x1="0" x2="28" y1="5" y2="5" />
          </svg>
          {item.label}
        </span>
      ))}
    </Panel>
  );
}

// A node is only routed by geometry when its position isn't governed by the deterministic layout at
// all: pinned (excluded from auto-layout entirely — see elkLayout.ts) or manually contained in a
// hand-drawn boundary. Everything else has a real layer to route from.
function isFixedForRouting(node: AwsNode, nodesById: Map<string, AwsNode>): boolean {
  if (node.data.pinned) return true;
  if (!node.parentNode) return false;
  const parent = nodesById.get(node.parentNode);
  return Boolean(parent?.type === 'groupBox' && !parent.data.derivedContainer);
}

function withSemanticEdgeHandles(
  edge: AwsEdge,
  nodesById: Map<string, AwsNode>,
  layerById: Map<string, number>,
  category: SemanticEdgeCategory,
  bundle: EdgeBundleSlot | undefined,
): AwsEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return edge;

  const sourcePort = sourceNode.data.ports.outputs[0];
  const targetPort = targetNode.data.ports.inputs[0];
  const sourceLayer = layerById.get(sourceNode.id);
  const targetLayer = layerById.get(targetNode.id);
  // Handle sides come from where each node sits in the deterministic layered layout (Fix 4), not raw
  // geometry — geometry shifts attachment points on every drag even when nothing about the actual
  // relationship changed. Pinned/manually-placed nodes have no layout-governed layer to route from,
  // so they keep the geometry fallback that used to apply to every edge.
  const { sourceSide, targetSide } =
    sourceLayer !== undefined && targetLayer !== undefined && !isFixedForRouting(sourceNode, nodesById) && !isFixedForRouting(targetNode, nodesById)
      ? getLayerDerivedConnectionSides(sourceLayer, targetLayer, sourceNode, targetNode)
      : getOptimalConnectionSides(sourceNode, targetNode);

  return {
    ...edge,
    sourceHandle: sourcePort ? buildHandleId('out', sourceSide, readHandlePort(edge.sourceHandle, sourcePort)) : undefined,
    targetHandle: targetPort ? buildHandleId('in', targetSide, readHandlePort(edge.targetHandle, targetPort)) : undefined,
    data: {
      label: edge.data?.label ?? '',
      connectionType: edge.data?.connectionType ?? category,
      protocol: edge.data?.protocol ?? '',
      port: edge.data?.port ?? '',
      ...edge.data,
      semanticCategory: category,
      bundleIndex: bundle?.index ?? 0,
      bundleSize: bundle?.size ?? 1,
    },
  };
}

/** Multiple edges between the exact same (source, target) pair collapse into one, keeping the first
 * and tallying the rest into `hiddenCount` — FlowEdge already renders that as a "+N" label suffix. */
function mergeParallelEdges(edges: AwsEdge[]): AwsEdge[] {
  const bySourceTarget = new Map<string, AwsEdge[]>();
  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}`;
    const bucket = bySourceTarget.get(key);
    if (bucket) bucket.push(edge);
    else bySourceTarget.set(key, [edge]);
  }

  return Array.from(bySourceTarget.values()).map((bucket) => {
    if (bucket.length === 1) return bucket[0];
    const [primary, ...rest] = bucket;
    return primary.data ? { ...primary, data: { ...primary.data, hiddenCount: rest.length } } : primary;
  });
}

// Above this, "All connections" is showing enough at once to stop being a readable diagnostic and
// start being the same undifferentiated soup the default lens exists to avoid.
const HIGH_EDGE_COUNT_WARNING_THRESHOLD = 60;

/**
 * What the canvas is doing, in words a user recognises. This used to concatenate three internal enum
 * values — "All Connections / Full Topology - Select mode" — which described the implementation
 * rather than telling anyone what to do next.
 */
function canvasStateLabel(mode: string, view: string, detail: string, visibleEdgeCount: number): string {
  if (mode === 'connect') return 'Drag from one resource to another to connect them';
  if (mode === 'group') return 'Click the canvas to place a boundary';
  if (mode === 'label') return 'Click the canvas to place a note';

  const lens = viewLabel(view);
  const depth = detail === 'overview' ? 'key resources only' : detail === 'architecture' ? 'architecture detail' : 'every resource';
  const base = `Showing ${lens.toLowerCase()} · ${depth}`;
  if (view === 'dependencies' && visibleEdgeCount > HIGH_EDGE_COUNT_WARNING_THRESHOLD) {
    return `${base} · ${visibleEdgeCount} connections — switch to Application flow for a readable view`;
  }
  return base;
}

function viewLabel(view: string): string {
  if (view === 'application-flow' || view === 'topology') return 'Application flow';
  if (view === 'network') return 'Network';
  if (view === 'security') return 'Security';
  if (view === 'monitoring') return 'Monitoring';
  if (view === 'deployment') return 'Deployment';
  return 'All connections';
}

export default Canvas;
