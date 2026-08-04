import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  SelectionMode,
  useNodesInitialized,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
} from 'reactflow';
import FlowEdge from './edges/FlowEdge';
import AwsServiceNode from './nodes/AwsServiceNode';
import GroupBoxNode from './nodes/GroupBoxNode';
import LabelNode from './nodes/LabelNode';
import { useDiagramStore } from '../store/diagramStore';
import type { AwsEdge, AwsNode } from '../types';
import { getStoredUser } from '../auth/authClient';
import { isServiceAllowedForUser } from '../utils/accessControl';
import { buildHandleId, getOptimalConnectionSides, readHandlePort } from '../utils/connectionRouting';
import { buildVisibleGraph, semanticEdgeCategory } from '../utils/diagramSemantics';

const nodeTypes: NodeTypes = {
  awsService: AwsServiceNode,
  groupBox: GroupBoxNode,
  labelNode: LabelNode,
};

const edgeTypes: EdgeTypes = {
  flowEdge: FlowEdge,
};

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function isInteractiveSurfaceOpen(inspectorNodeId?: string, inspectorEdgeId?: string): boolean {
  return Boolean(
    inspectorNodeId ||
      inspectorEdgeId ||
      document.querySelector('.modal-backdrop, .diagram-delete-dialog-backdrop, .context-menu'),
  );
}

