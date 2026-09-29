/** Loading-bar maths for `LoadingScreen`, kept free of React so it can be tested on its own. */

export type BootStage = 'fetching' | 'starting' | 'ready' | 'failed';

/** Reaching a milestone lifts the bar to at least this; it never holds the bar back. */
export const FLOOR: Record<BootStage, number> = {
  fetching: 0.06,
  starting: 0.6,
  ready: 1,
  failed: 0,
};

/**
 * Only `ready` may pass this, so the bar never claims to be done early.
 * The trickle is mirrored by the `boot-trickle` keyframes in globals.css — keep in sync.
 */
export const CAP = 0.95;
/** Fraction per second: eases off as the bar fills, but never below a visible crawl. */
export const EASE_PER_SECOND = 0.2;
export const MIN_PER_SECOND = 0.012;

/** Advances the bar by `dtSeconds` of trickle. */
export function trickle(progress: number, dtSeconds: number): number {
  const speed = Math.max(EASE_PER_SECOND * (CAP - progress), MIN_PER_SECOND);
  return Math.min(CAP, progress + speed * Math.max(0, dtSeconds));
}

/** Where the bar should sit after a milestone lands. */
export function liftToStage(progress: number, stage: BootStage): number {
  return Math.max(progress, FLOOR[stage]);
}

/** Horizontal scale from a computed CSS `transform` value, or null when there is none. */
export function scaleXFromTransform(transform: string): number | null {
  const match = /matrix\(([^,]+)/.exec(transform);
  const value = match ? Number.parseFloat(match[1]!) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}
