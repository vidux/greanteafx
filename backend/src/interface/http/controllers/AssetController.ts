import { NextResponse } from 'next/server';

import { getContainer } from '@/infrastructure/composition-root';
import { ValidationError } from '@/domain/errors';
import { audioContentType } from '@/domain/value-objects/AudioContentType';

import { toErrorResponse } from '../errors';
import { UploadQuerySchema } from '../schemas';

/**
 * Asset metadata is one user's data (it carries their file name), so no shared cache — a CDN or
 * corporate proxy — may keep it and hand it to someone else.
 */
const PRIVATE_JSON = { 'Cache-Control': 'private, no-store' };

/**
 * Controllers translate HTTP into use-case calls and back. They hold no audio logic; if a
 * rule about audio lives here, it is in the wrong layer.
 */
export class AssetController {
  async upload(request: Request): Promise<Response> {
    try {
      const container = getContainer();
      const url = new URL(request.url);
      const query = UploadQuerySchema.parse(Object.fromEntries(url.searchParams));

      // A malformed body is the client's mistake, not an internal error.
      const form = await request.formData().catch(() => {
        throw new ValidationError('Expected a multipart/form-data body.');
      });
      const file = form.get('file');

      if (!(file instanceof File)) {
        throw new ValidationError('Expected a multipart form field named "file".');
      }

      const bytes = new Uint8Array(await file.arrayBuffer());

      // Decoding is heavy; it shares the job limit with renders.
      const metadata = await container.jobs.run(() =>
        container.ingestAudioAsset.execute({
          fileName: file.name || 'sample',
          contentType: file.type,
          bytes,
          sampleRate: query.sampleRate,
          peakBuckets: query.peakBuckets ?? container.config.peakBuckets,
        }),
      );

      // Opportunistic housekeeping; failures here must never fail the upload.
      void container.assets.prune();

      return NextResponse.json(metadata, { status: 201, headers: PRIVATE_JSON });
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  async get(assetId: string): Promise<Response> {
    try {
      const metadata = await getContainer().assets.getMetadata(assetId);
      return NextResponse.json(metadata, { headers: PRIVATE_JSON });
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  /**
   * `GET /api/assets/:assetId/data` — the original uploaded bytes.
   *
   * Exists for project reload: a `.gtfx` file stores asset ids, not audio, so on open the
   * client needs the real bytes back to rebuild its local preview buffer. Reading also
   * refreshes the asset's TTL, so projects that are actually used do not expire.
   */
  async download(assetId: string): Promise<Response> {
    try {
      const container = getContainer();
      const [metadata, bytes] = await Promise.all([
        container.assets.getMetadata(assetId),
        container.assets.getBytes(assetId),
      ]);

      void container.assets.touch(assetId);

      return new Response(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          // Re-checked on the way out too, for samples stored before the type was sanitised.
          'Content-Type': audioContentType(metadata.contentType),
          'Content-Length': String(bytes.byteLength),
          // A download, never a page: opened directly, the browser saves it rather than rendering
          // it, and even if it did, the sandbox gives it no origin and no script.
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
}

export const assetController = new AssetController();
