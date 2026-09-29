/**
 * A placed piece of audio on a track's lane.
 *
 * This is what makes multi-track layering possible. The prototype had no such concept — a
 * track was one sample looping across the whole project — so "copy this region and paste it
 * over there" had nowhere to land. A clip carries its own source, its own trim into that
 * source, and its own position on the timeline, which is exactly what a paste target needs.
 *
 * Backwards compatibility: an uploaded sample becomes a single clip at `startSeconds = 0`
 * spanning the project with `loop = true`. That reproduces the prototype's behaviour exactly,
 * so clips are additive rather than a break.
 */
export interface Clip {
  readonly id: string;
  /** Which uploaded sample this clip plays. Clips on one track may reference different ones. */
  readonly assetId: string;
  /** Where the clip begins on the project timeline, in seconds. */
  readonly startSeconds: number;
  /** How far into the source sample the clip begins, in seconds. */
  readonly offsetSeconds: number;
  /** How long the clip occupies the timeline, in seconds (output time, before tempo). */
  readonly durationSeconds: number;
  /** When true the source repeats to fill `durationSeconds`, as the prototype did. */
  readonly loop: boolean;
}

export function clipEndSeconds(clip: Clip): number {
  return clip.startSeconds + clip.durationSeconds;
}

/** Whether any of the clip falls inside the rendered window. */
export function clipIsAudible(clip: Clip, projectDuration: number): boolean {
  return (
    clip.durationSeconds > 0 &&
    clip.startSeconds < projectDuration &&
    clipEndSeconds(clip) > 0
  );
}

/** Distinct asset ids referenced anywhere in a set of clips. */
export function referencedAssetIds(clips: readonly Clip[]): string[] {
  return [...new Set(clips.map((c) => c.assetId))];
}
