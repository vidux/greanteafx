import { describe, expect, it } from 'vitest';

import { LABEL_GAP, LABEL_HEIGHT, layoutLabels, type LabelAnchor } from '@/lib/labelLayout';

const anchor = (id: string, x: number, y: number, over: Partial<LabelAnchor> = {}): LabelAnchor => ({
  id,
  x,
  y,
  r: 10,
  width: 40,
  ...over,
});

describe('layoutLabels', () => {
  it('puts a label just right of its dot, centred on it', () => {
    expect(layoutLabels([anchor('a', 100, 50)], 400)).toEqual([
      { id: 'a', x: 100 + 10 + LABEL_GAP, y: 50, flip: false },
    ]);
  });

  it('flips to the left of the dot when the label would run off the cube', () => {
    const [p] = layoutLabels([anchor('a', 370, 50)], 400);
    expect(p).toEqual({ id: 'a', x: 370 - 10 - LABEL_GAP, y: 50, flip: true });
  });

  it('never covers another dot: a crowded row sends the label to the other side', () => {
    // b sits where a's label would go on the right.
    const [a] = layoutLabels([anchor('a', 100, 200), anchor('b', 130, 200)], 400);
    expect(a!.flip).toBe(true);
    expect(a!.y).toBe(200);
  });

  it('moves a row down, then up, when both sides are taken', () => {
    const [a] = layoutLabels(
      [anchor('a', 100, 200), anchor('left', 70, 200), anchor('right', 130, 200)],
      400,
    );
    expect(a).toMatchObject({ y: 200 + LABEL_HEIGHT, flip: false });
  });

  it('keeps clear of obstacles such as the listener', () => {
    const [a] = layoutLabels([anchor('a', 100, 200)], 400, [
      { left: 110, right: 150, top: 190, bottom: 210 },
    ]);
    expect(a!.flip).toBe(true);
  });

  it('does not stack two labels on top of each other', () => {
    const placed = layoutLabels([anchor('a', 100, 50), anchor('b', 100, 60, { r: 4 })], 400);
    const [a, b] = placed;
    expect(Math.abs(a!.y - b!.y) >= LABEL_HEIGHT || a!.flip !== b!.flip).toBe(true);
  });

  it('keeps labels inside a view that is wider than it is tall', () => {
    // Both sides are taken and the row below would leave the 100 px tall view, so it goes up.
    const [a] = layoutLabels([anchor('a', 100, 80), anchor('b', 130, 80), anchor('c', 70, 80)], 400, [], 100);
    expect(a).toMatchObject({ y: 80 - LABEL_HEIGHT, flip: false });
  });

  it('falls back to pushing below earlier labels when nothing is free', () => {
    // A column of dots so dense no candidate spot is clear.
    const dense = Array.from({ length: 12 }, (_, i) => anchor(`d${i}`, 30 + (i % 3) * 20, 100 + Math.floor(i / 3) * 12, { r: 8 }));
    const placed = layoutLabels(dense, 120);
    expect(placed).toHaveLength(12);
    expect(new Set(placed.map((p) => `${p.x},${p.y}`)).size).toBe(12);
  });
});
