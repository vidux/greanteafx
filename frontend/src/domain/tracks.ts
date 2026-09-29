import type { Selection, Track } from './types';

/**
 * Track predicates shared by the cube, the timeline, the preview and the render request.
 *
 * "Drawn in the cube" is asked in two places — the overlay, to decide what to render, and the
 * cube panel, to report what is missing. Two copies of that rule could disagree, and the way
 * they would disagree is the worst one available: a source that is hidden *and* not reported,
 * with no way back to it short of reloading. "Silenced" is shared for the same reason: the
 * preview and the exported mix must drop exactly the same tracks.
 */

/** Whether a track's blip and path appear in the cube. Says nothing about whether it sounds. */
export function isShownInCube(track: Track): boolean {
  return track.active && track.cubeVisible;
}

/** Active tracks currently hidden from the cube — exactly what the panel has to announce. */
export function hiddenFromCube(tracks: readonly Track[]): Track[] {
  return tracks.filter((t) => t.active && !t.cubeVisible);
}

/** True when an active track is soloed, which silences every track that is not. */
export function soloActive(tracks: readonly Track[]): boolean {
  return tracks.some((t) => t.active && t.soloed);
}

/** Silent in the mix: off the timeline, muted, or left out by someone else's solo. */
export function isSilenced(track: Track, solo: boolean): boolean {
  return !track.active || track.muted || (solo && !track.soloed);
}

/**
 * The track paste, split and duplicate act on: the selected track, which is the one picked most
 * recently (clicking a lane selects its track too). A time selection left on another lane does
 * not steal the paste — selecting an empty track to paste into has to work.
 */
export function editTargetId(
  tracks: readonly Track[],
  selectedTrackId: string | null,
  selection: Selection | null,
): string | null {
  for (const id of [selectedTrackId, selection?.trackId]) {
    if (id && tracks.some((t) => t.id === id && t.active)) return id;
  }
  return tracks.find((t) => t.active)?.id ?? null;
}
