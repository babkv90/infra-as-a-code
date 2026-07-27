import { edgeResolvableFieldsForService } from './resourceRegistry.js';

export function buildRelationshipGraph(nodes = [], edges = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const relationships = [];
  const seen = new Set();

  for (const node of nodes) {
    const parentId = node.data?.infrastructure?.parentId ?? node.parentNode;
    if (!parentId || !nodeById.has(parentId)) continue;
    addRelationship(relationships, seen, {
      id: `contains-${parentId}-${node.id}`,
      sourceResourceId: parentId,
      targetResourceId: node.id,
      relationshipType: 'contains',
    });
  }

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    addRelationship(relationships, seen, {
      id: `edge-${edge.id}`,
      sourceResourceId: edge.source,
      targetResourceId: edge.target,
      relationshipType: inferRelationshipType(source, target, edge),
      edgeId: edge.id,
    });
  }

  return relationships;
}

export function validateRelationshipGraph(nodes = [], edges = []) {
  const issues = [];
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ edgeId: edge.id, severity: 'error', message: 'Connection references a node that no longer exists in the diagram.' });
    }
  }

  const relationships = buildRelationshipGraph(nodes, edges);
  for (const cycle of findCycles(relationships)) {
    issues.push({
      nodeId: cycle[0],
      severity: 'error',
      message: `Relationship cycle detected: ${cycle.join(' -> ')}. Break the circular dependency before deployment.`,
    });
  }

  for (const relationship of relationships) {
    const target = nodes.find((node) => node.id === relationship.targetResourceId);
    if (relationship.relationshipType === 'contains' && target?.type === 'groupBox') {
      issues.push({ nodeId: target.id, severity: 'warning', message: 'Nested boundaries are not fully semantic yet; keep VPC, AZ, and subnet nesting shallow for now.' });
    }
  }

  return issues;
}

function inferRelationshipType(source, target, edge) {
  const sourceService = source.data?.serviceId;
  const targetService = target.data?.serviceId;
  const targetResolvable = edgeResolvableFieldsForService(targetService);
  const sourceResolvable = edgeResolvableFieldsForService(sourceService);

  if (sourceService && Object.values(targetResolvable).includes(sourceService)) return targetService === 'subnet' ? 'contains' : 'attached_to';
  if (targetService && Object.values(sourceResolvable).includes(targetService)) return sourceService === 'subnet' ? 'contains' : 'attached_to';
  if (sourceService === 'route' || targetService === 'route') return 'routes_to';
  if (sourceService === 'lb-listener' || targetService === 'lb-listener' || sourceService === 'lb-target-group' || targetService === 'lb-target-group') return 'targets';
  if (edge.data?.connectionType === 'security') return 'attached_to';
  return 'depends_on';
}

function addRelationship(relationships, seen, relationship) {
  const key = `${relationship.sourceResourceId}:${relationship.targetResourceId}:${relationship.relationshipType}`;
  if (seen.has(key)) return;
  seen.add(key);
  relationships.push(relationship);
}

function findCycles(relationships) {
  const graph = new Map();
  for (const relationship of relationships) {
    if (relationship.relationshipType === 'contains') continue;
    graph.set(relationship.sourceResourceId, [...(graph.get(relationship.sourceResourceId) ?? []), relationship.targetResourceId]);
  }

  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      const index = stack.indexOf(nodeId);
      if (index >= 0) cycles.push([...stack.slice(index), nodeId]);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const next of graph.get(nodeId) ?? []) visit(next);
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of graph.keys()) visit(nodeId);
  return cycles;
}
