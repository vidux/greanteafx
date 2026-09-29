import { describe, expect, it } from 'vitest';

import { VIEW_AXES, type ViewName } from '@/domain/constants';
import { worldToOverlay } from '@/domain/coordinates';
import { nearness, towardViewerSign, viewEdgeLabels } from '@/domain/views';

const VIEWS: ViewName[] = ['front', 'top', 'side'];

describe('viewEdgeLabels', () => {
  it('names the edges each view actually shows', () => {
    expect(viewEdgeLabels('front')).toEqual({ left: 'Left', right: 'Right', top: 'Up', bottom: 'Down' });
    expect(viewEdgeLabels('top')).toEqual({ left: 'Left', right: 'Right', top: 'Ahead', bottom: 'Behind' });
    expect(viewEdgeLabels('side')).toEqual({ left: 'Behind', right: 'Ahead', top: 'Up', bottom: 'Down' });
  });

  it.each(VIEWS)('agrees with where the %s view draws a source', (view) => {
    // A source pushed to the right-hand edge must be one the right-hand label names.
    const { sxAxis, sxSign } = VIEW_AXES[view];
    const p = { x: 0, y: 0, z: 0, [sxAxis]: 5 * sxSign };
    expect(worldToOverlay(p, view).sx).toBeGreaterThan(200);
    const ends = { x: ['Left', 'Right'], y: ['Down', 'Up'], z: ['Ahead', 'Behind'] }[sxAxis];
    expect(viewEdgeLabels(view).right).toBe(ends[sxSign > 0 ? 1 : 0]);
  });
});

describe('towardViewerSign', () => {
  it('points out of the screen along the locked axis, right-handed', () => {
    // Front looks forward from behind the listener, top looks down, side looks in from the right.
    expect(VIEWS.map((v) => [VIEW_AXES[v].lockedAxis, towardViewerSign(v)])).toEqual([
      ['z', 1],
      ['y', 1],
      ['x', 1],
    ]);
  });
});

describe('nearness', () => {
  it('runs from 0 on the far face to 1 on the near face', () => {
    expect(nearness({ x: 0, y: 0, z: 6 }, 'front')).toBe(1);
    expect(nearness({ x: 0, y: 0, z: -6 }, 'front')).toBe(0);
    expect(nearness({ x: 0, y: 3, z: 0 }, 'top')).toBe(0.75);
    expect(nearness({ x: 0, y: 0, z: 0 }, 'side')).toBe(0.5);
  });

  it('ignores the two axes the view shows', () => {
    expect(nearness({ x: 6, y: -6, z: 0 }, 'front')).toBe(0.5);
  });
});
