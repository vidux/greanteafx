import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AssetController } from '@/interface/http/controllers/AssetController';
import type { RenderController } from '@/interface/http/controllers/RenderController';

import { wavBytes } from '../helpers';

/*
 * The real container, wired to a temporary asset folder. `appConfig` reads the environment when
 * it is first imported, so the controllers are imported only after the variable is set.
 */
const globalRef = globalThis as { __greanteafxContainer?: unknown };
let dir: string;
let assets: AssetController;
let render: RenderController;
let assetId: string;
const uploaded = wavBytes(0.5, 48000);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'greanteafx-http-'));
  vi.stubEnv('GREANTEAFX_ASSET_DIR', dir);
  delete globalRef.__greanteafxContainer;
  assets = (await import('@/interface/http/controllers/AssetController')).assetController;
  render = (await import('@/interface/http/controllers/RenderController')).renderController;
});

afterAll(async () => {
  delete globalRef.__greanteafxContainer;
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

function uploadRequest(body: BodyInit, query = '?sampleRate=48000&peakBuckets=256'): Request {
  return new Request(`http://localhost/api/assets${query}`, { method: 'POST', body });
}

function renderRequest(body: unknown): Request {
  return new Request('http://localhost/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const renderBody = (id: string) => ({
  durationSeconds: 3,
  masterVolume: 0.8,
  sampleRate: 24000,
  tracks: [
    {
      id: 't1',
      name: 'CH01',
      color: '#5EE6A0',
      volume: 0.8,
      position: { x: -3, y: 0, z: 0 },
      clips: [{ id: 'c1', assetId: id, startSeconds: 0, offsetSeconds: 0, durationSeconds: 3 }],
    },
  ],
});

describe('POST /api/assets', () => {
  it('decodes, analyses and stores an upload', async () => {
    const form = new FormData();
    form.append('file', new File([uploaded], 'tone.wav', { type: 'audio/wav' }));
    const response = await assets.upload(uploadRequest(form));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ fileName: 'tone.wav', contentType: 'audio/wav', sampleRate: 48000, channelCount: 2 });
    expect(body.durationSeconds).toBeCloseTo(0.5, 3);
    expect(body.peaks).toHaveLength(512);
    assetId = body.assetId;
  });

  it('requires a "file" field', async () => {
    const response = await assets.upload(uploadRequest(new FormData()));
    expect(response.status).toBe(400);
  });

  it('rejects a body that is not multipart form data as a client error', async () => {
    const response = await assets.upload(uploadRequest('plain text'));
    expect(response.status).toBe(400);
  });

  it('rejects an invalid query', async () => {
    const form = new FormData();
    form.append('file', new File([uploaded], 'tone.wav'));
    expect((await assets.upload(uploadRequest(form, '?sampleRate=12'))).status).toBe(400);
  });

  it('answers 415 for bytes that are not audio', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'x.wav'));
    expect((await assets.upload(uploadRequest(form))).status).toBe(415);
  });
});

describe('GET /api/assets/:id and /data', () => {
  it('returns the stored metadata', async () => {
    const response = await assets.get(assetId);
    expect(response.status).toBe(200);
    expect((await response.json()).assetId).toBe(assetId);
  });

  it('returns the original bytes with their content type', async () => {
    const response = await assets.download(assetId);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/wav');
    expect(response.headers.get('Content-Disposition')).toContain('tone.wav');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(uploaded);
  });

  it.each(['44444444-4444-4444-8444-444444444444', '../../etc/passwd'])('404s for %s', async (id) => {
    expect((await assets.get(id)).status).toBe(404);
    expect((await assets.download(id)).status).toBe(404);
  });
});

describe('POST /api/render', () => {
  it('returns a WAV of the project length with render stats', async () => {
    const response = await render.render(renderRequest(renderBody(assetId)));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/wav');
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="greanteafx-mixdown-\d+\.wav"$/);
    expect(response.headers.get('X-GreanTeaFX-Track-Count')).toBe('1');
    expect(response.headers.get('X-GreanTeaFX-Clip-Count')).toBe('1');
    expect(response.headers.get('X-GreanTeaFX-Asset-Count')).toBe('1');
    expect(response.headers.get('X-GreanTeaFX-Sample-Rate')).toBe('24000');
    expect(Number(response.headers.get('X-GreanTeaFX-Render-Ms'))).toBeGreaterThanOrEqual(0);
    expect((await response.arrayBuffer()).byteLength).toBe(44 + 3 * 24000 * 4);
  });

  it('answers 400 with validation details for a bad project', async () => {
    const response = await render.render(renderRequest({ ...renderBody(assetId), durationSeconds: 1 }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await render.render(renderRequest('{not json'));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 404 for an unknown asset', async () => {
    const response = await render.render(renderRequest(renderBody('44444444-4444-4444-8444-444444444444')));
    expect(response.status).toBe(404);
  });
});
