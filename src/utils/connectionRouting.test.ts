import { describe, expect, it } from 'vitest';
import { getLayerDerivedConnectionSides } from './connectionRouting';

function box(x: number, y: number) {
  return { position: { x, y }, width: 218, height: 124, type: 'awsService' as const };
}

describe('getLayerDerivedConnectionSides', () => {
  it('connects right-to-left across an earlier-to-later layer, regardless of geometry', () => {
    // Deliberately placed geometrically "backwards" (source is to the right of target) — layer order
    // must win over raw position, that's the whole point of Fix 4.
    const sides = getLayerDerivedConnectionSides(0, 1, box(900, 0), box(0, 0));
    expect(sides).toEqual({ sourceSide: 'right', targetSide: 'left' });
  });

  it('connects left-to-right for a later-to-earlier layer', () => {
    const sides = getLayerDerivedConnectionSides(3, 1, box(0, 0), box(900, 0));
    expect(sides).toEqual({ sourceSide: 'left', targetSide: 'right' });
  });

  it('falls back to vertical position for a same-layer pair', () => {
    const below = getLayerDerivedConnectionSides(2, 2, box(0, 0), box(0, 400));
    expect(below).toEqual({ sourceSide: 'bottom', targetSide: 'top' });
    const above = getLayerDerivedConnectionSides(2, 2, box(0, 400), box(0, 0));
    expect(above).toEqual({ sourceSide: 'top', targetSide: 'bottom' });
  });
});
