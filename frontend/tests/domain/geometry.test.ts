import { describe, expect, it } from 'vitest';

import { MAX_M, type ViewName } from '@/domain/constants';
import { clamp, clientToOverlay, overlayToWorldAxes, worldToOverlay } from '@/domain/coordinates';
import { isAnimated, keyframeTimes, positionAt, samplePathPolyline } from '@/domain/motion';
import { editTargetId, hiddenFromCube, isShownInCube, isSilenced, soloActive } from '@/domain/tracks';
import type { Track, Vec3 } from '@/domain/types';

describe('worldToOverlay', () => {
  const p: Vec3 = { x: 1, y: 2, z: 3 };

  it('maps X right and Y up in the front view', () => {
    expect(worldToOverlay(p, 'front')).toEqual({ sx: 230, sy: 140 });
  });

  it('maps X right and Z down in the top view', () => {
    expect(worldToOverlay(p, 'top')).toEqual({ sx: 230, sy: 290 });
  });

  it('maps Z left and Y up in the side view', () => {
    expect(worldToOverlay(p, 'side')).toEqual({ sx: 110, sy: 140 });
  });
});

describe('overlayToWorldAxes', () => {
  it('returns only the two axes the view edits', () => {
    expect(overlayToWorldAxes(230, 140, 'front')).toEqual({ x: 1, y: 2 });
    expect(overlayToWorldAxes(230, 290, 'top')).toEqual({ x: 1, z: 3 });
    expect(overlayToWorldAxes(110, 140, 'side')).toEqual({ z: 3, y: 2 });
  });

  it('clamps to the cube', () => {
    expect(overlayToWorldAxes(400, 0, 'front')).toEqual({ x: MAX_M, y: MAX_M });
  });

  it.each<ViewName>(['front', 'top', 'side'])('round-trips through the %s view', (view) => {
    const p: Vec3 = { x: -2.5, y: 4, z: 1.5 };
    const { sx, sy } = worldToOverlay(p, view);
    const back = overlayToWorldAxes(sx, sy, view);
    for (const [axis, value] of Object.entries(back)) {
      expect(value).toBeCloseTo(p[axis as keyof Vec3], 10);
    }
  });
});

describe('clientToOverlay', () => {
  it('scales client pixels into the 400×400 viewBox', () => {
    const svg = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    } as unknown as SVGSVGElement;
    expect(clientToOverlay(svg, 110, 70)).toEqual({ sx: 200, sy: 200 });
  });
});

describe('clamp', () => {
  it('bounds a value on both sides', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('positionAt', () => {
  const line: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ];

  it('needs two keyframes and a positive loop', () => {
    expect(positionAt([line[0]!], 4, 1)).toBeNull();
    expect(positionAt(line, 0, 1)).toBeNull();
  });

  it('interpolates linearly and closes the loop back to the first keyframe', () => {
    expect(positionAt(line, 2, 0.5)!.x).toBeCloseTo(1);
    expect(positionAt(line, 2, 1.5)!.x).toBeCloseTo(1);
    expect(positionAt(line, 2, 2)!.x).toBeCloseTo(0);
  });

  it('keeps a two-keyframe path straight even when smooth is asked for', () => {
    expect(positionAt(line, 2, 0.5, 'smooth')).toEqual(positionAt(line, 2, 0.5, 'linear'));
  });

  it('passes through every keyframe on a smooth path', () => {
    const square: Vec3[] = [
      { x: 3, y: 0, z: 0 },
      { x: 0, y: 1, z: 3 },
      { x: -3, y: 0, z: 0 },
      { x: 0, y: -1, z: -3 },
    ];
    square.forEach((k, i) => {
      const p = positionAt(square, 4, i, 'smooth')!;
      expect(p.x).toBeCloseTo(k.x, 10);
      expect(p.y).toBeCloseTo(k.y, 10);
      expect(p.z).toBeCloseTo(k.z, 10);
    });
  });

  it('clamps spline overshoot to the cube', () => {
    const walls: Vec3[] = [
      { x: 6, y: 0, z: 0 },
      { x: 0, y: 0, z: 6 },
      { x: -6, y: 0, z: 0 },
      { x: 0, y: 0, z: -6 },
    ];
    for (let t = 0; t < 4; t += 0.01) {
      const p = positionAt(walls, 4, t, 'smooth')!;
      expect(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))).toBeLessThanOrEqual(MAX_M);
    }
  });
});

