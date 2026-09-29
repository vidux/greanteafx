import {
  DEFAULT_LOOP_SECONDS,
  DEFAULT_TRACK_TEMPO,
  DEFAULT_TRACK_VOLUME,
} from '../constants';
import { isAnimated, type PathInterpolation } from '../services/MotionPath';
import { clampToCube, type Vec3 } from '../value-objects/Vec3';
import { clipIsAudible, type Clip } from './Clip';

/**
 * `static` pins the source at `position`; `path` loops it through `path[]` over
 * `pathLoopSeconds`. Prototype: `ch.motionMode` is `'static' | 'path'`.
 */
export type MotionMode = 'static' | 'path';

/**
 * One channel of the project: a lane of clips, a colour, a level, and a place in the room.
 *
 * The spatial properties belong to the *track*, not to individual clips — every clip on a
 * track is heard from the same point in space, moving along the same path. That is what makes
 * a track a channel rather than just a row.
 */
export interface Track {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Placed audio on this lane. Empty means the track is silent. */
  readonly clips: readonly Clip[];
  readonly muted: boolean;
  /** 0..1, applied to the per-track gain node. */
  readonly volume: number;
  /** Playback-rate multiplier on every clip's source. 1 = original speed. */
  readonly tempo: number;
  readonly position: Vec3;
  readonly motionMode: MotionMode;
  readonly path: readonly Vec3[];
  readonly pathLoopSeconds: number;
  /** How keyframes are joined: straight segments, or a closed Catmull-Rom spline. */
  readonly pathInterpolation: PathInterpolation;
}

/**
 * Effective gain for a track. Prototype:
 *   `gainNode.gain.value = ch.muted ? 0 : ch.volume;`
 */
export function effectiveGain(track: Track): number {
  return track.muted ? 0 : track.volume;
}

/**
 * Whether this track's panner should be automated rather than pinned.
 * Prototype: `if (ch.motionMode==='path' && ch.path.length>=2)`.
 */
export function usesAutomation(track: Track): boolean {
  return track.motionMode === 'path' && isAnimated(track.path);
}

/** Clips of this track that actually fall inside the rendered window. */
export function audibleClips(track: Track, projectDuration: number): Clip[] {
  return track.clips.filter((c) => clipIsAudible(c, projectDuration));
}

/** Tracks with no audible clip contribute nothing and are skipped by the renderer. */
export function isRenderable(track: Track, projectDuration: number): boolean {
  return audibleClips(track, projectDuration).length > 0;
}

/** Normalises a track so downstream layers can assume every invariant already holds. */
export function normalizeTrack(track: Track): Track {
  return {
    ...track,
    volume: Math.max(0, Math.min(1, track.volume ?? DEFAULT_TRACK_VOLUME)),
    tempo: track.tempo ?? DEFAULT_TRACK_TEMPO,
    position: clampToCube(track.position),
    path: track.path.map(clampToCube),
    pathLoopSeconds: track.pathLoopSeconds || DEFAULT_LOOP_SECONDS,
    pathInterpolation: track.pathInterpolation ?? 'linear',
    clips: (track.clips ?? []).map((c) => ({
      ...c,
      startSeconds: Math.max(0, c.startSeconds),
      offsetSeconds: Math.max(0, c.offsetSeconds),
      durationSeconds: Math.max(0, c.durationSeconds),
    })),
  };
}
