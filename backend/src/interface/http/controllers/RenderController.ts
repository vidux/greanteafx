import { ValidationError } from '@/domain/errors';
import { getContainer } from '@/infrastructure/composition-root';

import { toErrorResponse } from '../errors';
import { clipsFromTrackDto, RenderRequestSchema } from '../schemas';

export class RenderController {
  /**
   * `POST /api/render` — takes the whole project graph as JSON and streams back a WAV.
   *
   * The response is the audio file itself rather than a JSON envelope with base64 inside:
   * a 30 s stereo mix at 48 kHz is ~11 MB of PCM, and base64 would inflate that by a third
   * for no benefit. The client turns the body straight into a Blob and downloads it.
   */
  async render(request: Request): Promise<Response> {
    try {
      // A malformed body is the client's mistake, not an internal error.
      const body: unknown = await request.json().catch(() => {
        throw new ValidationError('Request body is not valid JSON.');
      });
      const dto = RenderRequestSchema.parse(body);

      const container = getContainer();
      // Renders hold whole mixes in memory; the shared limit keeps a burst from any one user
      // from exhausting it for everyone.
      const result = await container.jobs.run(() => container.renderMixdown.execute({
        durationSeconds: dto.durationSeconds,
        masterVolume: dto.masterVolume,
        sampleRate: dto.sampleRate,
        tracks: dto.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          clips: clipsFromTrackDto(t, dto.durationSeconds),
          muted: t.muted,
          volume: t.volume,
          tempo: t.tempo,
          position: t.position,
          motionMode: t.motionMode,
          path: t.path,
          pathLoopSeconds: t.pathLoopSeconds,
          pathInterpolation: t.pathInterpolation,
        })),
      }));

      const fileName = `greanteafx-mixdown-${Date.now()}.wav`;

      return new Response(result.wav as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(result.wav.byteLength),
          'Content-Disposition': `attachment; filename="${fileName}"`,
          // Lets the browser show render stats without a second round trip.
          'X-GreanTeaFX-Render-Ms': String(result.renderMs),
          'X-GreanTeaFX-Track-Count': String(result.trackCount),
          'X-GreanTeaFX-Clip-Count': String(result.clipCount),
          'X-GreanTeaFX-Asset-Count': String(result.assetCount),
          'X-GreanTeaFX-Sample-Rate': String(result.sampleRate),
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  }
}

export const renderController = new RenderController();
