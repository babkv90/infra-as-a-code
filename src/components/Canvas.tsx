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
import ArchitectureLaneNode from './nodes/ArchitectureLaneNode';
import AwsServiceNode from './nodes/AwsServiceNode';
import GroupBoxNode from './nodes/GroupBoxNode';
import LabelNode from './nodes/LabelNode';
import { useDiagramStore } from '../store/diagramStore';
import type { AwsEdge, AwsNode } from '../types';
import { getStoredUser } from '../auth/authClient';
import { isServiceAllowedForUser } from '../utils/accessControl';
import { withOptimalEdgeHandles } from '../utils/connectionRouting';
import { serviceById } from '../data/awsServices';

const nodeTypes: NodeTypes = {
  awsService: AwsServiceNode,
  groupBox: GroupBoxNode,
  labelNode: LabelNode,
  architectureLane: ArchitectureLaneNode,
};

const edgeTypes: EdgeTypes = {
  flowEdge: FlowEdge,
};

type PresentationViewMode = 'architecture' | 'full';

const architectureLanes = [
  { id: 'edge', title: '1. Edge & Delivery', color: '#7c3aed', x: 0, width: 250 },
  { id: 'network', title: '2. Network Boundary', color: '#2563eb', x: 350, width: 560 },
  { id: 'api', title: '3. API Entry', color: '#f97316', x: 1010, width: 250 },
  { id: 'compute', title: '4. Compute & Platform', color: '#16a34a', x: 1360, width: 560 },
  { id: 'data', title: '5. Data Layer', color: '#7c3aed', x: 2020, width: 330 },
] as const;

