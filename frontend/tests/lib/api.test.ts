import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, fetchAssetBytes, renderMixdown, uploadSample } from '@/lib/api';
import { createInitialTracks } from '@/store/projectStore';
import type { AudioAsset, Track } from '@/domain/types';

const A = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

const asset = (assetId: string, missing = false): AudioAsset => ({
  assetId,
  fileName: 'a.wav',
  durationSeconds: 2,
  sampleRate: 48000,
  channelCount: 2,
  peaks: [],
  missing,
});

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('renderMixdown', () => {
  function tracks(): Track[] {
    const t = createInitialTracks();
    const clip = (id: string, assetId: string) => ({
      id,
      assetId,
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: 5,
      loop: true,
    });
    t[0] = { ...t[0]!, clips: [clip('keep', A), clip('expired', GONE), { ...clip('past-end', A), startSeconds: 30 }] };
    t[1] = { ...t[1]!, clips: [clip('only-expired', GONE)] };
    t[5] = { ...t[5]!, active: false, clips: [clip('inactive', A)] };
    return t;
  }

  it('sends only active tracks with renderable clips', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'X-GreanTeaFX-Render-Ms': '42' } }),
    );

    const result = await renderMixdown({
      durationSeconds: 30,
      masterVolume: 0.8,
      sampleRate: 44100.4,
      tracks: tracks(),
      assets: { [A]: asset(A), [GONE]: asset(GONE, true) },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/render$/);
    const body = JSON.parse(String(init!.body));
    expect(body.sampleRate).toBe(44100);
    expect(body.tracks.map((t: { id: string }) => t.id)).toEqual(['ch-0']);
    expect(body.tracks[0].clips.map((c: { id: string }) => c.id)).toEqual(['keep']);
    expect(body.tracks[0].pathLoopSeconds).toBe(8);

    expect(result.renderMs).toBe(42);
    expect(result.blob.size).toBe(3);
  });

  it('sends tracks left out by a solo as muted, so the file matches the preview', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1])));
    const t = createInitialTracks();
    const clip = { id: 'c', assetId: A, startSeconds: 0, offsetSeconds: 0, durationSeconds: 5, loop: true };
    t[0] = { ...t[0]!, clips: [clip], soloed: true };
    t[1] = { ...t[1]!, clips: [{ ...clip, id: 'd' }] };

    await renderMixdown({ durationSeconds: 30, masterVolume: 1, sampleRate: 48000, tracks: t, assets: { [A]: asset(A) } });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.tracks.map((x: { id: string; muted: boolean }) => [x.id, x.muted])).toEqual([
      ['ch-0', false],
      ['ch-1', true],
    ]);
  });

  it('turns the error envelope into an ApiError', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'VALIDATION_ERROR', message: 'Bad project' } }, 400));
    const error = await renderMixdown({
      durationSeconds: 30,
      masterVolume: 1,
      sampleRate: 48000,
      tracks: [],
      assets: {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Bad project', status: 400, code: 'VALIDATION_ERROR' });
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(
      renderMixdown({ durationSeconds: 30, masterVolume: 1, sampleRate: 48000, tracks: [], assets: {} }),
    ).rejects.toThrow('Request failed with status 502');
  });
});

describe('uploadSample', () => {
  it('posts multipart form data with the rounded sample rate', async () => {
    fetchMock.mockResolvedValue(json(asset(A), 201));
    const result = await uploadSample(new File([new Uint8Array(4)], 'a.wav'), 47999.6);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/assets\?sampleRate=48000$/);
    expect(init!.body).toBeInstanceOf(FormData);
    expect(result.assetId).toBe(A);
  });
});

describe('fetchAssetBytes', () => {
  it('returns null for an expired asset instead of throwing', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'ASSET_NOT_FOUND', message: 'gone' } }, 404));
    expect(await fetchAssetBytes(A)).toBeNull();
  });

  it('returns the bytes on success', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([9, 8])));
    const bytes = await fetchAssetBytes(A);
    expect(new Uint8Array(bytes!)).toEqual(new Uint8Array([9, 8]));
  });

  it('throws on other failures', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500));
    await expect(fetchAssetBytes(A)).rejects.toThrow('boom');
  });
});
