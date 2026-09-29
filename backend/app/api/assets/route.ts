import { assetController } from '@/interface/http/controllers/AssetController';

/**
 * Native `node-web-audio-api` bindings and `fs` access require the Node runtime; decoding is
 * per-request work, so nothing here may be statically optimised.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Decoding a long sample can take a while on a cold process. */
export const maxDuration = 120;

/** `POST /api/assets` — multipart upload; decodes, extracts peaks, stores, returns metadata. */
export function POST(request: Request): Promise<Response> {
  return assetController.upload(request);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