type ArchitectureLaneId = (typeof architectureLanes)[number]['id'];
const ARCHITECTURE_NODE_WIDTH = 150;
const ARCHITECTURE_NODE_HEIGHT = 90;
const ARCHITECTURE_NODE_GAP = 100;
const MIN_PRESENTATION_NODE_GAP = 100;

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
  const [presentationView, setPresentationView] = useState<PresentationViewMode>('architecture');
  const {
    nodes,
    edges,
    mode,
    activeView,
    whiteboardMode,
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

  const visibleEdges = useMemo(() => {
    if (activeView === 'dependencies') return graphEdges;
    if (activeView === 'security') {
      return graphEdges.filter((edge) => edge.data?.connectionType === 'security' || edge.data?.protocol === 'IAM' || edge.data?.label === 'IAM');
    }
    return graphEdges.filter((edge) => edge.data?.label !== 'reference' && edge.data?.protocol !== 'Terraform');
  }, [activeView, graphEdges]);

  const visibleNodes = useMemo(() => {
    if (activeView !== 'security') return nodes;

    const securityNodeIds = new Set<string>();
    visibleEdges.forEach((edge) => {
      securityNodeIds.add(edge.source);
      securityNodeIds.add(edge.target);
    });

    return nodes.filter((node) => node.type === 'groupBox' || node.data.serviceId === 'iam' || node.data.serviceId === 'security-group' || node.data.serviceId === 'kms' || securityNodeIds.has(node.id));
  }, [activeView, nodes, visibleEdges]);

  const architectureNodes = useMemo(() => {
    if (presentationView !== 'architecture') return visibleNodes;
    return enforcePresentationNodeSpacing(buildArchitecturePresentationNodes(visibleNodes));
  }, [presentationView, visibleNodes]);

  const routingNodeById = useMemo(() => {
    const byId = new Map(architectureNodes.map((node) => [node.id, node]));
    return new Map(
      architectureNodes.map((node) => {
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
  }, [architectureNodes]);

  const routedVisibleEdges = useMemo(() => visibleEdges.map((edge) => withOptimalEdgeHandles(edge, routingNodeById)), [routingNodeById, visibleEdges]);

  useEffect(() => {
    if (!architectureNodes.length || !nodesInitialized) return;
    if (lastViewportFitVersionRef.current === fitViewVersion) return;
    lastViewportFitVersionRef.current = fitViewVersion;
    if (architectureNodes.length > 24 && presentationView !== 'architecture') return;
    const fitWholeDiagram = () => reactFlow.fitView({ padding: 0.12, duration: 360, maxZoom: 1.1 });
    requestAnimationFrame(fitWholeDiagram);
    const settledFit = window.setTimeout(fitWholeDiagram, 180);
    return () => window.clearTimeout(settledFit);
  }, [architectureNodes.length, fitViewVersion, nodesInitialized, presentationView, reactFlow]);

  const visibleNodeById = useMemo(() => new Map(architectureNodes.map((node) => [node.id, node])), [architectureNodes]);
  const focusedNodeSet = useMemo(() => new Set(focusNodeIds), [focusNodeIds]);

  const presentationNodes = useMemo(() => {
    if (!focusedNodeSet.size || isNodeMoving) return architectureNodes;
    return architectureNodes.map((node) => ({
      ...node,
      className: `${node.className ?? ''} ${focusedNodeSet.has(node.id) ? 'focus-hit' : 'focus-dim'}`.trim(),
    }));
  }, [architectureNodes, focusedNodeSet, isNodeMoving]);

  const presentationEdges = useMemo(() => {
    if (!focusedNodeSet.size || isNodeMoving) return routedVisibleEdges;
    return routedVisibleEdges.map((edge) => {
      const inFocus = focusedNodeSet.has(edge.source) || focusedNodeSet.has(edge.target);
      return {
        ...edge,
        className: `${edge.className ?? ''} ${inFocus ? 'focus-hit' : 'focus-dim'}`.trim(),
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
      className={`canvas-shell ${isNodeMoving ? 'canvas-shell--moving' : ''} ${whiteboardMode ? 'canvas-shell--whiteboard' : ''}`}
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
          if (presentationView === 'architecture') {
            closeInspector();
            setSelection(undefined, undefined);
            return;
          }
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
        nodesConnectable={mode !== 'label' && presentationView === 'full'}
        edgesUpdatable={presentationView === 'full'}
        edgeUpdaterRadius={16}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        {!isNodeMoving && !whiteboardMode && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(100,116,139,0.65)" />}
        <Controls position="bottom-left" showInteractive={false} />
        {!isNodeMoving && <MiniMap position="bottom-right" nodeColor={minimapColor} pannable zoomable maskColor="rgba(15, 23, 42, 0.48)" />}
        <Panel position="top-left" className="architecture-view-toggle">
          <button className={presentationView === 'architecture' ? 'active' : ''} onClick={() => setPresentationView('architecture')} type="button">
            Architecture
          </button>
          <button className={presentationView === 'full' ? 'active' : ''} onClick={() => setPresentationView('full')} type="button">
            Full topology
          </button>
        </Panel>
        <Panel position="top-center" className="canvas-mode-pill">
          {presentationView === 'architecture' ? 'Architecture view' : activeView === 'topology' ? 'Topology view' : activeView === 'dependencies' ? 'Dependency view' : 'Security view'} -{' '}
          {mode === 'connect' ? 'Connect mode' : mode === 'group' ? 'Click canvas to add boundary' : mode === 'label' ? 'Click canvas to add label' : 'Select mode'}
        </Panel>
      </ReactFlow>
    </main>
  );
}

function buildArchitecturePresentationNodes(nodes: AwsNode[]): AwsNode[] {
  const visibleServiceNodes = nodes.filter((node) => node.type !== 'groupBox');
  const byLane = new Map<ArchitectureLaneId, AwsNode[]>();
  architectureLanes.forEach((lane) => byLane.set(lane.id, []));

  visibleServiceNodes.forEach((node) => {
    byLane.get(architectureLaneForNode(node))?.push(node);
  });

  const placedNodes: AwsNode[] = [];
  const laneHeight = Math.max(
    520,
    Math.max(
      ...architectureLanes.map((lane) => {
        const laneNodes = byLane.get(lane.id) ?? [];
        const columns = lane.width >= ARCHITECTURE_NODE_WIDTH * 2 + ARCHITECTURE_NODE_GAP + 64 && laneNodes.length > 5 ? 2 : 1;
        const rows = Math.ceil(laneNodes.length / columns);
        return 86 + rows * ARCHITECTURE_NODE_HEIGHT + Math.max(0, rows - 1) * ARCHITECTURE_NODE_GAP + 48;
      }),
    ),
  );

  architectureLanes.forEach((lane) => {
    placedNodes.push(createArchitectureLaneNode(lane, laneHeight));
    const laneNodes = byLane.get(lane.id) ?? [];
    const columns = lane.width >= ARCHITECTURE_NODE_WIDTH * 2 + ARCHITECTURE_NODE_GAP + 64 && laneNodes.length > 5 ? 2 : 1;
    const cardStepX = ARCHITECTURE_NODE_WIDTH + ARCHITECTURE_NODE_GAP;
    const cardStepY = ARCHITECTURE_NODE_HEIGHT + ARCHITECTURE_NODE_GAP;
    laneNodes.forEach((node, index) => {
      const column = columns === 2 ? index % 2 : 0;
      const row = columns === 2 ? Math.floor(index / 2) : index;
      placedNodes.push({
        ...node,
        parentNode: undefined,
        extent: undefined,
        draggable: false,
        width: ARCHITECTURE_NODE_WIDTH,
        height: ARCHITECTURE_NODE_HEIGHT,
        style: { ...node.style, width: ARCHITECTURE_NODE_WIDTH, height: ARCHITECTURE_NODE_HEIGHT },
        position: {
          x: lane.x + 32 + column * cardStepX,
          y: 86 + row * cardStepY,
        },
        className: `${node.className ?? ''} architecture-node-card`.trim(),
      });
    });
  });

  return placedNodes;
}

function enforcePresentationNodeSpacing(nodes: AwsNode[]): AwsNode[] {
  const placed: AwsNode[] = [];

  for (const node of nodes) {
    if (node.type === 'architectureLane' || node.type === 'groupBox') {
      placed.push(node);
      continue;
    }

    const size = presentationNodeSize(node);
    let position = { ...node.position };
    let attempts = 0;

    while (placed.some((candidate) => isPresentationNodeTooClose({ ...node, position }, candidate, size)) && attempts < 160) {
      position = { x: position.x, y: position.y + 24 };
      attempts += 1;
    }

    placed.push({ ...node, position });
  }

  return placed;
}

function isPresentationNodeTooClose(node: AwsNode, other: AwsNode, nodeSize: { width: number; height: number }): boolean {
  if (other.type === 'architectureLane' || other.type === 'groupBox') return false;
  const otherSize = presentationNodeSize(other);
  return rectsTooClose(
    { x: node.position.x, y: node.position.y, width: nodeSize.width, height: nodeSize.height },
    { x: other.position.x, y: other.position.y, width: otherSize.width, height: otherSize.height },
    MIN_PRESENTATION_NODE_GAP,
  );
}

function rectsTooClose(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }, gap: number): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

function presentationNodeSize(node: AwsNode): { width: number; height: number } {
  const width = Number(node.width ?? node.style?.width ?? ARCHITECTURE_NODE_WIDTH);
  const height = Number(node.height ?? node.style?.height ?? ARCHITECTURE_NODE_HEIGHT);
  return {
    width: Number.isFinite(width) ? width : ARCHITECTURE_NODE_WIDTH,
    height: Number.isFinite(height) ? height : ARCHITECTURE_NODE_HEIGHT,
  };
}

function createArchitectureLaneNode(lane: (typeof architectureLanes)[number], height: number): AwsNode {
  return {
    id: `presentation-lane-${lane.id}`,
    type: 'architectureLane',
    position: { x: lane.x, y: 24 },
    width: lane.width,
    height,
    style: { width: lane.width, height },
    selectable: false,
    draggable: false,
    deletable: false,
    data: {
      serviceName: lane.title,
      label: lane.title,
      region: '',
      arn: '',
      status: 'unknown',
      color: lane.color,
      icon: 'Columns3',
      subLabel: 'presentation lane',
      ports: { inputs: [], outputs: [] },
      config: {},
      generated: true,
    },
  };
}

function architectureLaneForNode(node: AwsNode): ArchitectureLaneId {
  const serviceId = node.data.serviceId ?? '';
  if (['cloudfront', 'waf', 'route53'].includes(serviceId)) return 'edge';
  if (['vpc', 'subnet', 'igw', 'nat', 'route-table', 'route', 'route-association'].includes(serviceId)) return 'network';
  if (['apigw', 'alb', 'lb-listener', 'lb-target-group', 'lb-target-attachment'].includes(serviceId)) return 'api';
  if (['rds', 'docdb', 'docdb-instance', 'docdb-subnet-group', 'dynamodb', 'efs', 'ebs'].includes(serviceId)) return 'data';

  const category = serviceById[serviceId]?.category;
  if (category === 'DB' || category === 'Storage') return serviceId === 's3' ? 'edge' : 'data';
  if (category === 'Networking') return 'network';
  if (category === 'Security' && serviceId.includes('security-group')) return 'data';
  return 'compute';
}

export default Canvas;
