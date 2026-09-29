/**
 * Ruler tick spacing in seconds. Prototype `pickInterval()` — keeps the tick count roughly
 * constant as the project gets longer.
 */
export function pickInterval(projectDuration: number): number {
  if (projectDuration <= 20) return 2;
  if (projectDuration <= 60) return 5;
  if (projectDuration <= 180) return 15;
  return 30;
}

/** Prototype `updateDurationOut()` — m:ss. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Transport clock, m:ss.t — the playhead readout. Floors rather than rounds, so a running clock
 * never shows a second it has not reached yet.
 */
export function formatClock(seconds: number): string {
  // The epsilon absorbs float noise such as 1.2 * 10 = 11.999…
  const tenths = Math.floor(Math.max(0, seconds) * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

/** A clip length for a label: `30s`, `2.5s`, `2.25s`. */
export function formatSpan(seconds: number): string {
  return `${Number(seconds.toFixed(2))}s`;
}

/** A coordinate in metres, one decimal, with a true minus sign and never "−0.0". */
export function formatMetres(value: number): string {
  // Rounds the magnitude: Math.round takes halves up, which would show −1.25 as −1.2.
  const magnitude = Math.round(Math.abs(value) * 10) / 10;
  return `${value < 0 && magnitude > 0 ? '−' : ''}${magnitude.toFixed(1)}`;
}
