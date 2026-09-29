import { z } from 'zod';

import {
  DEFAULT_LOOP_SECONDS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_TRACK_TEMPO,
  MAX_POSITION_M,
  MAX_PROJECT_SECONDS,
  MAX_SAMPLE_RATE,
  MAX_TRACK_TEMPO,
  MAX_TRACKS,
  MIN_PROJECT_SECONDS,
  MIN_SAMPLE_RATE,
  MIN_TRACK_TEMPO,
} from '@/domain/constants';

/**
 * Wire contract for the render endpoint. Bounds mirror the domain constants so a bad request
 * is rejected at the edge with a useful message instead of failing deeper in the graph.
 */

const axis = z
  .number()
  .finite()
  .min(-MAX_POSITION_M)
  .max(MAX_POSITION_M);

export const Vec3Schema = z.object({
  x: axis,
  y: axis,
  z: axis,
});

export const ClipSchema = z.object({
  id: z.string().min(1).max(64),
  assetId: z.string().uuid(),
  startSeconds: z.number().min(0).max(MAX_PROJECT_SECONDS),
  offsetSeconds: z.number().min(0).max(24 * 60 * 60),
  durationSeconds: z.number().min(0).max(MAX_PROJECT_SECONDS),
  /** Prototype behaviour — the source repeats to fill the clip. */
  loop: z.boolean().default(true),
});

export const TrackSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour.'),
  /** Placed audio on this lane. See `assetId` below for the legacy single-sample form. */
  clips: z.array(ClipSchema).max(512).optional(),
  /**
   * Legacy: one sample looping across the whole project. Kept so a client written against the
   * pre-clip contract still renders identically — it is expanded into a single full-length
   * looping clip below. New clients should send `clips`.
   */
  assetId: z.string().uuid().nullable().default(null),
  muted: z.boolean().default(false),
  volume: z.number().min(0).max(1),
  tempo: z
    .number()
    .min(MIN_TRACK_TEMPO)
    .max(MAX_TRACK_TEMPO)
    .default(DEFAULT_TRACK_TEMPO),
  position: Vec3Schema,
  motionMode: z.enum(['static', 'path']).default('static'),
  path: z.array(Vec3Schema).max(256).default([]),
  pathLoopSeconds: z.number().positive().max(600).default(DEFAULT_LOOP_SECONDS),
  /** Defaults to `linear` so older clients keep prototype-identical behaviour. */
  pathInterpolation: z.enum(['linear', 'smooth']).default('linear'),
});

export const RenderRequestSchema = z.object({
  durationSeconds: z.number().min(MIN_PROJECT_SECONDS).max(MAX_PROJECT_SECONDS),
  masterVolume: z.number().min(0).max(1),
  /**
   * The client pins this to its live `AudioContext.sampleRate` so the downloaded mix matches
   * what it previewed. Absent, the service picks its own default.
   */
  sampleRate: z
    .number()
    .int()
    .min(MIN_SAMPLE_RATE)
    .max(MAX_SAMPLE_RATE)
    .default(DEFAULT_SAMPLE_RATE),
  tracks: z.array(TrackSchema).min(1).max(MAX_TRACKS),
});

export type RenderRequestDto = z.infer<typeof RenderRequestSchema>;
export type TrackDto = z.infer<typeof TrackSchema>;
export type ClipDto = z.infer<typeof ClipSchema>;

/**
 * Resolves a track's audio to clips, accepting either contract.
 *
 * A pre-clip client sends `assetId` and expects that sample to loop across the whole project;
 * that is expressed exactly by a single clip spanning the project with `loop: true`, so the
 * old and new forms render identically rather than merely similarly.
 */
export function clipsFromTrackDto(
  track: TrackDto,
  projectDuration: number,
): ClipDto[] {
  if (track.clips && track.clips.length > 0) return track.clips;

  if (track.assetId) {
    return [
      {
        id: `${track.id}-legacy`,
        assetId: track.assetId,
        startSeconds: 0,
        offsetSeconds: 0,
        durationSeconds: projectDuration,
        loop: true,
      },
    ];
  }

  return [];
}

/** Optional query parameters accepted by the upload endpoint. */
export const UploadQuerySchema = z.object({
  sampleRate: z.coerce
    .number()
    .int()
    .min(MIN_SAMPLE_RATE)
    .max(MAX_SAMPLE_RATE)
    .default(DEFAULT_SAMPLE_RATE),
  peakBuckets: z.coerce.number().int().min(64).max(16384).optional(),
});
