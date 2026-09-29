import { assetController } from '@/interface/http/controllers/AssetController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/assets/:assetId/data` — the original uploaded bytes, so a reopened project can
 * rebuild its client-side preview buffer. Also refreshes the asset's TTL.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await context.params;
  return assetController.download(assetId);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
