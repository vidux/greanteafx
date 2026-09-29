'use client';

import { isSilenced, soloActive } from '@/domain/tracks';
import type { AudioAsset, Track } from '@/domain/types';

// Re-exported for callers that only import from the api module.
export type { AudioAsset };

const API_BASE =
  process.env.NEXT_PUBLIC_GREANTEAFX_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Pulls the backend's `{ error: { code, message } }` envelope out of a failed response. */
async function toApiError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}`;
  let code: string | undefined;
  try {
    const body = await response.json();
    if (body?.error?.message) {
      message = body.error.message;
      code = body.error.code;
    }
  } catch {
    // Non-JSON error body; the status-based message stands.
  }
  return new ApiError(message, response.status, code);
}

/**
 * Uploads a sample. The backend decodes it, extracts the waveform envelope and caches the
 * bytes, returning an id the render request refers to — so a mixdown does not re-upload
 * every sample.
 */
export async function uploadSample(
  file: File,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<AudioAsset> {
  const form = new FormData();
  form.append('file', file);

  const url = `${API_BASE}/api/assets?sampleRate=${Math.round(sampleRate)}`;
  const response = await fetch(url, { method: 'POST', body: form, signal });

  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as AudioAsset;
}

/**
 * Fetches an uploaded sample's original bytes.
 *
 * Used when reopening a project: the `.gtfx` file holds asset ids, so the browser needs the
 * real audio back to rebuild its local preview buffer. Returns `null` when the asset has
 * expired from the server's cache, which the caller surfaces as "re-upload this sample"
 * rather than as an error.
 */
export async function fetchAssetBytes(
  assetId: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  const response = await fetch(`${API_BASE}/api/assets/${assetId}/data`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw await toApiError(response);
  return response.arrayBuffer();
}

export interface RenderProjectInput {
  durationSeconds: number;
  masterVolume: number;
  sampleRate: number;
  tracks: readonly Track[];
  /** Used to drop clips whose source has expired from the server cache. */
  assets: Record<string, AudioAsset>;
}

/**
 * Renders the mixdown server-side and returns the WAV as a Blob.
 *
 * Only active tracks that actually carry a sample are sent: the backend rejects a project
 * with nothing to render, and silent channels would only slow the render down.
 *
 * Solo is resolved here, as mute: the service only knows `muted`, so a track left out by a solo
 * is sent muted and the file matches what the preview played.
 */
export async function renderMixdown(
  input: RenderProjectInput,
  signal?: AbortSignal,
): Promise<{ blob: Blob; renderMs: number | null }> {
  const solo = soloActive(input.tracks);
  const payload = {
    durationSeconds: input.durationSeconds,
    masterVolume: input.masterVolume,
    sampleRate: Math.round(input.sampleRate),
    tracks: input.tracks
      .filter((t) => t.active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        // A clip whose source expired would 404 the whole render, so it is dropped here and
        // the UI warns separately. Everything else still renders.
        clips: t.clips
          .filter((c) => input.assets[c.assetId] && !input.assets[c.assetId]!.missing)
          // Clips pushed past the end are silent, and past 600 s the API would reject them.
          .filter((c) => c.startSeconds < input.durationSeconds)
          .map((c) => ({
            id: c.id,
            assetId: c.assetId,
            startSeconds: c.startSeconds,
            offsetSeconds: c.offsetSeconds,
            durationSeconds: c.durationSeconds,
            loop: c.loop,
          })),
        muted: isSilenced(t, solo),
        volume: t.volume,
        tempo: t.tempo,
        position: t.position,
        motionMode: t.motionMode,
        path: t.path,
        pathLoopSeconds: t.pathLoopSec,
        pathInterpolation: t.pathInterpolation,
      }))
      .filter((t) => t.clips.length > 0),
  };

  const response = await fetch(`${API_BASE}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) throw await toApiError(response);

  const renderMs = Number(response.headers.get('X-GreanTeaFX-Render-Ms'));
  return {
    blob: await response.blob(),
    renderMs: Number.isFinite(renderMs) ? renderMs : null,
  };
}

/** Prototype `downloadWav` — anchor click, then revoke the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