describe('samplePathPolyline', () => {
  const tri: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
  ];

  it('returns the keyframes themselves for a linear path', () => {
    const out = samplePathPolyline(tri, 'linear');
    expect(out).toEqual(tri);
    expect(out).not.toBe(tri);
  });

  it('samples a smooth path at segmentsPerSpan points per keyframe', () => {
    expect(samplePathPolyline(tri, 'smooth', 8)).toHaveLength(24);
  });
});

describe('isAnimated', () => {
  it('needs path mode and at least two keyframes', () => {
    const two = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    expect(isAnimated('path', two)).toBe(true);
    expect(isAnimated('static', two)).toBe(false);
    expect(isAnimated('path', two.slice(0, 1))).toBe(false);
  });
});

describe('cube visibility', () => {
  const t = (over: Partial<Track>): Track =>
    ({ id: 'x', active: true, cubeVisible: true, ...over }) as Track;

  it('shows only active, visible tracks', () => {
    expect(isShownInCube(t({}))).toBe(true);
    expect(isShownInCube(t({ cubeVisible: false }))).toBe(false);
    expect(isShownInCube(t({ active: false }))).toBe(false);
  });

  it('reports hidden tracks, but not inactive ones', () => {
    const hidden = t({ id: 'h', cubeVisible: false });
    const off = t({ id: 'o', active: false, cubeVisible: false });
    expect(hiddenFromCube([t({}), hidden, off])).toEqual([hidden]);
  });
});

describe('keyframeTimes', () => {
  const square = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
  ];

  it('marks each keyframe on every lap that starts inside the project', () => {
    expect(keyframeTimes(square, 4, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('agrees with positionAt: the source is on keyframe j at each marked time', () => {
    for (const [j, t] of keyframeTimes(square, 4, 4).entries()) {
      expect(positionAt(square, 4, t)).toEqual(square[j]);
    }
  });

  it('marks only the first lap when every lap would be too many', () => {
    expect(keyframeTimes(square, 2, 600)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('marks nothing until the path can move', () => {
    expect(keyframeTimes(square.slice(0, 1), 4, 10)).toEqual([]);
  });
});

describe('solo', () => {
  const t = (over: Partial<Track>): Track =>
    ({ id: 'x', active: true, muted: false, soloed: false, ...over }) as Track;

  it('is on only while an active track is soloed', () => {
    expect(soloActive([t({}), t({ soloed: true })])).toBe(true);
    expect(soloActive([t({}), t({ soloed: true, active: false })])).toBe(false);
  });

  it('silences muted tracks, and unsoloed ones while a solo is on', () => {
    expect(isSilenced(t({}), false)).toBe(false);
    expect(isSilenced(t({ muted: true }), false)).toBe(true);
    expect(isSilenced(t({}), true)).toBe(true);
    expect(isSilenced(t({ soloed: true }), true)).toBe(false);
    // Mute wins over solo, as on a mixing desk.
    expect(isSilenced(t({ soloed: true, muted: true }), true)).toBe(true);
    expect(isSilenced(t({ active: false }), false)).toBe(true);
  });
});

describe('editTargetId', () => {
  const t = (id: string, active = true): Track => ({ id, active }) as Track;
  const tracks = [t('a'), t('b'), t('c'), t('off', false)];
  const region = (trackId: string) => ({ trackId, startSeconds: 1, endSeconds: 3 });

  it('is the selected track, even when a time selection sits on another lane', () => {
    // Copy on a, then pick the empty track c to paste into.
    expect(editTargetId(tracks, 'c', region('a'))).toBe('c');
  });

  it('falls back to the selection, then the first active track', () => {
    expect(editTargetId(tracks, null, region('b'))).toBe('b');
    expect(editTargetId(tracks, 'off', null)).toBe('a');
    expect(editTargetId([t('off', false)], null, null)).toBeNull();
  });
});
