import { describe, expect, it, vi } from 'vitest';

import type { AudioAssetRepository } from '@/application/ports/AudioAssetRepository';
import type { AudioDecoder } from '@/application/ports/AudioDecoder';
import type { SpatialRenderer } from '@/application/ports/SpatialRenderer';
import { IngestAudioAssetUseCase } from '@/application/use-cases/IngestAudioAsset';
import { RenderMixdownUseCase } from '@/application/use-cases/RenderMixdown';
import { AssetNotFoundError, ValidationError } from '@/domain/errors';

import { ASSET_A, ASSET_B, ASSET_GONE, clip, sine, track } from '../helpers';

function fakeRepo(known: string[]) {
  return {
    save: vi.fn(async (input: Parameters<AudioAssetRepository['save']>[0]) => ({
      ...input.metadata,
      assetId: ASSET_A,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    getMetadata: vi.fn(),
    getBytes: vi.fn(async (id: string) => {
      if (!known.includes(id)) throw new AssetNotFoundError(id);
      return new Uint8Array([1]);
    }),
    touch: vi.fn(async (_id: string) => {}),
    prune: vi.fn(async () => {}),
  } satisfies AudioAssetRepository;
}

const fakeDecoder = (): AudioDecoder & { decode: ReturnType<typeof vi.fn> } => ({
  decode: vi.fn(async (_bytes: Uint8Array, sampleRate: number) => sine(1.5, sampleRate)),
});

describe('IngestAudioAssetUseCase', () => {
  const setup = (maxUploadBytes = 1024) => {
    const repo = fakeRepo([]);
    const decoder = fakeDecoder();
    const analyzer = { extractPeaks: vi.fn(() => [-1, 1]) };
    const useCase = new IngestAudioAssetUseCase(decoder, analyzer, repo, { maxUploadBytes });
    return { repo, decoder, analyzer, useCase };
  };
  const input = (bytes = new Uint8Array(10)) => ({
    fileName: 'drums.wav',
    contentType: 'audio/wav',
    bytes,
    sampleRate: 44100,
    peakBuckets: 512,
  });

  it('decodes at the requested rate, extracts peaks and stores the metadata', async () => {
    const { repo, decoder, analyzer, useCase } = setup();
    const saved = await useCase.execute(input());
    expect(decoder.decode).toHaveBeenCalledWith(expect.any(Uint8Array), 44100);
    expect(analyzer.extractPeaks).toHaveBeenCalledWith(expect.anything(), 512);
    expect(repo.save.mock.calls[0]![0].metadata).toEqual({
      fileName: 'drums.wav',
      contentType: 'audio/wav',
      byteSize: 10,
      durationSeconds: 1.5,
      sampleRate: 44100,
      channelCount: 2,
      peaks: [-1, 1],
    });
    expect(saved.assetId).toBe(ASSET_A);
  });

  it('rejects an empty file', async () => {
    await expect(setup().useCase.execute(input(new Uint8Array()))).rejects.toThrow(/empty/);
  });

  it('rejects a file over the upload limit before decoding it', async () => {
    const { decoder, useCase } = setup(5);
    await expect(useCase.execute(input())).rejects.toBeInstanceOf(ValidationError);
    expect(decoder.decode).not.toHaveBeenCalled();
  });
});

describe('RenderMixdownUseCase', () => {
  const setup = (known = [ASSET_A, ASSET_B]) => {
    const repo = fakeRepo(known);
    const decoder = fakeDecoder();
    const renderer: SpatialRenderer = { render: vi.fn(async () => sine(10, 48000)) };
    const encoder = { encode: vi.fn(() => new Uint8Array(44)) };
    return { repo, decoder, renderer, encoder, useCase: new RenderMixdownUseCase(repo, decoder, renderer, encoder) };
  };
  const project = (tracks = [track()]) => ({ durationSeconds: 10, masterVolume: 0.8, sampleRate: 48000, tracks });

  it('decodes each distinct asset once, however many clips use it', async () => {
    const { decoder, useCase } = setup();
    const result = await useCase.execute(
      project([
        track({ clips: [clip(), clip({ id: 'c2', startSeconds: 3 }), clip({ id: 'c3', assetId: ASSET_B, startSeconds: 6 })] }),
        track({ id: 't2', clips: [clip({ id: 'c4' })] }),
      ]),
    );
    expect(decoder.decode).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ trackCount: 2, clipCount: 4, assetCount: 2, sampleRate: 48000, durationSeconds: 10 });
  });

  it('refreshes the TTL of every asset it renders', async () => {
    const { repo, useCase } = setup();
    await useCase.execute(project([track({ clips: [clip(), clip({ id: 'c2', assetId: ASSET_B })] })]));
    expect(repo.touch.mock.calls.map((c) => c[0]).sort()).toEqual([ASSET_A, ASSET_B]);
  });

  it('ignores an expired asset that sits only past the project end', async () => {
    const { repo, useCase } = setup([ASSET_A]);
    await useCase.execute(
      project([track({ clips: [clip(), clip({ id: 'late', assetId: ASSET_GONE, startSeconds: 20 })] })]),
    );
    expect(repo.getBytes).not.toHaveBeenCalledWith(ASSET_GONE);
  });

  it('fails with AssetNotFoundError for an audible expired asset', async () => {
    const { useCase } = setup([]);
    await expect(useCase.execute(project())).rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it('refuses a project with nothing to render', async () => {
    const { renderer, useCase } = setup();
    await expect(useCase.execute(project([track({ clips: [] })]))).rejects.toBeInstanceOf(ValidationError);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('hands the renderer a normalised project and encodes its output', async () => {
    const { renderer, encoder, useCase } = setup();
    await useCase.execute({ ...project(), durationSeconds: 2, masterVolume: 5 });
    const [normalised] = vi.mocked(renderer.render).mock.calls[0]!;
    expect(normalised).toMatchObject({ durationSeconds: 3, masterVolume: 1 });
    expect(encoder.encode).toHaveBeenCalledTimes(1);
  });
});
