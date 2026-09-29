import {
  MAX_PROJECT_SECONDS,
  MAX_TRACKS,
  MIN_PROJECT_SECONDS,
} from '../constants';
import { ValidationError } from '../errors';
import { referencedAssetIds } from './Clip';
import { audibleClips, isRenderable, normalizeTrack, type Track } from './Track';

/**
 * The full mixdown job: how long, how loud, and what is in the room.
 * This is the aggregate the render use case consumes.
 */
export interface Project {
  /** Seconds of output to render. Prototype clamps to 3..600. */
  readonly durationSeconds: number;
  /** 0..1 master bus gain. Prototype `masterVol` slider. */
  readonly masterVolume: number;
  /** Render sample rate; the client pins this to its live AudioContext rate. */
  readonly sampleRate: number;
  readonly tracks: readonly Track[];
}

/**
 * Enforces the aggregate's invariants once, at the boundary, so no layer below has to
 * re-check them. Throws {@link ValidationError} on anything unrenderable.
 */
export function normalizeProject(project: Project): Project {
  if (project.tracks.length > MAX_TRACKS) {
    throw new ValidationError(
      `A project may contain at most ${MAX_TRACKS} tracks; received ${project.tracks.length}.`,
    );
  }

  const durationSeconds = Math.max(
    MIN_PROJECT_SECONDS,
    Math.min(MAX_PROJECT_SECONDS, project.durationSeconds),
  );

  const tracks = project.tracks.map(normalizeTrack);

  if (!tracks.some((t) => isRenderable(t, durationSeconds))) {
    // Mirrors the prototype's guard: "NO SAMPLES LOADED — UPLOAD AT LEAST ONE TRACK".
    throw new ValidationError(
      'The project has no audible clips; there is nothing to render.',
    );
  }

  return {
    durationSeconds,
    masterVolume: Math.max(0, Math.min(1, project.masterVolume)),
    sampleRate: project.sampleRate,
    tracks,
  };
}

/** Only tracks that will actually produce sound reach the audio graph builder. */
export function renderableTracks(project: Project): Track[] {
  return project.tracks.filter((t) => isRenderable(t, project.durationSeconds));
}

/**
 * Every distinct sample the project needs decoded. Clips on different tracks routinely share
 * one asset (copy-paste across lanes), so decoding is keyed by asset rather than by track —
 * pasting a region ten times still decodes its source once.
 *
 * Only audible clips count: a clip past the end of the project is never scheduled, so an
 * expired asset under it must not fail the render.
 */
export function projectAssetIds(project: Project): string[] {
  return referencedAssetIds(
    project.tracks.flatMap((t) => audibleClips(t, project.durationSeconds)),
  );
}
