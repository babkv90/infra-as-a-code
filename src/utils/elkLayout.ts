import { MarkerType } from 'reactflow';
import type { ELK, ElkNode } from 'elkjs/lib/elk-api';
import type { AwsEdge, AwsNode } from '../types';
import { semanticEdgeCategory, semanticLayerForNode, semanticLayerLabel } from './diagramSemantics';
import { withTopologySemantics } from './topologySemantics';

const nodeWidth = 142;
const nodeHeight = 92;
const layerSpacing = 120;
const verticalSpacing = 60;
const groupPadding = 42;

export async function applyElkLayeredLayout(nodes: AwsNode[], edges: AwsEdge[]): Promise<AwsNode[]> {
  const serviceNodes = nodes.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode');
  const labelNodes = nodes.filter((node) => node.type === 'labelNode');
  if (!serviceNodes.length) return nodes;

  const layoutEdges = edges.filter((edge) => semanticEdgeCategory(edge, nodes) !== 'containment');
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.spacing.nodeNode': String(verticalSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.spacing.edgeNode': '25',
      'elk.padding': '[top=80,left=80,bottom=80,right=80]',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    },
    children: serviceNodes.map((node) => {
      const size = measuredNodeSize(node);
      return {
        id: node.id,
        width: size.width,
        height: size.height,
        layoutOptions: {
          'elk.layered.layering.layerId': String(semanticLayerForNode(node)),
          'elk.portConstraints': 'FIXED_SIDE',
        },
      };
    }),
    edges: layoutEdges
      .filter((edge) => serviceNodes.some((node) => node.id === edge.source) && serviceNodes.some((node) => node.id === edge.target) && edge.source !== edge.target)
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };

  const elk = await getElk();
  const result = await elk.layout(graph);
  const positions = new Map((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]));
  const placedServices = serviceNodes.map((node) => {
    const position = positions.get(node.id) ?? node.position;
    const size = measuredNodeSize(node);
    return withTopologySemantics({
      ...node,
      parentNode: undefined,
      extent: undefined,
      position,
      width: size.width,
      height: size.height,
      style: { ...node.style, width: size.width, height: size.height },
    });
  });

  return [...buildSemanticColumnGroups(placedServices), ...labelNodes, ...placedServices];
}

let elkInstancePromise: Promise<ELK> | undefined;

async function getElk(): Promise<ELK> {
  elkInstancePromise ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  return elkInstancePromise;
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
      connectionType: semanticEdgeCategory(edge, nodes),
    },
  }));
}

function measuredNodeSize(node: AwsNode): { width: number; height: number } {
  const visual = node.data.visual;
  const width = Number(node.width ?? node.style?.width ?? visual?.width ?? nodeWidth);
  const height = Number(node.height ?? node.style?.height ?? visual?.height ?? nodeHeight);
  return {
    width: Number.isFinite(width) ? width : nodeWidth,
    height: Number.isFinite(height) ? height : nodeHeight,
  };
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
