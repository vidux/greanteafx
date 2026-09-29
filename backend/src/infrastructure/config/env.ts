import path from 'node:path';

/**
 * Process configuration, read once. Every tunable the service has lives here so nothing
 * deeper in the stack reaches for `process.env`.
 */
export interface AppConfig {
  /** Where uploaded samples and their metadata are cached. */
  readonly assetDirectory: string;
  /** Uploads older than this are pruned. */
  readonly assetTtlMs: number;
  readonly maxUploadBytes: number;
  /** Resolution of the stored waveform envelope. */
  readonly peakBuckets: number;
  readonly corsOrigin: string;
  /**
   * Heavy jobs (decodes, renders) allowed to run at once; the rest queue. Defaults to 1:
   * node-web-audio-api is not reliable with overlapping jobs in one process, so scale with more
   * processes, not more concurrency.
   */
  readonly maxConcurrentJobs: number;
  /** Jobs allowed to wait; beyond this, requests get 503 and retry. */
  readonly maxQueuedJobs: number;
}

function intFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const appConfig: AppConfig = {
  assetDirectory:
    process.env.GREANTEAFX_ASSET_DIR ?? path.join(process.cwd(), '.data', 'assets'),
  assetTtlMs: intFromEnv('GREANTEAFX_ASSET_TTL_MS', 6 * 60 * 60 * 1000), // 6 hours
  maxUploadBytes: intFromEnv('GREANTEAFX_MAX_UPLOAD_BYTES', 64 * 1024 * 1024), // 64 MB
  peakBuckets: intFromEnv('GREANTEAFX_PEAK_BUCKETS', 2048),
  corsOrigin: process.env.GREANTEAFX_CORS_ORIGIN ?? 'http://localhost:3000',
  maxConcurrentJobs: intFromEnv('GREANTEAFX_MAX_CONCURRENT_JOBS', 1),
  maxQueuedJobs: intFromEnv('GREANTEAFX_MAX_QUEUED_JOBS', 16),
};