function Canvas() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionFitTimeoutRef = useRef<number | null>(null);
  const suppressSelectionFocusUntilRef = useRef(0);
  const lastViewportFitVersionRef = useRef<number | null>(null);
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [isNodeMoving, setIsNodeMoving] = useState(false);
  const {
    nodes,
    edges,
    mode,
    activeView,
    detailMode,
    isolatedNodeId,
    whiteboardMode,
    architectureViewMode,
    focusNodeIds,
    fitViewVersion,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onEdgeUpdate,
    setSelection,
    setFocusNodeIds,
    inspectorNodeId,
    inspectorEdgeId,
    openInspector,
    closeInspector,
    addServiceNode,
    addGroupNode,
    addLabelNode,
    deleteSelection,
    copySelection,
    pasteClipboard,
    selectAll,
    undo,
    redo,
    checkpoint,
    attachNodeToContainingGroup,
  } = useDiagramStore();

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
        if (isInteractiveSurfaceOpen(inspectorNodeId, inspectorEdgeId)) return;
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'Backspace' && wrapperRef.current?.contains(document.activeElement)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelection, deleteSelection, inspectorEdgeId, inspectorNodeId, pasteClipboard, redo, selectAll, undo]);

  useEffect(() => {
    return () => {
      if (selectionFitTimeoutRef.current) window.clearTimeout(selectionFitTimeoutRef.current);
    };
  }, []);

  const minimapColor = useCallback((node: { type?: string; data?: { color?: string } }) => {
    if (node.type === 'groupBox') return '#94a3b8';
    if (node.type === 'labelNode') return '#64748b';
    return node.data?.color ?? '#2563eb';
  }, []);

  const defaultEdgeOptions = useMemo(() => ({ type: 'flowEdge', markerEnd: { type: MarkerType.ArrowClosed } }), []);

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

  const visibleGraph = useMemo(() => buildVisibleGraph(nodes, graphEdges, activeView, detailMode, isolatedNodeId), [activeView, detailMode, graphEdges, isolatedNodeId, nodes]);
  const visibleEdges = visibleGraph.edges;
  const visibleNodes = visibleGraph.nodes;

  const routingNodeById = useMemo(() => {
    const byId = new Map(visibleNodes.map((node) => [node.id, node]));
    return new Map(
      visibleNodes.map((node) => {
        const parent = node.parentNode ? byId.get(node.parentNode) : undefined;
        return [
          node.id,
          parent
            ? {
                ...node,
                position: {
                  x: node.position.x + parent.position.x,
                  y: node.position.y + parent.position.y,
                },
              }
            : node,
        ];
      }),
    );
  }, [visibleNodes]);

  const routedVisibleEdges = useMemo(() => visibleEdges.map((edge) => withSemanticEdgeHandles(edge, routingNodeById, visibleEdges)), [routingNodeById, visibleEdges]);

  useEffect(() => {
    if (!visibleNodes.length || !nodesInitialized) return;
    if (lastViewportFitVersionRef.current === fitViewVersion) return;
    lastViewportFitVersionRef.current = fitViewVersion;
    if (visibleNodes.length > 24) return;
    const fitWholeDiagram = () => reactFlow.fitView({ padding: 0.12, duration: 360, maxZoom: 1.1 });
    requestAnimationFrame(fitWholeDiagram);
    const settledFit = window.setTimeout(fitWholeDiagram, 180);
    return () => window.clearTimeout(settledFit);
  }, [fitViewVersion, nodesInitialized, reactFlow, visibleNodes.length]);

  const visibleNodeById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const focusedNodeSet = useMemo(() => new Set(focusNodeIds), [focusNodeIds]);

  const presentationNodes = useMemo(() => {
    if (!focusedNodeSet.size || isNodeMoving) return visibleNodes;
    return visibleNodes.map((node) => ({
      ...node,
      className: `${node.className ?? ''} ${focusedNodeSet.has(node.id) ? 'focus-hit' : 'focus-dim'}`.trim(),
    }));
  }, [focusedNodeSet, isNodeMoving, visibleNodes]);

  const presentationEdges = useMemo(() => {
    if (!focusedNodeSet.size || isNodeMoving) return routedVisibleEdges;
    return routedVisibleEdges.map((edge) => {
      const inFocus = focusedNodeSet.has(edge.source) || focusedNodeSet.has(edge.target);
      return {
        ...edge,
        className: `${edge.className ?? ''} ${inFocus ? 'focus-hit' : 'focus-dim'}`.trim(),
        data: { ...edge.data, highlighted: inFocus },
        style: { ...edge.style, opacity: inFocus ? 1 : 0.14 },
      };
    });
  }, [focusedNodeSet, isNodeMoving, routedVisibleEdges]);

  const getNodeBounds = useCallback(
    (nodeId: string) => {
      const node = visibleNodeById.get(nodeId);
      if (!node) return undefined;
      const parent = node.parentNode ? visibleNodeById.get(node.parentNode) : undefined;
      const x = node.position.x + (parent?.position.x ?? 0);
      const y = node.position.y + (parent?.position.y ?? 0);
      const width = Number(node.width ?? node.style?.width ?? (node.type === 'groupBox' ? 520 : 160));
      const height = Number(node.height ?? node.style?.height ?? (node.type === 'groupBox' ? 340 : 112));
      return { x, y, width, height, area: width * height };
    },
    [visibleNodeById],
  );

  const getContainedServiceNodeIds = useCallback(
    (groupId: string) => {
      const groupBounds = getNodeBounds(groupId);
      if (!groupBounds) return [];

      return visibleNodes
        .filter((node) => node.type !== 'groupBox')
        .filter((node) => {
          const bounds = getNodeBounds(node.id);
          if (!bounds) return false;
          const centerX = bounds.x + bounds.width / 2;
          const centerY = bounds.y + bounds.height / 2;
          return centerX >= groupBounds.x && centerX <= groupBounds.x + groupBounds.width && centerY >= groupBounds.y && centerY <= groupBounds.y + groupBounds.height;
        })
        .map((node) => node.id);
    },
    [getNodeBounds, visibleNodes],
  );

  const getSmallestContainingGroup = useCallback(
    (nodeId: string) => {
      const bounds = getNodeBounds(nodeId);
      if (!bounds) return undefined;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      return visibleNodes
        .filter((node) => node.type === 'groupBox')
        .map((node) => ({ node, bounds: getNodeBounds(node.id) }))
        .filter((item): item is { node: typeof visibleNodes[number]; bounds: { x: number; y: number; width: number; height: number; area: number } } => Boolean(item.bounds))
        .filter(({ node, bounds: groupBounds }) => node.id !== nodeId && centerX >= groupBounds.x && centerX <= groupBounds.x + groupBounds.width && centerY >= groupBounds.y && centerY <= groupBounds.y + groupBounds.height)
        .sort((a, b) => a.bounds.area - b.bounds.area)[0]?.node;
    },
    [getNodeBounds, visibleNodes],
  );

  const getNearbyServiceNodeIds = useCallback(
    (nodeId: string, maxCount = 8) => {
      const bounds = getNodeBounds(nodeId);
      if (!bounds) return [nodeId];
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      return visibleNodes
        .filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode')
        .map((node) => {
          const nodeBounds = getNodeBounds(node.id);
          if (!nodeBounds) return undefined;
          const nodeCenterX = nodeBounds.x + nodeBounds.width / 2;
          const nodeCenterY = nodeBounds.y + nodeBounds.height / 2;
          const distance = Math.hypot(nodeCenterX - centerX, nodeCenterY - centerY);
          return { id: node.id, distance };
        })
        .filter((item): item is { id: string; distance: number } => Boolean(item))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxCount)
        .map((item) => item.id);
    },
    [getNodeBounds, visibleNodes],
  );

  const fitNodeIds = useCallback(
    (nodeIds: string[], options: { padding?: number; maxZoom?: number; duration?: number } = {}) => {
      const fitIds = Array.from(new Set(nodeIds)).filter((id) => visibleNodeById.has(id));
      if (!fitIds.length) return;
      setFocusNodeIds(fitIds);
      requestAnimationFrame(() => {
        reactFlow.fitView({
          nodes: fitIds.map((id) => ({ id })),
          padding: options.padding ?? (fitIds.length === 1 ? 0.44 : 0.22),
          duration: options.duration ?? 420,
          maxZoom: options.maxZoom ?? (fitIds.length === 1 ? 1.72 : 1.44),
        });
      });
    },
    [reactFlow, setFocusNodeIds, visibleNodeById],
  );

  const focusNodeArea = useCallback(
    (nodeId: string) => {
      const clickedNode = visibleNodes.find((node) => node.id === nodeId);
      if (!clickedNode) return;

      if (clickedNode.type === 'groupBox') {
        const childIds = getContainedServiceNodeIds(nodeId);
        fitNodeIds(childIds.length ? childIds : [nodeId], { padding: childIds.length ? 0.18 : 0.22, maxZoom: childIds.length ? 1.24 : 1.18 });
        return;
      }

      const directlyConnectedIds = new Set([nodeId]);
      edges.forEach((edge) => {
        if (edge.source === nodeId) directlyConnectedIds.add(edge.target);
        if (edge.target === nodeId) directlyConnectedIds.add(edge.source);
      });

      if (focusedNodeSet.has(nodeId)) {
        const scopedIds = Array.from(directlyConnectedIds).filter((id) => focusedNodeSet.has(id) || id === nodeId);
        fitNodeIds(scopedIds.length > 1 ? scopedIds : [nodeId], { padding: scopedIds.length > 1 ? 0.32 : 0.44, maxZoom: scopedIds.length > 1 ? 1.64 : 1.82 });
        return;
      }

      const containingGroup = getSmallestContainingGroup(nodeId);
      const groupChildIds = containingGroup ? getContainedServiceNodeIds(containingGroup.id) : [];
      if (groupChildIds.length > 1) {
        fitNodeIds(groupChildIds, { padding: 0.18, maxZoom: 1.28 });
        return;
      }

      const connectedIds = Array.from(directlyConnectedIds).filter((id) => visibleNodeById.has(id));
      const nearbyIds = getNearbyServiceNodeIds(nodeId);
      fitNodeIds(connectedIds.length > 1 ? connectedIds : nearbyIds, { padding: 0.28, maxZoom: 1.42 });
    },
    [edges, fitNodeIds, focusedNodeSet, getContainedServiceNodeIds, getNearbyServiceNodeIds, getSmallestContainingGroup, visibleNodeById, visibleNodes],
  );

  const focusEdgeArea = useCallback(
    (sourceId: string, targetId: string) => {
      const ids = new Set([sourceId, targetId]);
      fitNodeIds(Array.from(ids), { padding: 0.38, maxZoom: 1.56 });
    },
    [fitNodeIds],
  );

  const focusSelectedArea = useCallback((nodeIds: string[], edgeIds: string[] = []) => {
    const selectedNodeIds = nodeIds;
    const selectedEdgeIds = edgeIds;
    if (!selectedNodeIds.length && !selectedEdgeIds.length) return;

    const selectedServiceNodeIds = selectedNodeIds.filter((id) => visibleNodeById.get(id)?.type !== 'groupBox');
    const selectedGroupChildNodeIds = selectedServiceNodeIds.length
      ? []
      : selectedNodeIds.flatMap((id) => {
          const group = visibleNodeById.get(id);
          if (!group || group.type !== 'groupBox') return [];
          const groupWidth = Number(group.width ?? group.style?.width ?? 0);
          const groupHeight = Number(group.height ?? group.style?.height ?? 0);
          const groupX = group.position.x;
          const groupY = group.position.y;

          return visibleNodes
            .filter((node) => node.type !== 'groupBox')
            .filter((node) => {
              const parent = node.parentNode ? visibleNodeById.get(node.parentNode) : undefined;
              const x = node.position.x + (parent?.position.x ?? 0);
              const y = node.position.y + (parent?.position.y ?? 0);
              const width = Number(node.width ?? 160);
              const height = Number(node.height ?? 112);
              const centerX = x + width / 2;
              const centerY = y + height / 2;
              return centerX >= groupX && centerX <= groupX + groupWidth && centerY >= groupY && centerY <= groupY + groupHeight;
            })
            .map((node) => node.id);
        });
    const ids = new Set(selectedServiceNodeIds.length ? selectedServiceNodeIds : selectedGroupChildNodeIds.length ? selectedGroupChildNodeIds : selectedNodeIds);
    edgeIds.forEach((edgeId) => {
      const edge = visibleEdges.find((candidate) => candidate.id === edgeId);
      if (edge) {
        ids.add(edge.source);
        ids.add(edge.target);
      }
    });

    const fitNodeIds = Array.from(ids).filter((id) => visibleNodeById.has(id));
    if (!fitNodeIds.length) return;

    setFocusNodeIds(fitNodeIds);
    closeInspector();
    setSelection(fitNodeIds[0], undefined);
    requestAnimationFrame(() => {
      reactFlow.fitView({
        nodes: fitNodeIds.map((id) => ({ id })),
        padding: fitNodeIds.length === 1 ? 0.46 : 0.24,
        duration: 460,
        maxZoom: fitNodeIds.length === 1 ? 1.6 : 1.42,
      });
    });
  }, [closeInspector, reactFlow, setSelection, visibleEdges, visibleNodeById, visibleNodes]);

  const getNodeIdsInSelectionRect = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const bottom = Math.max(start.y, end.y);
      if (right - left < 8 || bottom - top < 8) return [];

      const serviceNodeIds: string[] = [];
      const groupNodeIds: string[] = [];
      wrapperRef.current?.querySelectorAll<HTMLElement>('.react-flow__node[data-id]').forEach((element) => {
        const id = element.dataset.id;
        if (!id) return;
        const node = visibleNodeById.get(id);
        if (!node) return;

        const rect = element.getBoundingClientRect();
        const intersects = rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
        if (!intersects) return;
        if (node.type === 'groupBox') groupNodeIds.push(id);
        else serviceNodeIds.push(id);
      });

      return serviceNodeIds.length ? serviceNodeIds : groupNodeIds;
    },
    [visibleNodeById],
  );

  const focusSelectionGesture = useCallback(
    (event: React.MouseEvent) => {
      const start = selectionStartRef.current;
      selectionStartRef.current = null;
      if (!start) return;

      const rectNodeIds = start ? getNodeIdsInSelectionRect(start, { x: event.clientX, y: event.clientY }) : [];
      if (rectNodeIds.length) {
        focusSelectedArea(rectNodeIds);
      }
    },
    [focusSelectedArea, getNodeIdsInSelectionRect],
  );

  const beginAreaSelectionGesture = useCallback(
    (event: React.MouseEvent | React.PointerEvent) => {
      if (mode !== 'select' || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node-awsService, .group-box__header, .edge-label, button, input, select, textarea, a')) return;

      if (!event.shiftKey) {
        selectionStartRef.current = null;
        suppressSelectionFocusUntilRef.current = Date.now() + 450;
        if (selectionFitTimeoutRef.current) {
          window.clearTimeout(selectionFitTimeoutRef.current);
          selectionFitTimeoutRef.current = null;
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectionStartRef.current = { x: event.clientX, y: event.clientY };
    },
    [mode],
  );

  const finishAreaSelectionGesture = useCallback(
    (event: React.MouseEvent | React.PointerEvent) => {
      if (mode !== 'select') return;
      const start = selectionStartRef.current;
      if (!start) return;
      event.preventDefault();
      event.stopPropagation();
      selectionStartRef.current = null;
      const rectNodeIds = getNodeIdsInSelectionRect(start, { x: event.clientX, y: event.clientY });
      if (!rectNodeIds.length) return;
      if (selectionFitTimeoutRef.current) {
        window.clearTimeout(selectionFitTimeoutRef.current);
        selectionFitTimeoutRef.current = null;
      }
      window.setTimeout(() => focusSelectedArea(rectNodeIds), 0);
    },
    [focusSelectedArea, getNodeIdsInSelectionRect, mode],
  );

  return (
    <main
      className={`canvas-shell ${isNodeMoving ? 'canvas-shell--moving' : ''} ${whiteboardMode ? 'canvas-shell--whiteboard' : ''} ${architectureViewMode ? 'canvas-shell--architecture' : ''}`}
      ref={wrapperRef}
      onMouseDownCapture={beginAreaSelectionGesture}
      onMouseUpCapture={finishAreaSelectionGesture}
      onPointerDownCapture={beginAreaSelectionGesture}
      onPointerUpCapture={finishAreaSelectionGesture}
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
    >
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
        onNodeClick={(_, node) => {
          closeInspector();
          setSelection(node.id, undefined);
          focusNodeArea(node.id);
        }}
        onNodeDoubleClick={(event, node) => {
          event.preventDefault();
          event.stopPropagation();
          suppressSelectionFocusUntilRef.current = Date.now() + 450;
          if (selectionFitTimeoutRef.current) {
            window.clearTimeout(selectionFitTimeoutRef.current);
      selectionFitTimeoutRef.current = null;
      }
      if (node.type === 'awsService') openInspector(node.id, undefined);
        }}
        onEdgeClick={(_, edge) => {
          closeInspector();
          setSelection(undefined, edge.id);
          focusEdgeArea(edge.source, edge.target);
        }}
        onEdgeDoubleClick={(event, edge) => {
          event.preventDefault();
          event.stopPropagation();
          suppressSelectionFocusUntilRef.current = Date.now() + 450;
          if (selectionFitTimeoutRef.current) {
            window.clearTimeout(selectionFitTimeoutRef.current);
            selectionFitTimeoutRef.current = null;
          }
          openInspector(undefined, edge.id);
        }}
        onSelectionStart={(event) => {
          selectionStartRef.current = mode === 'select' && event.shiftKey ? { x: event.clientX, y: event.clientY } : null;
        }}
        onSelectionEnd={focusSelectionGesture}
        onPaneClick={(event) => {
          const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          if (mode === 'group') addGroupNode('VPC', position);
          if (mode === 'label') addLabelNode(position);
          if (mode === 'select') {
            closeInspector();
            setSelection(undefined, undefined);
          }
        }}
        onNodeDragStart={() => {
          setIsNodeMoving(true);
          closeInspector();
          checkpoint();
        }}
        onNodeDragStop={(_, node) => {
          setIsNodeMoving(false);
          attachNodeToContainingGroup(node.id);
        }}
        snapToGrid
        snapGrid={[24, 24]}
        defaultViewport={{ x: 0, y: 0, zoom: 1.25 }}
        minZoom={0.08}
        maxZoom={2.2}
        connectionLineType={ConnectionLineType.SmoothStep}
        panOnScroll
        panOnDrag={[0, 1, 2]}
        panActivationKeyCode="Space"
        selectionOnDrag={false}
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
        {!isNodeMoving && !whiteboardMode && !architectureViewMode && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(100,116,139,0.65)" />}
        {!isNodeMoving && architectureViewMode && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(52,211,153,0.28)" />}
        <Controls position="bottom-left" showInteractive={false} />
        {!isNodeMoving && <MiniMap position="bottom-right" nodeColor={minimapColor} pannable zoomable maskColor="rgba(15, 23, 42, 0.48)" />}
        <Panel position="top-center" className="canvas-mode-pill">
          {viewLabel(activeView)} / {detailModeLabel(detailMode)} -{' '}
          {mode === 'connect' ? 'Connect mode' : mode === 'group' ? 'Click canvas to add boundary' : mode === 'label' ? 'Click canvas to add label' : 'Select mode'}
        </Panel>
        {architectureViewMode && <ArchitectureLegend />}
      </ReactFlow>
    </main>
  );
}

function ArchitectureLegend() {
  const items: Array<{ label: string; color: string; dash?: string }> = [
    { label: 'Application Flow', color: '#cbd5e1' },
    { label: 'Network Routing', color: '#22d3ee', dash: '10 6' },
    { label: 'Security', color: '#f87171', dash: '2 5' },
    { label: 'Dependency', color: '#a78bfa', dash: '8 5' },
    { label: 'Monitoring', color: '#60a5fa', dash: '2 6' },
  ];

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

function withSemanticEdgeHandles(edge: AwsEdge, nodesById: Map<string, AwsNode>, visibleEdges: AwsEdge[]): AwsEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return edge;

  const category = semanticEdgeCategory(edge, Array.from(nodesById.values()));
  const sourcePort = sourceNode.data.ports.outputs[0];
  const targetPort = targetNode.data.ports.inputs[0];
  // Handle sides come from actual node geometry (which side of source really faces target), not a
  // side fixed by category — a fixed 'right'/'left' regardless of position forced edges into an
  // unnecessary detour/zigzag even between two nodes that were already stacked or adjacent.
  const { sourceSide, targetSide } = getOptimalConnectionSides(sourceNode, targetNode);
  const targetPeers = visibleEdges.filter((candidate) => candidate.target === edge.target && semanticEdgeCategory(candidate, Array.from(nodesById.values())) === category);
  const bundleIndex = Math.max(0, targetPeers.findIndex((candidate) => candidate.id === edge.id));

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
      bundleIndex,
      bundleSize: targetPeers.length,
    },
  };
}

function viewLabel(view: string): string {
  if (view === 'application-flow' || view === 'topology') return 'Application Flow';
  if (view === 'network') return 'Network';
  if (view === 'security') return 'Security';
  if (view === 'monitoring') return 'Monitoring';
  if (view === 'deployment') return 'Deployment';
  return 'All Connections';
}

function detailModeLabel(mode: string): string {
  if (mode === 'overview') return 'Overview';
  if (mode === 'architecture') return 'Architecture';
  return 'Full Topology';
}

export default Canvas;
