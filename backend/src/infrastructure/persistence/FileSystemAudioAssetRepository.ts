import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  AudioAssetMetadata,
  AudioAssetRepository,
} from '@/application/ports/AudioAssetRepository';
import { AssetNotFoundError } from '@/domain/errors';

/**
 * Disk-backed asset cache: `<assetId>.bin` holds the uploaded bytes, `<assetId>.json` its
 * metadata (duration, peaks, ...).
 *
 * Disk rather than an in-process Map because Next.js route handlers do not share module state
 * reliably across dev-server hot reloads or across workers in production — an in-memory store
 * would lose assets between the upload request and the render request. For a multi-node
 * deployment this class is the seam to swap for S3/Redis; nothing above it changes.
 */
export class FileSystemAudioAssetRepository implements AudioAssetRepository {
  constructor(
    private readonly directory: string,
    private readonly ttlMs: number,
  ) {}

  async save(input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
    metadata: Omit<AudioAssetMetadata, 'assetId' | 'createdAt'>;
  }): Promise<AudioAssetMetadata> {
    await this.ensureDirectory();

    const assetId = randomUUID();
    const metadata: AudioAssetMetadata = {
      ...input.metadata,
      assetId,
      createdAt: new Date().toISOString(),
    };

    // Bytes first: a metadata file always implies its payload is already on disk.
    await fs.writeFile(this.binPath(assetId), input.bytes);
    await fs.writeFile(this.metaPath(assetId), JSON.stringify(metadata), 'utf8');

    return metadata;
  }

  async getMetadata(assetId: string): Promise<AudioAssetMetadata> {
    this.assertSafeId(assetId);
    try {
      const raw = await fs.readFile(this.metaPath(assetId), 'utf8');
      return JSON.parse(raw) as AudioAssetMetadata;
    } catch {
      throw new AssetNotFoundError(assetId);
    }
  }

  async getBytes(assetId: string): Promise<Uint8Array> {
    this.assertSafeId(assetId);
    try {
      return await fs.readFile(this.binPath(assetId));
    } catch {
      throw new AssetNotFoundError(assetId);
    }
  }

  /**
   * Pushes both files' mtimes to now, which is what `prune()` compares against. Silent on
   * failure: keeping an asset alive is an optimisation, never a reason to fail a request.
   */
  async touch(assetId: string): Promise<void> {
    try {
      this.assertSafeId(assetId);
      const now = new Date();
      await Promise.all([
        fs.utimes(this.binPath(assetId), now, now),
        fs.utimes(this.metaPath(assetId), now, now),
      ]);
    } catch {
      // Asset is gone or unreadable; the caller will surface that on its own.
    }
  }

  async prune(): Promise<void> {
    try {
      const entries = await fs.readdir(this.directory);
      const cutoff = Date.now() - this.ttlMs;
      await Promise.all(
        entries.map(async (entry) => {
          const full = path.join(this.directory, entry);
          try {
            const stat = await fs.stat(full);
            if (stat.mtimeMs < cutoff) await fs.rm(full, { force: true });
          } catch {
            // Raced with another prune or a delete; nothing to do.
          }
        }),
      );
    } catch {
      // Directory may not exist yet. Pruning is best-effort by contract.
    }
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
  }

  /**
   * Asset ids come from the client, so they must never be interpolated into a path
   * unchecked. Only the UUID shape we issue is accepted — this closes path traversal
   * (`../../etc/passwd`) rather than merely stripping separators.
   */
  private assertSafeId(assetId: string): void {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId);
    if (!isUuid) throw new AssetNotFoundError(assetId);
  }

  private binPath(assetId: string): string {
    return path.join(this.directory, `${assetId}.bin`);
  }

  private metaPath(assetId: string): string {
    return path.join(this.directory, `${assetId}.json`);
  }
}
