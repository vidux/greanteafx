import type { AudioAssetRepository } from '../ports/AudioAssetRepository';
import type { AudioDecoder } from '../ports/AudioDecoder';
import type { SpatialRenderer, TrackSource } from '../ports/SpatialRenderer';
import type { WavEncoder } from '../ports/WavEncoder';
import { AssetNotFoundError } from '@/domain/errors';
import {
  normalizeProject,
  projectAssetIds,
  renderableTracks,
  type Project,
} from '@/domain/entities/Project';

export interface RenderMixdownResult {
  readonly wav: Uint8Array;
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly assetCount: number;
  readonly renderMs: number;
}

/**
 * The "Download Mix" pipeline, moved off the client.
 *
 * Prototype equivalent: `renderMixdown(duration)` + `audioBufferToWav(rendered)`.
 * Steps: normalise the project, fetch and decode every referenced sample, build the offline
 * HRTF graph, render, encode to 16-bit WAV.
 */
export class RenderMixdownUseCase {
  constructor(
    private readonly assets: AudioAssetRepository,
    private readonly decoder: AudioDecoder,
    private readonly renderer: SpatialRenderer,
    private readonly encoder: WavEncoder,
  ) {}

  async execute(input: Project): Promise<RenderMixdownResult> {
    const startedAt = Date.now();
    const project = normalizeProject(input);
    const tracks = renderableTracks(project);

    /*
     * Decode once per distinct asset, not once per clip or per track.
     *
     * Copy-paste means the same source routinely appears many times across many lanes; a
     * project with one sample pasted twenty times must not decode it twenty times. Decoding
     * in parallel keeps a multi-sample project roughly as slow as its slowest source rather
     * than the sum of all of them.
     */
    const assetIds = projectAssetIds(project);

    const sources: TrackSource[] = await Promise.all(
      assetIds.map(async (assetId): Promise<TrackSource> => {
        // Throws AssetNotFoundError if the client references an expired/unknown asset.
        const bytes = await this.assets.getBytes(assetId);
        // A project that is only ever rendered, never reopened, must not let its samples expire.
        void this.assets.touch(assetId);
        const audio = await this.decoder.decode(bytes, project.sampleRate);
        return { assetId, audio };
      }),
    );

    if (sources.length === 0) {
      throw new AssetNotFoundError('none referenced');
    }

    const mix = await this.renderer.render(project, sources);
    const wav = this.encoder.encode(mix);

    return {
      wav,
      sampleRate: mix.sampleRate,
      durationSeconds: project.durationSeconds,
      trackCount: tracks.length,
      clipCount: tracks.reduce((n, t) => n + t.clips.length, 0),
      assetCount: sources.length,
      renderMs: Date.now() - startedAt,
    };
  }
}
