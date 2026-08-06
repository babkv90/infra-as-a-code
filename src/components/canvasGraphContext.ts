import { createContext, useContext } from 'react';
import { noRelationshipBadges, type ObstacleRect, type RelationshipBadgeCounts } from '../utils/graphIndex';

// Two separate contexts on purpose, because they want opposite subscription behaviour.
//
// Badge counts *should* re-render nodes when they change, so the value is the map itself and it is
// memoised on graph structure (not on node positions).
//
// Obstacle rects change on every pointer tick of a drag, but are only read by the one edge that is
// currently showing a label. Exposing them through a getter whose identity never changes means
// consuming them costs no re-renders at all — the edge pulls the current value at render time.

export const RelationshipBadgeContext = createContext<Map<string, RelationshipBadgeCounts>>(new Map());

export function useRelationshipBadges(nodeId: string): RelationshipBadgeCounts {
  return useContext(RelationshipBadgeContext).get(nodeId) ?? noRelationshipBadges();
}

export type EdgeGeometryAccess = { getObstacles: () => ObstacleRect[] };

const emptyGeometry: EdgeGeometryAccess = { getObstacles: () => [] };

export const EdgeGeometryContext = createContext<EdgeGeometryAccess>(emptyGeometry);

export function useEdgeGeometry(): EdgeGeometryAccess {
  return useContext(EdgeGeometryContext);
}
