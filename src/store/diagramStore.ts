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
import type { AwsEdge, AwsEdgeData, AwsNode, ConnectionRelationshipKind, DiagramDetailMode, DiagramSnapshot, DiagramViewMode, EdgeConnectionType, GroupKind, NodeBinding, ToolMode } from '../types';
import { terraformTypeForService } from '../utils/resourceRegistry';
import { sanitizeName } from '../utils/exportTerraform';
import { evaluateConnection, type ConnectionRule } from '../utils/connectionRules';
import { categorizeServicePair } from '../utils/diagramSemantics';
import { normalizeDiagramSnapshot } from '../utils/diagramSchema';
import { exportTerraform } from '../utils/exportTerraform';
import { hasSavedPositions } from '../utils/diagramSemantics';
import { applyElkLayeredLayout, normalizeSemanticEdges } from '../utils/elkLayout';
import { validateGeneratedTerraform } from '../utils/terraformValidation';
import { canContainNode, withTopologySemantics } from '../utils/topologySemantics';
import { validateDiagram, type ValidationIssue } from '../utils/validate';

const WHITEBOARD_MODE_STORAGE_KEY = 'infraflow-whiteboard-mode';
const ARCHITECTURE_VIEW_MODE_STORAGE_KEY = 'infraflow-architecture-view-mode';

