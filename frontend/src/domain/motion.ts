import { MAX_M } from './constants';
import { clamp } from './coordinates';
import type { PathInterpolation, Vec3 } from './types';

/**
 * Keyframe interpolation — the same function the backend implements, kept in sync by hand
 * because the two services deliberately share no build.
 *
 * Prototype `applyMotion`:
 *   const phase = (audioCtx.currentTime % dur) / dur;
 *   const segF = phase * n;
 *   const i0 = Math.floor(segF) % n, i1 = (i0+1) % n;
 *   const t = segF - Math.floor(segF);
 *   ch.x = p0.x + (p1.x-p0.x)*t;   // etc.
 *
 * `i1` wraps, so the path is a closed loop — the last keyframe eases back to the first.
 */
export function positionAt(
  path: readonly Vec3[],
  loopSeconds: number,
  timeSeconds: number,
  interpolation: PathInterpolation = 'linear',
): Vec3 | null {
  const n = path.length;
  if (n < 2 || loopSeconds <= 0) return null;

  const phase = (timeSeconds % loopSeconds) / loopSeconds;
  const segF = phase * n;
  const i0 = Math.floor(segF) % n;
  const i1 = (i0 + 1) % n;
  const t = segF - Math.floor(segF);

  const p0 = path[i0]!;
  const p1 = path[i1]!;

  // Two keyframes cannot define a curve, so a 2-point path stays linear either way.
  if (interpolation === 'linear' || n < 3) {
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      z: p0.z + (p1.z - p0.z) * t,
    };
  }

  /*
   * Clamped because Catmull-Rom overshoots: a spline through keyframes that all sit legally
   * inside the cube can still bulge outside it. The ±6 m half-extent is a domain invariant,
   * and the backend clamps identically — see `domain/services/MotionPath.ts`.
   */
  return clampToCube(catmullRom(path[(i0 - 1 + n) % n]!, p0, p1, path[(i1 + 1) % n]!, t));
}

/** Per-axis clamp to the cube's ±6 m half-extent. */
function clampToCube(p: Vec3): Vec3 {
  return {
    x: clamp(p.x, -MAX_M, MAX_M),
    y: clamp(p.y, -MAX_M, MAX_M),
    z: clamp(p.z, -MAX_M, MAX_M),
  };
}

/**
 * Uniform Catmull-Rom on the segment p1→p2, with p0/p3 as neighbouring control points.
 * Must stay identical to the backend's copy in `domain/services/MotionPath.ts` — the two
 * services share no build, and a divergence here means preview and render disagree.
 *
 * q(0) = p1 and q(1) = p2 exactly, so the curve passes through every keyframe and the dots on
 * the cube keep meaning what they appear to mean.
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

/**
 * Samples a path into a polyline for drawing. Linear paths need no sampling — their corners
 * are the keyframes — but a spline has to be walked to be drawn.
 */
export function samplePathPolyline(
  path: readonly Vec3[],
  interpolation: PathInterpolation,
  segmentsPerSpan = 12,
): Vec3[] {
  const n = path.length;
  if (n < 2) return [...path];
  if (interpolation === 'linear' || n < 3) return [...path];

  const loop = 1; // Arbitrary; only the phase matters for shape.
  const points: Vec3[] = [];
  const total = n * segmentsPerSpan;
  for (let i = 0; i < total; i++) {
    const p = positionAt(path, loop, (i / total) * loop, 'smooth');
    if (p) points.push(p);
  }
  return points;
}

/** Prototype: automation only engages at two or more keyframes. */
export function isAnimated(
  motionMode: string,
  path: readonly Vec3[],
): boolean {
  return motionMode === 'path' && path.length >= 2;
}

/**
 * When the source passes each keyframe, for markers along its lane: keyframe `j` of `n` is
 * reached `j / n` of the way through every lap. Past `maxMarks` only the first lap is marked,
 * since hundreds of markers would read as a smear rather than as timing.
 */
export function keyframeTimes(
  path: readonly Vec3[],
  loopSeconds: number,
  projectDuration: number,
  maxMarks = 64,
): number[] {
  const n = path.length;
  if (n < 2 || loopSeconds <= 0 || projectDuration <= 0) return [];

  const laps = Math.ceil(projectDuration / loopSeconds);
  const lapsMarked = laps * n > maxMarks ? 1 : laps;
  const times: number[] = [];
  for (let lap = 0; lap < lapsMarked; lap++) {
    for (let j = 0; j < n; j++) {
      const t = (lap + j / n) * loopSeconds;
      if (t < projectDuration) times.push(t);
    }
  }
  return times;
}
