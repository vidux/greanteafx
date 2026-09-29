import { describe, expect, it } from 'vitest';

import {
  cameraDistance,
  clampToCube,
  distanceFromListener,
  dropOnViewPlane,
  gizmoTarget,
  HOME_DIRECTION,
  HOME_DISTANCE,
} from '@/cube3d/geometry';
import type { Track } from '@/domain/types';
import { createInitialTracks } from '@/store/projectStore';

describe('home camera', () => {
  it('sits behind, right of and above the listener, looking ahead like the Front view', () => {
    const { x, y, z } = HOME_DIRECTION;
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
  });

  it('zooms by moving closer', () => {
    expect(cameraDistance(1)).toBe(HOME_DISTANCE);
    expect(cameraDistance(2)).toBe(HOME_DISTANCE / 2);
  });
});

describe('dropOnViewPlane', () => {
  // A camera on +Z looking down −Z; the plane through the anchor faces it.
  const origin = { x: 0, y: 0, z: 20 };
  const normal = { x: 0, y: 0, z: -1 };
  const anchor = { x: 5, y: 3, z: 2 };

  it('lands where the ray meets the plane, at the anchor’s depth', () => {
    expect(dropOnViewPlane(origin, { x: 0.1, y: 0, z: -1 }, anchor, normal)).toEqual({ x: 1.8, y: 0, z: 2 });
  });

  it('keeps the drop inside the cube', () => {
    expect(dropOnViewPlane(origin, { x: 1, y: 0, z: -1 }, anchor, normal)).toEqual({ x: 6, y: 0, z: 2 });
  });

  it('gives up on a ray along the plane or pointing away from it', () => {
    expect(dropOnViewPlane(origin, { x: 1, y: 0, z: 0 }, anchor, normal)).toBeNull();
    expect(dropOnViewPlane(origin, { x: 0, y: 0, z: 1 }, anchor, normal)).toBeNull();
  });
});

describe('gizmoTarget', () => {
  const base = createInitialTracks()[0]!;
  const onPath: Track = {
    ...base,
    motionMode: 'path',
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  };

  it('puts the arrows on a static source', () => {
    expect(gizmoTarget(base, null)).toEqual({ kind: 'source' });
  });

  it('on a path, only on a picked keyframe that still exists', () => {
    expect(gizmoTarget(onPath, null)).toBeNull();
    expect(gizmoTarget(onPath, 1)).toEqual({ kind: 'keyframe', index: 1 });
    expect(gizmoTarget(onPath, 2)).toBeNull();
  });

  it('never on a hidden or removed track', () => {
    expect(gizmoTarget({ ...base, cubeVisible: false }, null)).toBeNull();
    expect(gizmoTarget({ ...base, active: false }, null)).toBeNull();
    expect(gizmoTarget(null, null)).toBeNull();
  });
});

describe('small helpers', () => {
  it('clamp each axis to ±6 m and measure from the listener', () => {
    expect(clampToCube({ x: 9, y: -7, z: 2 })).toEqual({ x: 6, y: -6, z: 2 });
    expect(distanceFromListener({ x: 3, y: 4, z: 0 })).toBe(5);
  });
});