function readStoredWhiteboardMode(): boolean {
  try {
    return window.localStorage.getItem(WHITEBOARD_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

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
  detailMode: DiagramDetailMode;
  isolatedNodeId?: string;
  activeRegion: string;
  lastSavedAt?: string;
  // True whenever the diagram has changed since it was last loaded/saved — there's no persist
  // middleware on this store (see markSaved's comment), so this is what lets the UI warn before a
  // refresh/close silently discards everything back to history.length === 0.
  isDirty: boolean;
  // True only when validate() has been run against the diagram exactly as it currently is, with no
  // blocking errors. Any structural edit (see pushHistory) — including undo/redo — clears this back
  // to false, since it went through pushHistory (or, for undo/redo, is cleared explicitly there since
  // those bypass pushHistory). Drives the Deploy button's gate in Toolbar.tsx.
  isValidated: boolean;
  isDark: boolean;
  // Purely a rendering-skin flag — swaps the node/container/edge renderers between the default
  // diagram look and the paper-style "whiteboard" look. Never read by validation, export, or CRUD.
  whiteboardMode: boolean;
  // Another purely-visual skin: a dark, column-laned "architecture diagram" look (Client / Edge-CDN
  // / Network / Load Balancing / Compute / Data / Supporting Services), driven by the same semantic
  // layer/category data already used for the ELK auto-layout and view filtering. Mutually exclusive
  // with whiteboardMode at the setter level — only one skin renders at a time.
  architectureViewMode: boolean;
  issues: ValidationIssue[];
  lastConnection?: LastConnectionSummary;
  history: DiagramSnapshot[];
  future: DiagramSnapshot[];
  clipboard?: DiagramSnapshot;
  setMode: (mode: ToolMode) => void;
  setActiveView: (view: DiagramViewMode) => void;
  setDetailMode: (mode: DiagramDetailMode) => void;
  setDark: (isDark: boolean) => void;
  toggleDark: () => void;
  setWhiteboardMode: (whiteboardMode: boolean) => void;
  toggleWhiteboardMode: () => void;
  setArchitectureViewMode: (architectureViewMode: boolean) => void;
  toggleArchitectureViewMode: () => void;
  setSelection: (nodeId?: string, edgeId?: string) => void;
  setFocusNodeIds: (nodeIds: string[]) => void;
  isolateSelectedPath: () => void;
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
  autoArrange: () => Promise<void>;
  markSaved: () => void;
  checkpoint: () => void;
  attachNodeToContainingGroup: (nodeId: string) => void;
  dismissLastConnection: () => void;
};

/** What the connection just drawn will contribute, shown briefly on the canvas after the drop. */
export type LastConnectionSummary = {
  edgeId: string;
  kind: ConnectionRelationshipKind;
  summary: string;
  /** Terraform assignment this connection resolves, e.g. `vpc_id = aws_vpc.core_vpc.id`. */
  expression?: string;
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
  // Opens showing every node and edge fully interlinked ("All Connections" + "Full Topology") so a
  // freshly loaded or imported diagram never looks broken/disconnected by default. Users can still
  // narrow down to a specific relationship view or detail level from the toolbar.
  activeView: 'dependencies',
  detailMode: 'full-topology',
  isolatedNodeId: undefined,
  activeRegion: 'ap-south-1',
  isDirty: false,
  isValidated: false,
  isDark: false,
  whiteboardMode: readStoredWhiteboardMode(),
  // Deliberately not restored from storage. The builder offers Diagram and Whiteboard only, so a
  // persisted architecture flag from an earlier session would render the compact node with no
  // control on screen to turn it off.
  architectureViewMode: false,
  issues: [],
  history: [],
  future: [],
  setMode: (mode) => set({ mode }),
  setActiveView: (activeView) => set((state) => ({ activeView, selectedEdgeId: undefined, inspectorEdgeId: undefined, fitViewVersion: state.fitViewVersion + 1 })),
  setDetailMode: (detailMode) => set((state) => ({ detailMode, isolatedNodeId: undefined, selectedEdgeId: undefined, inspectorEdgeId: undefined, fitViewVersion: state.fitViewVersion + 1 })),
  setDark: (isDark) => set({ isDark }),
  toggleDark: () => set((state) => ({ isDark: !state.isDark })),
  setWhiteboardMode: (whiteboardMode) => {
    const nextArchitectureViewMode = whiteboardMode ? false : get().architectureViewMode;
    try {
      window.localStorage.setItem(WHITEBOARD_MODE_STORAGE_KEY, String(whiteboardMode));
      window.localStorage.setItem(ARCHITECTURE_VIEW_MODE_STORAGE_KEY, String(nextArchitectureViewMode));
    } catch {
      // Ignore storage failures (private browsing, quota) — the toggle still works for this session.
    }
    set({ whiteboardMode, architectureViewMode: nextArchitectureViewMode });
  },
  toggleWhiteboardMode: () => get().setWhiteboardMode(!get().whiteboardMode),
  setArchitectureViewMode: (architectureViewMode) => {
    const nextWhiteboardMode = architectureViewMode ? false : get().whiteboardMode;
    try {
      window.localStorage.setItem(ARCHITECTURE_VIEW_MODE_STORAGE_KEY, String(architectureViewMode));
      window.localStorage.setItem(WHITEBOARD_MODE_STORAGE_KEY, String(nextWhiteboardMode));
    } catch {
      // Ignore storage failures (private browsing, quota) — the toggle still works for this session.
    }
    set({ architectureViewMode, whiteboardMode: nextWhiteboardMode });
  },
  toggleArchitectureViewMode: () => get().setArchitectureViewMode(!get().architectureViewMode),
  setSelection: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),
  setFocusNodeIds: (focusNodeIds) => set({ focusNodeIds }),
  isolateSelectedPath: () => {
    const selectedNodeId = get().selectedNodeId ?? get().nodes.find((node) => node.selected)?.id;
    if (!selectedNodeId) return;
    set((state) => ({ isolatedNodeId: selectedNodeId, focusNodeIds: [], fitViewVersion: state.fitViewVersion + 1 }));
  },
  resetDiagramFocus: () =>
    set((state) => ({
      focusNodeIds: [],
      isolatedNodeId: undefined,
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
  addGroupNode: (kind, position) => {
    pushHistory(set, get);
    const groupCount = get().nodes.filter((node) => node.type === 'groupBox').length;
    const nextPosition = position ?? {
      x: 120 + (groupCount % 2) * 620,
      y: 120 + Math.floor(groupCount / 2) * 420,
    };
    const node: AwsNode = {
      id: `group-${Date.now()}`,
      type: 'groupBox',
      position: nextPosition,
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
    set((state) => ({ nodes: [...state.nodes, withTopologySemantics(node)], selectedNodeId: node.id, selectedEdgeId: undefined, focusNodeIds: [] }));
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
    set((state) => ({ nodes: [...state.nodes, withTopologySemantics(node)], selectedNodeId: node.id, selectedEdgeId: undefined, focusNodeIds: [node.id] }));
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
    const { nodes } = get();
    const sourceService = nodes.find((node) => node.id === connection.source)?.data.serviceId;
    const targetService = nodes.find((node) => node.id === connection.target)?.data.serviceId;
    const verdict = evaluateConnection(sourceService, targetService);
    if (verdict.status === 'reversed' || verdict.status === 'blocked') return;

    pushHistory(set, get);
    const rule = verdict.status === 'typed' ? verdict.rule : undefined;
    const data = buildEdgeData(sourceService, targetService, rule, connection.sourceHandle);
    const edgeId = `edge-${Date.now()}`;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: edgeId,
          type: 'flowEdge',
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed },
          data,
        },
        state.edges,
      ) as AwsEdge[],
      // Close the loop on the drop: say what the connection will actually write, in the same
      // Terraform address the generator will emit.
      lastConnection: {
        edgeId,
        kind: rule?.kind ?? 'reference',
        summary: rule?.summary ?? 'dependency ordering only',
        expression: rule?.field && sourceNode ? `${rule.field} = ${terraformAddress(sourceNode)}.id` : undefined,
      },
    }));
  },
  dismissLastConnection: () => set({ lastConnection: undefined }),
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
              animated: false,
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
      isValidated: false,
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
      isValidated: false,
    });
  },
  validate: () => {
    const { nodes, edges, activeRegion } = get();
    const issues = [...validateDiagram(nodes, edges, activeRegion), ...validateGeneratedTerraform(exportTerraform(nodes, edges))];
    set((state) => ({
      issues,
      isValidated: !issues.some((issue) => issue.severity === 'error'),
      nodes: state.nodes.map((node) => ({
        ...node,
        data: { ...node.data, warning: issues.find((issue) => issue.nodeId === node.id)?.message },
      })),
    }));
    return issues;
  },
  importDiagram: (snapshot) => {
    pushHistory(set, get);
    const normalized = normalizeDiagramSnapshot(snapshot);
    // Architecture mode's whole point is the semantic column layout, so re-run it for every
    // opened diagram there — even ones with their own saved/template positions — instead of only
    // the position-less-import case the default view relies on.
    const shouldAutoLayout = !hasSavedPositions(normalized.nodes) || get().architectureViewMode;
    const semanticEdges = normalizeSemanticEdges(normalized.edges, normalized.nodes);
    // Loading a diagram (a demo, a template, or the user's own saved one) isn't itself an
    // unsaved change relative to what's on the server, so this clears the isDirty flag pushHistory
    // just set — only edits made *after* this point should count as dirty.
    set((state) => ({ nodes: normalized.nodes, edges: semanticEdges, activeRegion: normalized.activeRegion ?? state.activeRegion, selectedNodeId: undefined, selectedEdgeId: undefined, inspectorNodeId: undefined, inspectorEdgeId: undefined, focusNodeIds: [], isolatedNodeId: undefined, fitViewVersion: state.fitViewVersion + 1, isDirty: false }));
    if (shouldAutoLayout) {
      void applyElkLayeredLayout(normalized.nodes, semanticEdges).then((laidOutNodes) => {
        set((state) => ({
          nodes: laidOutNodes,
          edges: normalizeSemanticEdges(state.edges, laidOutNodes),
          fitViewVersion: state.fitViewVersion + 1,
          isDirty: false,
        }));
      });
    }
  },
  autoArrange: async () => {
    const { nodes, edges } = get();
    if (!nodes.length) return;
    pushHistory(set, get);
    const semanticEdges = normalizeSemanticEdges(edges, nodes);
    const laidOutNodes = await applyElkLayeredLayout(nodes, semanticEdges);
    set({
      nodes: laidOutNodes,
      edges: normalizeSemanticEdges(semanticEdges, laidOutNodes),
      selectedNodeId: undefined,
      selectedEdgeId: undefined,
      inspectorNodeId: undefined,
      inspectorEdgeId: undefined,
      focusNodeIds: [],
      isolatedNodeId: undefined,
      fitViewVersion: get().fitViewVersion + 1,
    });
  },
  markSaved: () => set({ lastSavedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isDirty: false }),
  checkpoint: () => pushHistory(set, get),
  attachNodeToContainingGroup: (nodeId) => {
    const { nodes } = get();
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'groupBox') return;
    const parentNode = node.parentNode ? nodes.find((candidate) => candidate.id === node.parentNode) : undefined;
    const absolutePosition = {
      x: node.position.x + (parentNode?.position.x ?? 0),
      y: node.position.y + (parentNode?.position.y ?? 0),
    };
    const nodeWidth = Number(node.width ?? node.style?.width ?? 238);
    const nodeHeight = Number(node.height ?? node.style?.height ?? 130);
    const centerX = absolutePosition.x + nodeWidth / 2;
    const centerY = absolutePosition.y + nodeHeight / 2;
    const containingBoundaries = nodes
      .filter((candidate) => candidate.type === 'groupBox')
      .map((candidate) => {
        const width = Number(candidate.width ?? candidate.style?.width ?? 520);
        const height = Number(candidate.height ?? candidate.style?.height ?? 340);
        return { node: candidate, width, height, area: width * height };
      })
      .filter(({ node: candidate, width, height }) => centerX >= candidate.position.x && centerX <= candidate.position.x + width && centerY >= candidate.position.y && centerY <= candidate.position.y + height)
      .sort((left, right) => left.area - right.area);

    const group = containingBoundaries.find(({ node: candidate }) => canContainNode(candidate, node))?.node;
    // Dropping into a boundary that can't hold this resource used to fail silently — the node simply
    // stayed unparented with no explanation. Say which rule refused it.
    const refusedBy = group ? undefined : containingBoundaries[0]?.node;
    const warning = refusedBy
      ? `A ${refusedBy.data.groupKind ?? 'boundary'} can't contain ${node.data.serviceName}. Move it out, or use a boundary that accepts this resource.`
      : undefined;

    set({
      nodes: nodes.map((candidate) =>
        candidate.id === nodeId ? withTopologySemantics({
          ...candidate,
          parentNode: group?.id,
          extent: undefined,
          data: { ...candidate.data, warning },
          position: group
            ? {
                x: absolutePosition.x - group.position.x,
                y: absolutePosition.y - group.position.y,
              }
            : absolutePosition,
        }, group) : candidate,
      ),
    });
  },
}));

