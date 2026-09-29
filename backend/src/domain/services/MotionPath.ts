import {
  AUTOMATION_MIN_SAMPLES,
  AUTOMATION_TIMESTEP_SECONDS,
} from '../constants';
import { clampToCube, lerpVec3, type Vec3 } from '../value-objects/Vec3';

/**
 * Keyframe path evaluation — the exact interpolation the prototype uses in two places:
 *
 *   `applyMotion(ch)`            (live preview, per animation frame)
 *   `renderMixdown(duration)`    (offline, sampled onto a value curve)
 *
 * Both compute:
 *   phase = (t % loopSeconds) / loopSeconds
 *   segF  = phase * n
 *   i0    = floor(segF) % n, i1 = (i0 + 1) % n
 *   frac  = segF - floor(segF)
 *   pos   = lerp(path[i0], path[i1], frac)
 *
 * Note `i1` wraps with `% n`, so the path is a *closed* loop: the last keyframe interpolates
 * back to the first. That matches the UI, which draws the path as an SVG `<polygon>`.
 */

/**
 * How keyframes are joined.
 *
 *  - `linear` reproduces the prototype exactly: straight segments between keyframes.
 *  - `smooth` runs a closed Catmull-Rom spline through them, so an orbit sounds like an orbit
 *    instead of a polygon. The curve still passes through every keyframe.
 */
export type PathInterpolation = 'linear' | 'smooth';

/** A path only animates once it has at least two keyframes; the prototype guards `n < 2`. */
export function isAnimated(path: readonly Vec3[]): boolean {
  return path.length >= 2;
}

/**
 * Position of a source at absolute time `timeSeconds` along its keyframe loop.
 * Returns `undefined` when the path is too short to animate, matching the prototype's
 * early `return` in `applyMotion`.
 */
export function positionAt(
  path: readonly Vec3[],
  loopSeconds: number,
  timeSeconds: number,
  interpolation: PathInterpolation = 'linear',
): Vec3 | undefined {
  const n = path.length;
  if (n < 2 || loopSeconds <= 0) return undefined;

  const phase = (timeSeconds % loopSeconds) / loopSeconds;
  const segF = phase * n;
  const i0 = Math.floor(segF) % n;
  const i1 = (i0 + 1) % n;
  const frac = segF - Math.floor(segF);

  // `i0`/`i1` are always in range because of the `% n`, but the compiler cannot prove it.
  const p0 = path[i0]!;
  const p1 = path[i1]!;

  // Two keyframes cannot define a curve — the spline's tangents would collapse onto the same
  // line — so a 2-point path stays linear whatever the setting says.
  if (interpolation === 'linear' || n < 3) {
    return lerpVec3(p0, p1, frac);
  }

  const before = path[(i0 - 1 + n) % n]!;
  const after = path[(i1 + 1) % n]!;

  /*
   * Catmull-Rom overshoots: the curve can bulge past its control points, so a spline through
   * keyframes that are all legally inside the cube can still leave it (measured at 6.06 m for
   * a path hugging the ±6 m walls). The cube's half-extent is a domain invariant, so the
   * result is clamped back into it — the alternative is a source that renders outside the
   * space the UI says it occupies.
   */
  return clampToCube(catmullRom(before, p0, p1, after, frac));
}

/**
 * Uniform Catmull-Rom, evaluated on the segment p1→p2 with p0 and p3 as the neighbouring
 * control points:
 *
 *   q(t) = 0.5 * ( 2·p1
 *                + (−p0 + p2)·t
 *                + (2·p0 − 5·p1 + 4·p2 − p3)·t²
 *                + (−p0 + 3·p1 − 3·p2 + p3)·t³ )
 *
 * At t=0 this is exactly p1 and at t=1 exactly p2, which is what keeps the curve anchored to
 * the user's keyframes — the dots on the cube stay meaningful.
 */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (a: number, b: number, c: number, d: number): number =>
    0.5 *
    (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);

  return {
    x: axis(p0.x, p1.x, p2.x, p3.x),
    y: axis(p0.y, p1.y, p2.y, p3.y),
    z: axis(p0.z, p1.z, p2.z, p3.z),
  };
}

export interface AutomationCurves {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Number of grid points; equals each array's length. */
  readonly sampleCount: number;
}

/**
 * Samples a keyframe path onto the three Float32Array position curves that get handed to
 * `AudioParam.setValueCurveAtTime(curve, 0, duration)`.
 *
 * Grid matches the prototype exactly:
 *   const dt = 0.05;
 *   const numSamples = Math.max(2, Math.ceil(duration/dt));
 *   const t = s * dt;
 *
 * Note the prototype samples at `t = s*dt` while stretching the curve across `duration`
 * seconds. When `duration` is not an exact multiple of `dt`, the curve is very slightly
 * time-scaled versus the live preview. That is reproduced rather than corrected, so server
 * renders match what the user heard.
 */
export function sampleAutomationCurves(
  path: readonly Vec3[],
  loopSeconds: number,
  durationSeconds: number,
  interpolation: PathInterpolation = 'linear',
): AutomationCurves | undefined {
  if (!isAnimated(path)) return undefined;

  const sampleCount = Math.max(
    AUTOMATION_MIN_SAMPLES,
    Math.ceil(durationSeconds / AUTOMATION_TIMESTEP_SECONDS),
  );

  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  const z = new Float32Array(sampleCount);

  for (let s = 0; s < sampleCount; s++) {
    const t = s * AUTOMATION_TIMESTEP_SECONDS;
    const p = positionAt(path, loopSeconds, t, interpolation)!;
    x[s] = p.x;
    y[s] = p.y;
    z[s] = p.z;
  }

  return { x, y, z, sampleCount };
}
