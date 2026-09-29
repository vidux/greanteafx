import { MAX_POSITION_M } from '../constants';

/** A point in listener-relative world space, in metres. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Prototype: `function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }` */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Clamps each axis to +/-6 m, the cube's half-extent.
 * Prototype `overlayToWorldAxes` clamps with `clamp(..., -MAX_M, MAX_M)`.
 */
export function clampToCube(v: Vec3): Vec3 {
  return {
    x: clamp(v.x, -MAX_POSITION_M, MAX_POSITION_M),
    y: clamp(v.y, -MAX_POSITION_M, MAX_POSITION_M),
    z: clamp(v.z, -MAX_POSITION_M, MAX_POSITION_M),
  };
}

/** Component-wise linear interpolation; `t` is expected in [0,1]. */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
