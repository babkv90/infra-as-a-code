import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  MarkerType,
  type NodeChange,
  type XYPosition,
} from 'reactflow';
import { create } from 'zustand';
import { serviceById } from '../data/awsServices';
import type { AwsEdge, AwsEdgeData, AwsNode, DiagramSnapshot, DiagramViewMode, EdgeConnectionType, GroupKind, NodeBinding, ToolMode } from '../types';
import { validateDiagram, type ValidationIssue } from '../utils/validate';

type DiagramStore = {
  nodes: AwsNode[];
  edges: AwsEdge[];
  selectedNodeId?: string;
  selectedEdgeId?: string;
  inspectorNodeId?: string;
  inspectorEdgeId?: string;
  focusNodeIds: string[];
  fitViewVersion: number;
  mode: ToolMode;
  activeView: DiagramViewMode;
  activeRegion: string;
  lastSavedAt?: string;
  isDark: boolean;
  issues: ValidationIssue[];
  history: DiagramSnapshot[];
  future: DiagramSnapshot[];
  clipboard?: DiagramSnapshot;
  setMode: (mode: ToolMode) => void;
  setActiveView: (view: DiagramViewMode) => void;
  setDark: (isDark: boolean) => void;
  toggleDark: () => void;
  setSelection: (nodeId?: string, edgeId?: string) => void;
  setFocusNodeIds: (nodeIds: string[]) => void;
  resetDiagramFocus: () => void;
  openInspector: (nodeId?: string, edgeId?: string) => void;
  closeInspector: () => void;
  addServiceNode: (serviceId: string, position: XYPosition) => void;
  addGroupNode: (kind: GroupKind, position?: XYPosition) => void;
  addLabelNode: (position?: XYPosition) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onEdgeUpdate: (edge: Edge, connection: Connection) => void;
  updateNodeData: (nodeId: string, patch: Partial<AwsNode['data']>) => void;
  updateNodeConfig: (nodeId: string, key: string, value: string | number) => void;
  addNodeBinding: (nodeId: string, binding: Omit<NodeBinding, 'id'>) => void;
  updateNodeBinding: (nodeId: string, bindingId: string, patch: Partial<NodeBinding>) => void;
  deleteNodeBinding: (nodeId: string, bindingId: string) => void;
  updateEdgeData: (edgeId: string, patch: Partial<AwsEdgeData>) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
  validate: () => ValidationIssue[];
  importDiagram: (snapshot: DiagramSnapshot) => void;
  markSaved: () => void;
  checkpoint: () => void;
  attachNodeToContainingGroup: (nodeId: string) => void;
};

const maxHistory = 50;

