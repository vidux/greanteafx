import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  AssetNotFoundError,
  AudioDecodeError,
  DomainError,
  RenderFailedError,
  ServerBusyError,
  ValidationError,
} from '@/domain/errors';
import { toErrorResponse } from '@/interface/http/errors';
import {
  clipsFromTrackDto,
  RenderRequestSchema,
  TrackSchema,
  UploadQuerySchema,
} from '@/interface/http/schemas';

import { ASSET_A } from '../helpers';

const minimalTrack = {
  id: 't1',
  name: 'CH01',
  color: '#5EE6A0',
  volume: 0.8,
  position: { x: 0, y: 0, z: 0 },
  clips: [{ id: 'c1', assetId: ASSET_A, startSeconds: 0, offsetSeconds: 0, durationSeconds: 2 }],
};

const minimalRequest = { durationSeconds: 30, masterVolume: 0.8, tracks: [minimalTrack] };

describe('RenderRequestSchema', () => {
  it('fills in defaults so older clients keep prototype behaviour', () => {
    const dto = RenderRequestSchema.parse(minimalRequest);
    expect(dto.sampleRate).toBe(48000);
    expect(dto.tracks[0]).toMatchObject({
      muted: false,
      tempo: 1,
      motionMode: 'static',
      path: [],
      pathLoopSeconds: 8,
      pathInterpolation: 'linear',
      assetId: null,
    });
    expect(dto.tracks[0]!.clips![0]!.loop).toBe(true);
  });

  it.each([
    ['a bad colour', { tracks: [{ ...minimalTrack, color: 'green' }] }],
    ['a position outside the cube', { tracks: [{ ...minimalTrack, position: { x: 7, y: 0, z: 0 } }] }],
    ['no tracks', { tracks: [] }],
    ['more than ten tracks', { tracks: Array.from({ length: 11 }, () => minimalTrack) }],
    ['a project that is too short', { durationSeconds: 1 }],
    ['a non-integer sample rate', { sampleRate: 44100.5 }],
    ['a clip id over 64 characters', {
      tracks: [{ ...minimalTrack, clips: [{ ...minimalTrack.clips[0], id: 'x'.repeat(65) }] }],
    }],
    ['an asset id that is not a UUID', {
      tracks: [{ ...minimalTrack, clips: [{ ...minimalTrack.clips[0], assetId: '../../etc/passwd' }] }],
    }],
  ])('rejects %s', (_label, patch) => {
    expect(RenderRequestSchema.safeParse({ ...minimalRequest, ...patch }).success).toBe(false);
  });
});

describe('clipsFromTrackDto', () => {
  it('prefers explicit clips', () => {
    const dto = TrackSchema.parse(minimalTrack);
    expect(clipsFromTrackDto(dto, 30)).toBe(dto.clips);
  });

  it('expands the legacy single asset into one full-length loop', () => {
    const dto = TrackSchema.parse({ ...minimalTrack, clips: undefined, assetId: ASSET_A });
    expect(clipsFromTrackDto(dto, 30)).toEqual([
      { id: 't1-legacy', assetId: ASSET_A, startSeconds: 0, offsetSeconds: 0, durationSeconds: 30, loop: true },
    ]);
  });

  it('returns nothing for a track without audio', () => {
    expect(clipsFromTrackDto(TrackSchema.parse({ ...minimalTrack, clips: [] }), 30)).toEqual([]);
  });
});

describe('UploadQuerySchema', () => {
  it('coerces query-string values', () => {
    expect(UploadQuerySchema.parse({ sampleRate: '44100', peakBuckets: '512' })).toEqual({
      sampleRate: 44100,
      peakBuckets: 512,
    });
  });

  it('rejects out-of-range values', () => {
    expect(UploadQuerySchema.safeParse({ peakBuckets: '8' }).success).toBe(false);
    expect(UploadQuerySchema.safeParse({ sampleRate: '1000' }).success).toBe(false);
  });
});

describe('toErrorResponse', () => {
  it.each([
    [new ValidationError('bad'), 400, 'VALIDATION_ERROR'],
    [new AssetNotFoundError(ASSET_A), 404, 'ASSET_NOT_FOUND'],
    [new AudioDecodeError('nope'), 415, 'AUDIO_DECODE_FAILED'],
    [new RenderFailedError('boom'), 500, 'RENDER_FAILED'],
    [new DomainError('other', 'SOMETHING'), 400, 'SOMETHING'],
  ])('maps %s to HTTP %i', async (error, status, code) => {
    const response = toErrorResponse(error);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it('asks the client to retry when the service is busy', async () => {
    const response = toErrorResponse(new ServerBusyError());
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect((await response.json()).error.code).toBe('SERVER_BUSY');
  });

  it('never lets an error response be cached', () => {
    expect(toErrorResponse(new ValidationError('bad')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports validation issues for a ZodError', async () => {
    const result = z.object({ n: z.number() }).safeParse({ n: 'x' });
    const response = toErrorResponse(result.error);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.details).toHaveLength(1);
  });

  it('hides the details of an unexpected error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = toErrorResponse(new Error('ENOENT: /secret/path'));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    log.mockRestore();
  });
});
