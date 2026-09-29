import {
  MAX_M,
  OVERLAY_CENTER,
  RADAR_SCALE,
  VIEW_AXES,
  type ViewName,
} from './constants';
import type { Vec3 } from './types';

/**
 * Flat-overlay coordinate helpers, parameterised by the current cube view.
 * Direct port of `worldToOverlay`, `pointToOverlay` and `overlayToWorldAxes`.
 *
 * The cube itself is a CSS 3D transform used purely as scenery; all hit-testing and dragging
 * happens on a flat 400x400 SVG laid over it, which is why the maths here is 2D. Rotating the
 * cube swaps which two world axes the flat overlay is editing — it never rotates the overlay.
 */

export interface OverlayPoint {
  sx: number;
  sy: number;
}

/** World position -> overlay coordinates for the given view. */
export function worldToOverlay(p: Vec3, view: ViewName): OverlayPoint {
  const v = VIEW_AXES[view];
  return {
    sx: OVERLAY_CENTER + p[v.sxAxis] * v.sxSign * RADAR_SCALE,
    sy: OVERLAY_CENTER + p[v.syAxis] * v.sySign * RADAR_SCALE,
  };
}

/**
 * Overlay coordinates -> the two world-axis values this view edits.
 * The locked third axis is intentionally absent from the result: callers merge this over an
 * existing position so the hidden axis carries over untouched.
 */
export function overlayToWorldAxes(
  sx: number,
  sy: number,
  view: ViewName,
): Partial<Vec3> {
  const v = VIEW_AXES[view];
  const valSx = clamp(((sx - OVERLAY_CENTER) / RADAR_SCALE) * v.sxSign, -MAX_M, MAX_M);
  const valSy = clamp(((sy - OVERLAY_CENTER) / RADAR_SCALE) * v.sySign, -MAX_M, MAX_M);

  return { [v.sxAxis]: valSx, [v.syAxis]: valSy } as Partial<Vec3>;
}

/**
 * Converts a pointer event's client coordinates into the SVG's 400x400 user space.
 * Prototype:
 *   const rect = overlaySvg.getBoundingClientRect();
 *   const px = ((e.clientX-rect.left)/rect.width)*400;
 */
export function clientToOverlay(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): OverlayPoint {
  const rect = svg.getBoundingClientRect();
  return {
    sx: ((clientX - rect.left) / rect.width) * 400,
    sy: ((clientY - rect.top) / rect.height) * 400,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
