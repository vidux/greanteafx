import { MAX_M } from '@/domain/constants';
import { clamp } from '@/domain/coordinates';
import type { Track, Vec3 } from '@/domain/types';

/**
 * Pure maths for the 3D view, kept free of three.js and WebGL so it can be tested on its own.
 *
 * World coordinates are the app's own and map 1:1 onto three.js: X right, Y up, Z behind — the
 * listener sits at the origin facing −Z.
 */

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Where "reset view" puts the camera, as a direction from the listener: behind, to the right and
 * above, looking ahead (−Z) like the Front view, but tilted so depth reads at a glance.
 */
export const HOME_DIRECTION: Vec3 = normalize({ x: 0.55, y: 0.5, z: 1 });

/** Camera distance at 100 % zoom — frames the whole ±6 m cube. */
export const HOME_DISTANCE = 27;

export const FOV_DEGREES = 40;

export function cameraDistance(zoom: number): number {
  return HOME_DISTANCE / zoom;
}

export function clampToCube(p: Vec3): Vec3 {
  return {
    x: clamp(p.x, -MAX_M, MAX_M),
    y: clamp(p.y, -MAX_M, MAX_M),
    z: clamp(p.z, -MAX_M, MAX_M),
  };
}

/**
 * Where a click drops a keyframe in the 3D view: along the click's ray, on the plane that faces
 * the camera through `anchor` (the path's last keyframe, or the source). One click cannot say how
 * deep to go, so it keeps the anchor's depth — the 3D counterpart of the 2D views carrying the
 * hidden axis over. Null when the ray runs along the plane or away from it.
 */
export function dropOnViewPlane(
  origin: Vec3,
  direction: Vec3,
  anchor: Vec3,
  viewNormal: Vec3,
): Vec3 | null {
  const denom = dot(direction, viewNormal);
  if (Math.abs(denom) < 1e-9) return null;
  const t =
    dot({ x: anchor.x - origin.x, y: anchor.y - origin.y, z: anchor.z - origin.z }, viewNormal) /
    denom;
  if (t < 0) return null;
  return clampToCube({
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  });
}

export type GizmoTarget = { kind: 'source' } | { kind: 'keyframe'; index: number } | null;

/**
 * What the move arrows attach to for the selected track. A static source moves itself; a source
 * on a path is driven by its keyframes, so the arrows go on the keyframe picked in the view —
 * the same split as the flat views, where a path-mode dot cannot be dragged either.
 */
export function gizmoTarget(track: Track | null, keyframe: number | null): GizmoTarget {
  if (!track || !track.active || !track.cubeVisible) return null;
  if (track.motionMode !== 'path') return { kind: 'source' };
  return keyframe !== null && keyframe < track.path.length ? { kind: 'keyframe', index: keyframe } : null;
}

/** Straight-line distance from the listener, for the labels. */
export function distanceFromListener(p: Vec3): number {
  return Math.hypot(p.x, p.y, p.z);
}
