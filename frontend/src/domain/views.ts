import { MAX_M, VIEW_AXES, type ViewName, type WorldAxis } from './constants';
import type { Vec3 } from './types';

/**
 * What the cube looks like from each view: which way the camera faces, what the edges are
 * called, and how near a source is to the viewer along the axis the view cannot show.
 *
 * Everything here is derived from `VIEW_AXES`, so the labels can never disagree with the
 * mapping that actually moves the sources.
 */

/** What each end of a world axis is called, `[negative, positive]`. The listener faces −Z. */
export const AXIS_ENDS: Record<WorldAxis, readonly [string, string]> = {
  x: ['Left', 'Right'],
  y: ['Down', 'Up'],
  z: ['Ahead', 'Behind'],
};

export const VIEW_INFO: Record<ViewName, { label: string; looking: string }> = {
  front: { label: 'Front', looking: 'forward' },
  top: { label: 'Top', looking: 'down from above' },
  side: { label: 'Side', looking: 'in from the right' },
};

export interface EdgeLabels {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

/** Names for the cube's four edges in a view: the ends of the two axes it shows. */
export function viewEdgeLabels(view: ViewName): EdgeLabels {
  const v = VIEW_AXES[view];
  const [hNeg, hPos] = AXIS_ENDS[v.sxAxis];
  const [vNeg, vPos] = AXIS_ENDS[v.syAxis];
  // A +1 sign means the world axis grows the way screen coordinates do: rightward, downward.
  return {
    left: v.sxSign > 0 ? hNeg : hPos,
    right: v.sxSign > 0 ? hPos : hNeg,
    top: v.sySign > 0 ? vNeg : vPos,
    bottom: v.sySign > 0 ? vPos : vNeg,
  };
}

function unit(axis: WorldAxis, sign: number): Vec3 {
  return { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * +1 when the locked axis points out of the screen, towards the person looking at it.
 * Right-handed, so out of the screen is screen-right × screen-up.
 */
export function towardViewerSign(view: ViewName): 1 | -1 {
  const v = VIEW_AXES[view];
  const right = unit(v.sxAxis, v.sxSign);
  // Screen y grows downward, so screen-up is the opposite of the vertical sign.
  const up = unit(v.syAxis, -v.sySign);
  return cross(right, up)[v.lockedAxis] > 0 ? 1 : -1;
}

/** 0 on the cube face furthest from the viewer, 1 on the nearest — drives the depth cue. */
export function nearness(p: Vec3, view: ViewName): number {
  const locked = VIEW_AXES[view].lockedAxis;
  return (towardViewerSign(view) * p[locked] + MAX_M) / (2 * MAX_M);
}
