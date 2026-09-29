import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssetNotFoundError } from '@/domain/errors';
import { FileSystemAudioAssetRepository } from '@/infrastructure/persistence/FileSystemAudioAssetRepository';

const metadata = {
  fileName: 'a.wav',
  contentType: 'audio/wav',
  byteSize: 3,
  durationSeconds: 1,
  sampleRate: 48000,
  channelCount: 2,
  peaks: [-0.5, 0.5],
};

let dir: string;
let repo: FileSystemAudioAssetRepository;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'greanteafx-assets-'));
  repo = new FileSystemAudioAssetRepository(path.join(dir, 'assets'), 60_000);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const save = () =>
  repo.save({ fileName: 'a.wav', contentType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]), metadata });

describe('FileSystemAudioAssetRepository', () => {
  it('stores bytes and metadata under a fresh UUID', async () => {
    const saved = await save();
    expect(saved.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(saved.createdAt)).not.toBeNaN();
    expect(await repo.getMetadata(saved.assetId)).toEqual(saved);
    expect(new Uint8Array(await repo.getBytes(saved.assetId))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reports an unknown asset as not found', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await expect(repo.getMetadata(id)).rejects.toBeInstanceOf(AssetNotFoundError);
    await expect(repo.getBytes(id)).rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it.each(['../../etc/passwd', '..\\..\\secret', 'abc', ''])(
    'refuses a non-UUID id (%j) before touching the disk',
    async (id) => {
      await expect(repo.getBytes(id)).rejects.toBeInstanceOf(AssetNotFoundError);
      await expect(repo.getMetadata(id)).rejects.toBeInstanceOf(AssetNotFoundError);
    },
  );

  it('prunes assets older than the TTL and keeps touched ones', async () => {
    const stale = await save();
    const fresh = await save();
    const old = new Date(Date.now() - 120_000);
    for (const id of [stale.assetId, fresh.assetId]) {
      for (const ext of ['bin', 'json']) await fs.utimes(path.join(dir, 'assets', `${id}.${ext}`), old, old);
    }

    await repo.touch(fresh.assetId);
    await repo.prune();

    await expect(repo.getMetadata(stale.assetId)).rejects.toBeInstanceOf(AssetNotFoundError);
    expect((await repo.getMetadata(fresh.assetId)).assetId).toBe(fresh.assetId);
  });

  it('never throws from touch or prune', async () => {
    await expect(repo.touch('not-a-uuid')).resolves.toBeUndefined();
    await expect(repo.touch('44444444-4444-4444-8444-444444444444')).resolves.toBeUndefined();
    await expect(new FileSystemAudioAssetRepository(path.join(dir, 'missing'), 1).prune()).resolves.toBeUndefined();
  });
});
