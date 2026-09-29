import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { JobLimiter } from '@/application/JobLimiter';
import { NodeWebAudioDecoder } from '@/infrastructure/audio/NodeWebAudioDecoder';
import { OfflineSpatialRenderer } from '@/infrastructure/audio/OfflineSpatialRenderer';
import { RiffWavEncoder } from '@/infrastructure/audio/RiffWavEncoder';
import type { PcmAudio } from '@/domain/value-objects/PcmAudio';
import type { AssetController } from '@/interface/http/controllers/AssetController';
import type { RenderController } from '@/interface/http/controllers/RenderController';

import { ASSET_A, ASSET_B, clip, sine, track } from '../helpers';

/*
 * Several users hit one backend process at once. Nothing one of them sends may show up in
 * another's response, and a flood from one of them must be turned away rather than crash the
 * service for everyone.
 */

const encoder = new RiffWavEncoder();
const toneWav = (hz: number, seconds: number) => new Uint8Array(encoder.encode(sine(seconds, 48000, 2, hz)));

/** Level of one frequency over [from, to) seconds (Goertzel), for telling two tones apart. */
function toneLevel(x: Float32Array, hz: number, rate: number, from: number, to: number): number {
  const [a, b] = [Math.floor(from * rate), Math.floor(to * rate)];
  const c = 2 * Math.cos((2 * Math.PI * hz) / rate);
  let s1 = 0;
  let s2 = 0;
  for (let k = a; k < b; k++) {
    const s = x[k]! + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (b - a);
}

describe('concurrent users never receive each other’s audio', () => {
  it('decodes of different files at the same time match decoding them one by one', async () => {
    const decoder = new NodeWebAudioDecoder();
    const files = [toneWav(220, 0.4), toneWav(880, 0.7), toneWav(440, 0.2), toneWav(660, 0.5)];

    const alone: PcmAudio[] = [];
    for (const f of files) alone.push(await decoder.decode(f, 48000));
    const together = await Promise.all(files.map((f) => decoder.decode(f, 48000)));

    together.forEach((audio, i) => {
      expect(audio.frameCount).toBe(alone[i]!.frameCount);
      expect(audio.channelData[0]).toEqual(alone[i]!.channelData[0]);
    });
  });

  it('renders requested by different users at the same time each contain only their own audio', async () => {
    // Two users, two different tones. Whatever the timing, Alice's mix must hold her 330 Hz tone
    // and none of Bob's 990 Hz, and vice versa. (Checked by frequency, not bit-for-bit: under heavy
    // CPU load node-web-audio-api can render a clip slightly differently from one run to the next,
    // but never with someone else's audio in it.)
    const renderer = new OfflineSpatialRenderer();
    const jobs = new JobLimiter(1, 16);
    const rate = 24000;
    const sources = [
      { assetId: ASSET_A, audio: sine(1, rate, 2, 330) },
      { assetId: ASSET_B, audio: sine(1, rate, 2, 990) },
    ];
    const project = (assetId: string, x: number) => ({
      durationSeconds: 3,
      masterVolume: 1,
      sampleRate: rate,
      tracks: [track({ clips: [clip({ assetId, startSeconds: 0.5, durationSeconds: 1, loop: false })], position: { x, y: 0, z: -1 } })],
    });

    const [alice, bob] = await Promise.all([
      jobs.run(() => renderer.render(project(ASSET_A, -3), sources)),
      jobs.run(() => renderer.render(project(ASSET_B, 3), sources)),
    ]);

    const level = (audio: PcmAudio, hz: number) => toneLevel(audio.channelData[0]!, hz, rate, 0.6, 1.4);
    expect(level(alice, 330)).toBeGreaterThan(100 * level(alice, 990));
    expect(level(bob, 990)).toBeGreaterThan(100 * level(bob, 330));
  });
});

describe('through the HTTP API', () => {
  const globalRef = globalThis as { __greanteafxContainer?: unknown };
  let dir: string;
  let assets: AssetController;
  let render: RenderController;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'greanteafx-isolation-'));
    vi.stubEnv('GREANTEAFX_ASSET_DIR', dir);
    vi.stubEnv('GREANTEAFX_MAX_CONCURRENT_JOBS', '1');
    vi.stubEnv('GREANTEAFX_MAX_QUEUED_JOBS', '1');
    delete globalRef.__greanteafxContainer;
    assets = (await import('@/interface/http/controllers/AssetController')).assetController;
    render = (await import('@/interface/http/controllers/RenderController')).renderController;
  });

  afterAll(async () => {
    delete globalRef.__greanteafxContainer;
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const upload = (bytes: Uint8Array, name: string, type = 'audio/wav') => {
    const form = new FormData();
    form.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
    return assets.upload(new Request('http://localhost/api/assets?sampleRate=24000', { method: 'POST', body: form }));
  };

  it('gives each user their own sample back, even when they upload at the same moment', async () => {
    const alice = toneWav(220, 0.3);
    const bob = toneWav(880, 0.3);
    const [a, b] = await Promise.all([upload(alice, 'alice.wav'), upload(bob, 'bob.wav')]);
    const aliceMeta = await a.json();
    const bobMeta = await b.json();

    expect(aliceMeta.assetId).not.toBe(bobMeta.assetId);
    expect(new Uint8Array(await (await assets.download(aliceMeta.assetId)).arrayBuffer())).toEqual(alice);
    expect(new Uint8Array(await (await assets.download(bobMeta.assetId)).arrayBuffer())).toEqual(bob);
    expect((await (await assets.get(bobMeta.assetId)).json()).fileName).toBe('bob.wav');
  });

  it('marks per-user responses private so no shared cache can serve them to someone else', async () => {
    const meta = await (await upload(toneWav(330, 0.2), 'private.wav')).json();
    expect((await assets.get(meta.assetId)).headers.get('Cache-Control')).toBe('private, no-store');
    expect((await assets.download(meta.assetId)).headers.get('Cache-Control')).toMatch(/^private/);
  });

  it('never replays an uploader’s claimed type as a web page', async () => {
    const response = await upload(toneWav(440, 0.2), 'trap.html', 'text/html');
    const meta = await response.json();
    expect(meta.contentType).toBe('application/octet-stream');

    const download = await assets.download(meta.assetId);
    expect(download.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(download.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(download.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(download.headers.get('Content-Disposition')).toMatch(/^attachment;/);
  });

  it('turns a flood away with 503 instead of running out of memory', async () => {
    const meta = await (await upload(toneWav(550, 1), 'flood.wav')).json();
    const body = JSON.stringify({
      durationSeconds: 20,
      masterVolume: 1,
      sampleRate: 24000,
      tracks: [{ id: 't', name: 'T', color: '#5EE6A0', volume: 1, position: { x: 1, y: 0, z: 0 },
        clips: [{ id: 'c', assetId: meta.assetId, startSeconds: 0, offsetSeconds: 0, durationSeconds: 20 }] }],
    });
    const request = () => render.render(new Request('http://localhost/api/render', { method: 'POST', body }));

    // One running, one queued, the rest refused.
    const responses = await Promise.all([request(), request(), request(), request()]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 503, 503]);
    const busy = responses.find((r) => r.status === 503)!;
    expect(busy.headers.get('Retry-After')).toBe('5');
    expect((await busy.json()).error.code).toBe('SERVER_BUSY');
  });
});
