import { describe, expect, it } from 'vitest';

import {
  deserializeProject,
  LEGACY_PROJECT_FILE_FORMAT,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  ProjectFileError,
  serializeProject,
  suggestedFileName,
} from '@/lib/projectFile';
import { createInitialTracks } from '@/store/projectStore';
import type { AudioAsset, Track } from '@/domain/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const asset = (assetId: string, peaks = [-0.123456, 0.654321]): AudioAsset => ({
  assetId,
  fileName: `${assetId.slice(0, 4)}.wav`,
  durationSeconds: 2,
  sampleRate: 48000,
  channelCount: 2,
  peaks,
});

function project(tracks: Track[], assets: Record<string, AudioAsset>) {
  return { projectDuration: 45, masterVolume: 0.5, currentView: 'top' as const, tracks, assets };
}

describe('serializeProject', () => {
  it('writes the format header and every track', () => {
    const file = serializeProject(project(createInitialTracks(), {}));
    expect(file.format).toBe(PROJECT_FILE_FORMAT);
    expect(file.version).toBe(PROJECT_FILE_VERSION);
    expect(file.tracks).toHaveLength(10);
  });

  it('keeps only referenced assets and rounds their peaks', () => {
    const tracks = createInitialTracks();
    tracks[0] = {
      ...tracks[0]!,
      clips: [{ id: 'c', assetId: A, startSeconds: 0, offsetSeconds: 0, durationSeconds: 1, loop: true }],
    };
    const file = serializeProject(project(tracks, { [A]: asset(A), [B]: asset(B) }));
    expect(Object.keys(file.assets)).toEqual([A]);
    expect(file.assets[A]!.peaks).toEqual([-0.1235, 0.6543]);
  });
});

describe('deserializeProject', () => {
  it('round-trips a saved project', () => {
    const tracks = createInitialTracks();
    tracks[1] = {
      ...tracks[1]!,
      clips: [{ id: 'c', assetId: A, startSeconds: 2, offsetSeconds: 1, durationSeconds: 3, loop: false }],
      motionMode: 'path',
      path: [{ x: 1, y: 2, z: 3 }, { x: -1, y: 0, z: 2 }],
      pathInterpolation: 'smooth',
      pathLoopSec: 16,
      muted: true,
      soloed: true,
      cubeVisible: false,
      tempo: 1.5,
    };
    const saved = JSON.parse(JSON.stringify(serializeProject(project(tracks, { [A]: asset(A) }))));
    const loaded = deserializeProject(saved);

    expect(loaded.projectDuration).toBe(45);
    expect(loaded.masterVolume).toBe(0.5);
    expect(loaded.currentView).toBe('top');
    const t = loaded.tracks[1]!;
    expect(t).toMatchObject({
      motionMode: 'path',
      pathInterpolation: 'smooth',
      pathLoopSec: 16,
      muted: true,
      soloed: true,
      cubeVisible: false,
      tempo: 1.5,
      loading: false,
    });
    expect(t.clips[0]).toMatchObject({ assetId: A, startSeconds: 2, offsetSeconds: 1, durationSeconds: 3, loop: false });
    // Ids are regenerated on load so a hand-edited file cannot collide two clips.
    expect(t.clips[0]!.id).not.toBe('c');
  });

  it.each([
    [null, 'not valid JSON object'],
    [{ format: 'other' }, 'Not a GreanTeaFX project'],
    [{ format: PROJECT_FILE_FORMAT, version: PROJECT_FILE_VERSION + 1, tracks: [] }, 'newer'],
    [{ format: PROJECT_FILE_FORMAT, version: 1 }, 'no tracks'],
  ])('rejects %j', (raw, message) => {
    expect(() => deserializeProject(raw)).toThrow(ProjectFileError);
    expect(() => deserializeProject(raw)).toThrow(new RegExp(message));
  });

  it('opens a .sonar file saved before the rename', () => {
    const loaded = deserializeProject({
      format: LEGACY_PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      projectDuration: 20,
      assets: { [A]: asset(A) },
      tracks: [{ id: 'ch-0', clips: [{ id: 'c', assetId: A, startSeconds: 0, offsetSeconds: 0, durationSeconds: 2 }] }],
    });
    expect(loaded.projectDuration).toBe(20);
    expect(loaded.tracks[0]!.clips[0]).toMatchObject({ assetId: A });
  });

  it('migrates a v1 track sample into one full-length looping clip', () => {
    const loaded = deserializeProject({
      format: PROJECT_FILE_FORMAT,
      version: 1,
      projectDuration: 20,
      tracks: [{ id: 'ch-0', asset: asset(A) }],
    });
    expect(loaded.tracks[0]!.clips).toEqual([
      expect.objectContaining({ assetId: A, startSeconds: 0, offsetSeconds: 0, durationSeconds: 20, loop: true }),
    ]);
    expect(loaded.assets[A]).toBeDefined();
  });

  it('defaults missing fields instead of trusting them', () => {
    const loaded = deserializeProject({ format: PROJECT_FILE_FORMAT, version: 2, tracks: [{}] });
    expect(loaded.projectDuration).toBe(30);
    expect(loaded.masterVolume).toBe(0.8);
    expect(loaded.currentView).toBe('front');
    expect(loaded.tracks[0]).toMatchObject({
      id: 'ch-0',
      name: 'CH01',
      active: true,
      pathInterpolation: 'linear',
      motionMode: 'static',
      cubeVisible: true,
      soloed: false,
    });
  });

  it('clamps values the render service would reject', () => {
    const loaded = deserializeProject({
      format: PROJECT_FILE_FORMAT,
      version: 2,
      projectDuration: 9999,
      masterVolume: 7,
      tracks: [
        {
          position: { x: 40, y: -40, z: 3 },
          path: [{ x: 99, y: 0, z: 0 }],
          pathLoopSec: -1,
          tempo: 50,
          volume: -2,
          color: 'red',
          clips: [
            { assetId: A, startSeconds: 5000, offsetSeconds: -3, durationSeconds: 9000 },
            { assetId: A, durationSeconds: 0 },
            { durationSeconds: 3 },
          ],
        },
      ],
    });
    const t = loaded.tracks[0]!;
    expect(loaded.projectDuration).toBe(600);
    expect(loaded.masterVolume).toBe(1);
    expect(t.position).toEqual({ x: 6, y: -6, z: 3 });
    expect(t.path[0]!.x).toBe(6);
    expect(t.pathLoopSec).toBe(8);
    expect(t.tempo).toBe(4);
    expect(t.volume).toBe(0);
    expect(t.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    // Zero-length and asset-less clips are dropped; the rest is clamped.
    expect(t.clips).toHaveLength(1);
    expect(t.clips[0]).toMatchObject({ startSeconds: 600, offsetSeconds: 0, durationSeconds: 600 });
  });

  it('never loads more than the ten-channel pool', () => {
    const loaded = deserializeProject({
      format: PROJECT_FILE_FORMAT,
      version: 2,
      tracks: Array.from({ length: 14 }, () => ({})),
    });
    expect(loaded.tracks).toHaveLength(10);
  });
});

describe('suggestedFileName', () => {
  it('is a filename-safe timestamp with the .gtfx extension', () => {
    expect(suggestedFileName()).toMatch(/^greanteafx-project-\d{4}-\d{2}-\d{2}-\d{4}\.gtfx$/);
  });
});
