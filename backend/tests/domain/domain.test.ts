import { describe, expect, it } from 'vitest';

import { MAX_POSITION_M, MAX_PROJECT_SECONDS, MIN_PROJECT_SECONDS } from '@/domain/constants';
import { clipEndSeconds, clipIsAudible, referencedAssetIds } from '@/domain/entities/Clip';
import {
  normalizeProject,
  projectAssetIds,
  renderableTracks,
  type Project,
} from '@/domain/entities/Project';
import {
  audibleClips,
  effectiveGain,
  isRenderable,
  normalizeTrack,
  usesAutomation,
} from '@/domain/entities/Track';
import { DomainError, ValidationError } from '@/domain/errors';
import { clamp, clampToCube, lerpVec3 } from '@/domain/value-objects/Vec3';
import { channelCount, durationSeconds } from '@/domain/value-objects/PcmAudio';

import { ASSET_A, ASSET_B, ASSET_GONE, clip, sine, track } from '../helpers';

function project(over: Partial<Project> = {}): Project {
  return { durationSeconds: 10, masterVolume: 0.8, sampleRate: 48000, tracks: [track()], ...over };
}

describe('Clip', () => {
  it('ends at start + duration', () => {
    expect(clipEndSeconds(clip({ startSeconds: 2, durationSeconds: 3 }))).toBe(5);
  });

  it('is audible only when some of it falls inside the project', () => {
    expect(clipIsAudible(clip({ startSeconds: 9, durationSeconds: 5 }), 10)).toBe(true);
    expect(clipIsAudible(clip({ startSeconds: 10, durationSeconds: 5 }), 10)).toBe(false);
    expect(clipIsAudible(clip({ durationSeconds: 0 }), 10)).toBe(false);
  });

  it('lists each referenced asset once', () => {
    expect(referencedAssetIds([clip(), clip({ assetId: ASSET_B }), clip()])).toEqual([ASSET_A, ASSET_B]);
  });
});

describe('Track', () => {
  it('muting silences the gain', () => {
    expect(effectiveGain(track({ volume: 0.6 }))).toBe(0.6);
    expect(effectiveGain(track({ muted: true }))).toBe(0);
  });

  it('automates only a path with at least two keyframes', () => {
    const p = { x: 0, y: 0, z: 0 };
    expect(usesAutomation(track({ motionMode: 'path', path: [p, p] }))).toBe(true);
    expect(usesAutomation(track({ motionMode: 'path', path: [p] }))).toBe(false);
    expect(usesAutomation(track({ motionMode: 'static', path: [p, p] }))).toBe(false);
  });

  it('is renderable only with an audible clip', () => {
    const t = track({ clips: [clip({ startSeconds: 50 }), clip({ id: 'c2', startSeconds: 1 })] });
    expect(audibleClips(t, 10).map((c) => c.id)).toEqual(['c2']);
    expect(isRenderable(track({ clips: [clip({ startSeconds: 50 })] }), 10)).toBe(false);
  });

  it('normalises out-of-range values', () => {
    const t = normalizeTrack(
      track({
        volume: 3,
        position: { x: 20, y: -20, z: 1 },
        path: [{ x: 99, y: 0, z: 0 }],
        pathLoopSeconds: 0,
        clips: [clip({ startSeconds: -1, offsetSeconds: -2, durationSeconds: -3 })],
      }),
    );
    expect(t.volume).toBe(1);
    expect(t.position).toEqual({ x: MAX_POSITION_M, y: -MAX_POSITION_M, z: 1 });
    expect(t.path[0]!.x).toBe(MAX_POSITION_M);
    expect(t.pathLoopSeconds).toBe(8);
    expect(t.clips[0]).toMatchObject({ startSeconds: 0, offsetSeconds: 0, durationSeconds: 0 });
  });
});

describe('Project', () => {
  it('clamps duration and master volume', () => {
    expect(normalizeProject(project({ durationSeconds: 1 })).durationSeconds).toBe(MIN_PROJECT_SECONDS);
    expect(normalizeProject(project({ durationSeconds: 9999 })).durationSeconds).toBe(MAX_PROJECT_SECONDS);
    expect(normalizeProject(project({ masterVolume: -1 })).masterVolume).toBe(0);
  });

  it('rejects more than ten tracks', () => {
    const tracks = Array.from({ length: 11 }, (_, i) => track({ id: `t${i}` }));
    expect(() => normalizeProject(project({ tracks }))).toThrow(ValidationError);
  });

  it('rejects a project with nothing audible', () => {
    const tracks = [track({ clips: [clip({ startSeconds: 60 })] })];
    expect(() => normalizeProject(project({ tracks }))).toThrow(/no audible clips/);
  });

  it('keeps only tracks that will make sound', () => {
    const p = normalizeProject(
      project({ tracks: [track({ id: 'on' }), track({ id: 'off', clips: [] })] }),
    );
    expect(renderableTracks(p).map((t) => t.id)).toEqual(['on']);
  });

  it('needs only the assets of audible clips', () => {
    const p = project({
      tracks: [
        track({ clips: [clip(), clip({ id: 'late', assetId: ASSET_GONE, startSeconds: 30 })] }),
        track({ id: 't2', clips: [clip({ assetId: ASSET_B })] }),
      ],
    });
    expect(projectAssetIds(p)).toEqual([ASSET_A, ASSET_B]);
  });
});

describe('Vec3 and PcmAudio', () => {
  it('clamps and interpolates', () => {
    expect(clamp(9, 0, 5)).toBe(5);
    expect(clampToCube({ x: 7, y: -7, z: 0 })).toEqual({ x: 6, y: -6, z: 0 });
    expect(lerpVec3({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: -2 }, 0.5)).toEqual({ x: 1, y: 2, z: -1 });
  });

  it('reports channels and duration', () => {
    const audio = sine(1.5, 48000, 2);
    expect(channelCount(audio)).toBe(2);
    expect(durationSeconds(audio)).toBeCloseTo(1.5);
    expect(durationSeconds({ ...audio, sampleRate: 0 })).toBe(0);
  });
});

describe('errors', () => {
  it('carry a stable code and their class name', () => {
    const error = new ValidationError('bad', { field: 'x' });
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', name: 'ValidationError', details: { field: 'x' } });
  });
});
