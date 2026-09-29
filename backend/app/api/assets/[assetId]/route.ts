import { assetController } from '@/interface/http/controllers/AssetController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/assets/:assetId` — metadata and waveform peaks for a previously uploaded sample. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await context.params;
  return assetController.get(assetId);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
