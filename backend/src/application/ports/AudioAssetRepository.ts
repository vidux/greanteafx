/** Metadata the frontend needs about an uploaded sample. */
export interface AudioAssetMetadata {
  readonly assetId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  /** Decoded length in seconds — drives waveform tiling on the timeline. */
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  /**
   * Min/max envelope pairs for waveform drawing, normalised to [-1, 1].
   * `peaks[2i]` is the minimum of bucket `i`, `peaks[2i+1]` its maximum.
   */
  readonly peaks: readonly number[];
  readonly createdAt: string;
}

/**
 * Stores uploaded samples so a render job can reference them by id instead of re-uploading
 * every sample on every mixdown.
 */
export interface AudioAssetRepository {
  save(input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
    metadata: Omit<AudioAssetMetadata, 'assetId' | 'createdAt'>;
  }): Promise<AudioAssetMetadata>;

  /** @throws {AssetNotFoundError} */
  getMetadata(assetId: string): Promise<AudioAssetMetadata>;

  /** Raw encoded bytes as uploaded. @throws {AssetNotFoundError} */
  getBytes(assetId: string): Promise<Uint8Array>;

  /**
   * Marks an asset as recently used so the TTL sweep spares it.
   *
   * Without this, reopening a saved project would read its samples but still let them expire
   * on the original upload clock — a project you use daily would rot. Best-effort; never
   * throws.
   */
  touch(assetId: string): Promise<void>;

  /** Drops assets older than the configured TTL. Best-effort; never throws. */
  prune(): Promise<void>;
}
