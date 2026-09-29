import { JobLimiter } from '@/application/JobLimiter';
import { IngestAudioAssetUseCase } from '@/application/use-cases/IngestAudioAsset';
import { RenderMixdownUseCase } from '@/application/use-cases/RenderMixdown';

import { MinMaxWaveformAnalyzer } from './audio/MinMaxWaveformAnalyzer';
import { NodeWebAudioDecoder } from './audio/NodeWebAudioDecoder';
import { OfflineSpatialRenderer } from './audio/OfflineSpatialRenderer';
import { RiffWavEncoder } from './audio/RiffWavEncoder';
import { appConfig, type AppConfig } from './config/env';
import { FileSystemAudioAssetRepository } from './persistence/FileSystemAudioAssetRepository';

/**
 * The single place where interfaces are bound to implementations. Route handlers ask this
 * for a use case and never `new` an infrastructure class themselves — that is what keeps the
 * dependency arrows pointing inward.
 */
export interface Container {
  readonly config: AppConfig;
  readonly ingestAudioAsset: IngestAudioAssetUseCase;
  readonly renderMixdown: RenderMixdownUseCase;
  readonly assets: FileSystemAudioAssetRepository;
  /** Shared by every user's decodes and renders, so no one user can starve the rest. */
  readonly jobs: JobLimiter;
}

function build(): Container {
  const config = appConfig;

  const decoder = new NodeWebAudioDecoder();
  const analyzer = new MinMaxWaveformAnalyzer();
  const renderer = new OfflineSpatialRenderer();
  const encoder = new RiffWavEncoder();
  const assets = new FileSystemAudioAssetRepository(
    config.assetDirectory,
    config.assetTtlMs,
  );

  return {
    config,
    assets,
    jobs: new JobLimiter(config.maxConcurrentJobs, config.maxQueuedJobs),
    ingestAudioAsset: new IngestAudioAssetUseCase(decoder, analyzer, assets, {
      maxUploadBytes: config.maxUploadBytes,
    }),
    renderMixdown: new RenderMixdownUseCase(assets, decoder, renderer, encoder),
  };
}

/**
 * Cached on globalThis so Next.js dev-server hot reloads reuse one container (and therefore
 * one decoder context cache) instead of leaking a new one per reload.
 */
const globalRef = globalThis as typeof globalThis & { __greanteafxContainer?: Container };

export function getContainer(): Container {
  globalRef.__greanteafxContainer ??= build();
  return globalRef.__greanteafxContainer;
}