function pushHistory(set: (partial: Partial<DiagramStore>) => void, get: () => DiagramStore): void {
  const { nodes, edges, history } = get();
  set({ history: [...history, { nodes, edges }].slice(-maxHistory), future: [], isDirty: true, isValidated: false });
}

function createNode(serviceId: string, position: XYPosition, id?: string): AwsNode {
  const service = serviceById[serviceId];
  const nodeId = id ?? `${serviceId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return withTopologySemantics({
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
  });
}

/**
 * Record what a connection actually is, at the moment it is drawn.
 *
 * This used to stamp every new edge with the same payload — 'data-flow' / 'HTTPS' / port 443 —
 * varying only on whether the handle id contained the word "event". The semantic category was then
 * reverse-engineered later by matching substrings against that very default, so a connection's
 * meaning was a guess about a value the builder itself had written.
 */
function buildEdgeData(
  sourceService: string | undefined,
  targetService: string | undefined,
  rule: ConnectionRule | undefined,
  sourceHandle?: string | null,
): AwsEdgeData {
  const isEvent = Boolean(sourceHandle?.toLowerCase().includes('event'));
  const connectionType: EdgeConnectionType = categorizeServicePair(sourceService ?? '', targetService ?? '', { isEvent });

  if (!rule) {
    return {
      // Plain language, not the internal token — this label is the only thing on the canvas telling
      // the user this line carries ordering and nothing else.
      label: 'depends on',
      connectionType: 'dependency',
      protocol: '',
      port: '',
      sourceService,
      targetService,
      relationshipKind: 'reference',
    };
  }

  return {
    label: rule.field ?? rule.summary,
    connectionType,
    protocol: rule.kind === 'resolves' ? 'Terraform' : isEvent ? 'async' : 'HTTPS',
    port: '',
    sourceService,
    targetService,
    resolvesField: rule.field,
    relationshipKind: rule.kind,
    relationshipSummary: rule.summary,
  };
}

function terraformAddress(node: AwsNode): string {
  const type = terraformTypeForService(node.data.serviceId) ?? 'aws_resource';
  return `${type}.${sanitizeName(node.data.label || node.data.serviceName)}`;
}

function isStatus(value: string | number): value is 'running' | 'stopped' | 'unknown' {
  return value === 'running' || value === 'stopped' || value === 'unknown';
}
