import { renderController } from '@/interface/http/controllers/RenderController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * A 10-track, 600 s project is the worst case. Offline rendering runs far faster than
 * real time, but the ceiling is generous so a large job is never cut off mid-render.
 */
export const maxDuration = 300;

/** `POST /api/render` — project JSON in, 16-bit PCM WAV out. */
export function POST(request: Request): Promise<Response> {
  return renderController.render(request);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
