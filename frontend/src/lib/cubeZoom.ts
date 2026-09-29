/** Cube zoom maths, kept free of React so it can be tested on its own. */

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;
/** Each button press zooms by this factor. */
export const ZOOM_STEP = 1.2;
/** Wheel sensitivity: zoom multiplies by e^(-deltaPixels × this). */
const WHEEL_RATE = 0.002;

/**
 * Shift + wheel zooms the cube. Plain Shift + wheel only scrolls sideways, which the cube never
 * needs; Ctrl + wheel and trackpad pinch (reported as Ctrl + wheel) stay with the browser's page
 * zoom, and Alt is left free.
 */
export function isZoomWheel(e: {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
}

/**
 * Wheel deltas arrive in pixels, lines or pages depending on browser and device, and some
 * browsers turn Shift + wheel into horizontal scrolling, so fall back to deltaX.
 */
export function wheelDeltaPixels(deltaY: number, deltaMode: number, deltaX = 0): number {
  const delta = deltaY !== 0 ? deltaY : deltaX;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 400;
  return delta;
}

/** Keeps zoom in range, and never wider than the space the cube has (`fitLimit`). */
export function clampZoom(zoom: number, fitLimit = MAX_ZOOM): number {
  const upper = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitLimit));
  return Math.round(Math.max(MIN_ZOOM, Math.min(upper, zoom)) * 1000) / 1000;
}

/** Scrolling up (negative delta) zooms in, smoothly for both mouse wheels and trackpads. */
export function zoomByWheel(zoom: number, deltaPixels: number, fitLimit?: number): number {
  return clampZoom(zoom * Math.exp(-deltaPixels * WHEEL_RATE), fitLimit);
}

export function zoomByStep(zoom: number, direction: 1 | -1, fitLimit?: number): number {
  return clampZoom(zoom * ZOOM_STEP ** direction, fitLimit);
}

/** Reads a saved zoom level, tolerating anything a user or older build left in storage. */
export function parseSavedZoom(raw: string | null): number {
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? clampZoom(value) : 1;
}