export const useDiagramStore = create<DiagramStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: undefined,
  inspectorNodeId: undefined,
  inspectorEdgeId: undefined,
  focusNodeIds: [],
  fitViewVersion: 0,
  mode: 'select',
  activeView: 'topology',
  activeRegion: 'ap-south-1',
  isDark: false,
  issues: [],
  history: [],
  future: [],
  setMode: (mode) => set({ mode }),
  setActiveView: (activeView) => set((state) => ({ activeView, selectedNodeId: undefined, selectedEdgeId: undefined, inspectorNodeId: undefined, inspectorEdgeId: undefined, focusNodeIds: [], fitViewVersion: state.fitViewVersion + 1 })),
  setDark: (isDark) => set({ isDark }),
  toggleDark: () => set((state) => ({ isDark: !state.isDark })),
  setSelection: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),
  setFocusNodeIds: (focusNodeIds) => set({ focusNodeIds }),
  resetDiagramFocus: () =>
    set((state) => ({
      focusNodeIds: [],
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      inspectorNodeId: undefined,
      inspectorEdgeId: undefined,
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
      edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      fitViewVersion: state.fitViewVersion + 1,
    })),
  openInspector: (nodeId, edgeId) => set({ inspectorNodeId: nodeId, inspectorEdgeId: edgeId, selectedNodeId: nodeId, selectedEdgeId: edgeId }),
  closeInspector: () => set({ inspectorNodeId: undefined, inspectorEdgeId: undefined }),
  addServiceNode: (serviceId, position) => {
    pushHistory(set, get);
    const node = createNode(serviceId, position);
    set((state) => ({
      nodes: [...state.nodes.map((existing) => ({ ...existing, selected: false })), { ...node, selected: false }],
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      focusNodeIds: [],
    }));
  },
  addGroupNode: (kind, position = { x: 120, y: 120 }) => {
    pushHistory(set, get);
    const node: AwsNode = {
      id: `group-${Date.now()}`,
      type: 'groupBox',
      position,
      width: 520,
      height: 340,
      style: { width: 520, height: 340 },
      zIndex: -1,
      selectable: true,
      draggable: true,
      data: {
        serviceName: kind,
        label: kind,
        region: get().activeRegion,
        arn: '',
        status: 'unknown',
        color: '#2563eb',
        icon: 'BoxSelect',
        subLabel: 'boundary',
        ports: { inputs: [], outputs: [] },
        config: { region: get().activeRegion, status: 'unknown' },
        groupKind: kind,
      },
    };
    set((state) => ({ nodes: [...state.nodes, node], selectedNodeId: node.id, selectedEdgeId: undefined, focusNodeIds: [node.id] }));
  },
  addLabelNode: (position = { x: 240, y: 180 }) => {
    pushHistory(set, get);
    const node: AwsNode = {
      id: `label-${Date.now()}`,
      type: 'labelNode',
      position,
      data: {
        serviceName: 'Label',
        label: 'Architecture note',
        region: get().activeRegion,
        arn: '',
        status: 'unknown',
        color: '#64748b',
        icon: 'Text',
        subLabel: 'annotation',
        ports: { inputs: [], outputs: [] },
        config: {},
      },
    };
    set((state) => ({ nodes: [...state.nodes, node], selectedNodeId: node.id, selectedEdgeId: undefined, focusNodeIds: [node.id] }));
  },
  onNodesChange: (changes) => {
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes) as AwsNode[];
      if (!changes.some((change) => change.type === 'select')) return { nodes };
      const selected = nodes.find((node) => node.selected);
      return { nodes, selectedNodeId: selected?.id ?? state.selectedNodeId };
    });
  },
  onEdgesChange: (changes) => {
    set((state) => {
      const edges = applyEdgeChanges(changes, state.edges) as AwsEdge[];
      if (!changes.some((change) => change.type === 'select')) return { edges };
      const selected = edges.find((edge) => edge.selected);
      return { edges, selectedEdgeId: selected?.id ?? state.selectedEdgeId };
    });
  },
  onConnect: (connection) => {
    pushHistory(set, get);
    const data: AwsEdgeData = inferEdgeData(connection.sourceHandle);
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: `edge-${Date.now()}`,
          type: 'flowEdge',
          animated: data.connectionType === 'event',
          markerEnd: { type: MarkerType.ArrowClosed },
          data,
        },
        state.edges,
      ) as AwsEdge[],
    }));
  },
  onEdgeUpdate: (edge, connection) => {
    pushHistory(set, get);
    set((state) => ({
      edges: state.edges.map((candidate) =>
        candidate.id === edge.id
          ? {
              ...candidate,
              source: connection.source ?? candidate.source,
              sourceHandle: connection.sourceHandle ?? candidate.sourceHandle,
              target: connection.target ?? candidate.target,
              targetHandle: connection.targetHandle ?? candidate.targetHandle,
            }
          : candidate,
      ),
    }));
  },
  updateNodeData: (nodeId, patch) => {
    pushHistory(set, get);
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node)),
    }));
  },
  updateNodeConfig: (nodeId, key, value) => {
    pushHistory(set, get);
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                region: key === 'region' ? String(value) : node.data.region,
                status: key === 'status' && isStatus(value) ? value : node.data.status,
                config: { ...node.data.config, [key]: value },
              },
            }
          : node,
      ),
      activeRegion: key === 'region' ? String(value) : state.activeRegion,
    }));
  },
  addNodeBinding: (nodeId, binding) => {
    pushHistory(set, get);
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                bindings: [
                  ...(node.data.bindings ?? []),
                  {
                    ...binding,
                    id: `binding-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                  },
                ],
              },
            }
          : node,
      ),
    }));
  },
  updateNodeBinding: (nodeId, bindingId, patch) => {
    pushHistory(set, get);
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                bindings: (node.data.bindings ?? []).map((binding) =>
                  binding.id === bindingId
                    ? {
                        ...binding,
                        ...patch,
                        source: patch.source ? { ...binding.source, ...patch.source } : binding.source,
                      }
                    : binding,
                ),
              },
            }
          : node,
      ),
    }));
  },
  deleteNodeBinding: (nodeId, bindingId) => {
    pushHistory(set, get);
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                bindings: (node.data.bindings ?? []).filter((binding) => binding.id !== bindingId),
              },
            }
          : node,
      ),
    }));
  },
  updateEdgeData: (edgeId, patch) => {
    pushHistory(set, get);
    set((state) => ({
      edges: state.edges.map((edge) =>
        edge.id === edgeId
          ? {
              ...edge,
              animated: patch.connectionType ? patch.connectionType === 'event' : edge.animated,
              data: { ...edge.data, ...patch } as AwsEdgeData,
            }
          : edge,
      ),
    }));
  },
  duplicateSelection: () => {
    const { selectedNodeId, nodes } = get();
    const node = nodes.find((candidate) => candidate.id === selectedNodeId);
    if (!node) return;
    pushHistory(set, get);
    const copy = {
      ...node,
      id: `${node.id}-copy-${Date.now()}`,
      position: { x: node.position.x + 48, y: node.position.y + 48 },
      selected: true,
      data: { ...node.data, label: `${node.data.label} copy` },
    };
    set((state) => ({ nodes: [...state.nodes.map((item) => ({ ...item, selected: false })), copy], selectedNodeId: copy.id }));
  },
  deleteSelection: () => {
    const { selectedNodeId, selectedEdgeId, nodes, edges } = get();
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected || node.id === selectedNodeId).map((node) => node.id));
    const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected || edge.id === selectedEdgeId).map((edge) => edge.id));

    if (!selectedNodeIds.size && !selectedEdgeIds.size) return;

    pushHistory(set, get);
    set((state) => ({
      nodes: state.nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges: state.edges.filter((edge) => !selectedEdgeIds.has(edge.id) && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)),
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      inspectorNodeId: undefined,
      inspectorEdgeId: undefined,
      focusNodeIds: [],
    }));
  },
  copySelection: () => {
    const { selectedNodeId, selectedEdgeId, nodes, edges } = get();
    const selectedNodes = selectedNodeId ? nodes.filter((node) => node.id === selectedNodeId) : nodes.filter((node) => node.selected);
    const selectedEdges = selectedEdgeId ? edges.filter((edge) => edge.id === selectedEdgeId) : edges.filter((edge) => edge.selected);
    set({ clipboard: { nodes: selectedNodes, edges: selectedEdges } });
  },
  pasteClipboard: () => {
    const { clipboard } = get();
    if (!clipboard || clipboard.nodes.length === 0) return;
    pushHistory(set, get);
    const idMap = new Map<string, string>();
    const nodes = clipboard.nodes.map((node) => {
      const id = `${node.id}-paste-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 72, y: node.position.y + 72 }, selected: true };
    });
    const edges = clipboard.edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({ ...edge, id: `${edge.id}-paste-${Date.now()}`, source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    set((state) => ({
      nodes: [...state.nodes.map((node) => ({ ...node, selected: false })), ...nodes],
      edges: [...state.edges, ...edges],
      selectedNodeId: nodes[0]?.id,
      selectedEdgeId: undefined,
      focusNodeIds: nodes.map((node) => node.id),
    }));
  },
  selectAll: () => {
    set((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: true })),
      edges: state.edges.map((edge) => ({ ...edge, selected: true })),
      selectedNodeId: state.nodes[0]?.id,
      selectedEdgeId: undefined,
      focusNodeIds: state.nodes.map((node) => node.id),
    }));
  },
  undo: () => {
    const { history, nodes, edges } = get();
    const previous = history[history.length - 1];
    if (!previous) return;
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      history: history.slice(0, -1),
      future: [{ nodes, edges }, ...get().future].slice(0, maxHistory),
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      inspectorNodeId: undefined,
      inspectorEdgeId: undefined,
      focusNodeIds: [],
      fitViewVersion: get().fitViewVersion + 1,
    });
  },
  redo: () => {
    const { future, nodes, edges, history } = get();
    const next = future[0];
    if (!next) return;
    set({
      nodes: next.nodes,
      edges: next.edges,
      history: [...history, { nodes, edges }].slice(-maxHistory),
      future: future.slice(1),
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      inspectorNodeId: undefined,
      inspectorEdgeId: undefined,
      focusNodeIds: [],
      fitViewVersion: get().fitViewVersion + 1,
    });
  },
  validate: () => {
    const issues = validateDiagram(get().nodes, get().edges);
    set((state) => ({
      issues,
      nodes: state.nodes.map((node) => ({
        ...node,
        data: { ...node.data, warning: issues.find((issue) => issue.nodeId === node.id)?.message },
      })),
    }));
    return issues;
  },
  importDiagram: (snapshot) => {
    pushHistory(set, get);
    set((state) => ({ nodes: snapshot.nodes, edges: snapshot.edges, selectedNodeId: undefined, selectedEdgeId: undefined, inspectorNodeId: undefined, inspectorEdgeId: undefined, focusNodeIds: [], fitViewVersion: state.fitViewVersion + 1 }));
  },
  markSaved: () => set({ lastSavedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
  checkpoint: () => pushHistory(set, get),
  attachNodeToContainingGroup: (nodeId) => {
    const { nodes } = get();
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'groupBox' || node.parentNode) return;
    const group = nodes.find((candidate) => {
      if (candidate.type !== 'groupBox') return false;
      const width = Number(candidate.width ?? candidate.style?.width ?? 520);
      const height = Number(candidate.height ?? candidate.style?.height ?? 340);
      const centerX = node.position.x + Number(node.width ?? 238) / 2;
      const centerY = node.position.y + Number(node.height ?? 130) / 2;
      return centerX >= candidate.position.x && centerX <= candidate.position.x + width && centerY >= candidate.position.y && centerY <= candidate.position.y + height;
    });
    if (!group) return;
    set({
      nodes: nodes.map((candidate) =>
        candidate.id === nodeId
          ? {
              ...candidate,
              parentNode: group.id,
              extent: 'parent',
              position: {
                x: candidate.position.x - group.position.x,
                y: candidate.position.y - group.position.y,
              },
            }
          : candidate,
      ),
    });
  },
}));

