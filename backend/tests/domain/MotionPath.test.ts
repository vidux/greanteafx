import { describe, expect, it } from 'vitest';

import { AUTOMATION_TIMESTEP_SECONDS, MAX_POSITION_M } from '@/domain/constants';
import { isAnimated, positionAt, sampleAutomationCurves } from '@/domain/services/MotionPath';
import type { Vec3 } from '@/domain/value-objects/Vec3';

const line: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
];

const orbit: Vec3[] = [
  { x: 3, y: 0, z: 0 },
  { x: 0, y: 1, z: 3 },
  { x: -3, y: 0, z: 0 },
  { x: 0, y: -1, z: -3 },
];

describe('positionAt', () => {
  it('is undefined for a path that cannot animate', () => {
    expect(positionAt([line[0]!], 4, 1)).toBeUndefined();
    expect(positionAt(line, 0, 1)).toBeUndefined();
    expect(isAnimated([line[0]!])).toBe(false);
  });

  it('walks a closed loop linearly', () => {
    expect(positionAt(line, 4, 1)!.x).toBeCloseTo(2);
    expect(positionAt(line, 4, 2)!.x).toBeCloseTo(4);
    expect(positionAt(line, 4, 3)!.x).toBeCloseTo(2);
    expect(positionAt(line, 4, 5)!.x).toBeCloseTo(2);
  });

  it('passes through every keyframe on a smooth path', () => {
    orbit.forEach((k, i) => {
      const p = positionAt(orbit, 4, i, 'smooth')!;
      expect([p.x, p.y, p.z].map((v) => +v.toFixed(9))).toEqual([k.x, k.y, k.z]);
    });
  });

  it('differs from linear between keyframes on a smooth path', () => {
    const smooth = positionAt(orbit, 4, 0.5, 'smooth')!;
    const linear = positionAt(orbit, 4, 0.5, 'linear')!;
    expect(Math.hypot(smooth.x - linear.x, smooth.z - linear.z)).toBeGreaterThan(0.1);
  });

  it('clamps spline overshoot to the cube', () => {
    const walls = orbit.map((p) => ({ x: p.x * 2, y: 0, z: p.z * 2 }));
    for (let t = 0; t < 4; t += 0.01) {
      const p = positionAt(walls, 4, t, 'smooth')!;
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThanOrEqual(MAX_POSITION_M);
    }
  });
});

describe('sampleAutomationCurves', () => {
  it('samples every 50 ms across the project', () => {
    const curves = sampleAutomationCurves(line, 4, 10)!;
    expect(curves.sampleCount).toBe(200);
    expect(curves.x).toBeInstanceOf(Float32Array);
    expect(curves.x).toHaveLength(200);
    const s = 20;
    expect(curves.x[s]).toBeCloseTo(positionAt(line, 4, s * AUTOMATION_TIMESTEP_SECONDS)!.x, 5);
  });

  it('always produces at least two samples', () => {
    expect(sampleAutomationCurves(line, 4, 0.01)!.sampleCount).toBe(2);
  });

  it('is undefined for a static path', () => {
    expect(sampleAutomationCurves([line[0]!], 4, 10)).toBeUndefined();
  });
});