function pushHistory(set: (partial: Partial<DiagramStore>) => void, get: () => DiagramStore): void {
  const { nodes, edges, history } = get();
  set({ history: [...history, { nodes, edges }].slice(-maxHistory), future: [] });
}

function createNode(serviceId: string, position: XYPosition, id?: string): AwsNode {
  const service = serviceById[serviceId];
  const nodeId = id ?? `${serviceId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return {
    id: nodeId,
    type: 'awsService',
    position,
    data: {
      serviceId,
      serviceName: service.name,
      label: service.name,
      region: String(service.defaultConfig.region ?? 'ap-south-1'),
      arn: '',
      status: 'unknown',
      color: service.color,
      icon: service.icon,
      subLabel: service.subLabel,
      ports: service.ports,
      config: service.defaultConfig,
    },
  };
}

function inferEdgeData(sourceHandle?: string | null): AwsEdgeData {
  const label = sourceHandle?.toLowerCase().includes('event') ? 'event' : 'data';
  const connectionType: EdgeConnectionType = label === 'event' ? 'event' : 'data';
  return {
    label,
    connectionType,
    protocol: connectionType === 'event' ? 'async' : 'HTTPS',
    port: connectionType === 'event' ? '' : '443',
  };
}

function isStatus(value: string | number): value is 'running' | 'stopped' | 'unknown' {
  return value === 'running' || value === 'stopped' || value === 'unknown';
}
