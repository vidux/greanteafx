import { describe, expect, it } from 'vitest';

import type { Project } from '@/domain/entities/Project';
import { AudioDecodeError } from '@/domain/errors';
import type { SampleBuffer } from '@/domain/value-objects/PcmAudio';
import { createImpulseResponse } from '@/infrastructure/audio/ImpulseResponse';
import { MinMaxWaveformAnalyzer } from '@/infrastructure/audio/MinMaxWaveformAnalyzer';
import { NodeWebAudioDecoder } from '@/infrastructure/audio/NodeWebAudioDecoder';
import { OfflineSpatialRenderer } from '@/infrastructure/audio/OfflineSpatialRenderer';
import { RiffWavEncoder } from '@/infrastructure/audio/RiffWavEncoder';

import { ASSET_A, clip, rms, sine, track, wavBytes } from '../helpers';

const pcm = (values: number[], channels = 1) => ({
  channelData: Array.from({ length: channels }, () => Float32Array.from(values) as SampleBuffer),
  sampleRate: 8000,
  frameCount: values.length,
});

describe('RiffWavEncoder', () => {
  const encoder = new RiffWavEncoder();

  it('writes a canonical 16-bit PCM header', () => {
    const wav = encoder.encode(pcm([0, 0, 0], 2));
    const view = new DataView(wav.buffer);
    const ascii = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(wav.byteLength).toBe(44 + 3 * 2 * 2);
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(36 + 12);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(8000 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
  });

  it('quantises asymmetrically, truncating toward zero, and clamps overs', () => {
    const wav = encoder.encode(pcm([1, -1, 0.5, -0.5, 2, -2]));
    const view = new DataView(wav.buffer);
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([32767, -32768, 16383, -16384, 32767, -32768]);
  });

  it('interleaves channels frame by frame', () => {
    const wav = encoder.encode({
      channelData: [Float32Array.from([1, 1]) as SampleBuffer, Float32Array.from([-1, -1]) as SampleBuffer],
      sampleRate: 8000,
      frameCount: 2,
    });
    const view = new DataView(wav.buffer);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767, -32768]);
  });
});

describe('MinMaxWaveformAnalyzer', () => {
  const analyzer = new MinMaxWaveformAnalyzer();

  it('emits a min/max pair per bucket', () => {
    expect(analyzer.extractPeaks(pcm([0, 1, -1, 0.5]), 2)).toEqual([0, 1, -1, 0.5]);
  });

  it('never makes more buckets than there are frames', () => {
    expect(analyzer.extractPeaks(pcm([0.2, -0.2]), 100)).toHaveLength(4);
  });

  it('returns nothing for silence-free empty input or zero buckets', () => {
    expect(analyzer.extractPeaks(pcm([]), 10)).toEqual([]);
    expect(analyzer.extractPeaks(pcm([1]), 0)).toEqual([]);
  });

  it('keeps every value in [-1, 1] for normal audio', () => {
    const peaks = analyzer.extractPeaks(sine(0.2), 256);
    expect(peaks).toHaveLength(512);
    expect(Math.max(...peaks.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});

describe('createImpulseResponse', () => {
  it('is stereo, the configured length, and reproducible', () => {
    const a = createImpulseResponse(8000);
    const b = createImpulseResponse(8000);
    expect(a).toHaveLength(2);
    expect(a[0]).toHaveLength(Math.floor(8000 * 2.6));
    expect(a[0]).toEqual(b[0]);
  });

  it('decorrelates the two ears and decays over time', () => {
    const [left, right] = createImpulseResponse(8000);
    expect(left).not.toEqual(right);
    const tenth = Math.floor(left!.length / 10);
    expect(rms(left!, left!.length - tenth)).toBeLessThan(rms(left!, 0, tenth) / 20);
  });

  it('changes with the seed', () => {
    expect(createImpulseResponse(8000, 1, 2, 1)[0]).not.toEqual(createImpulseResponse(8000, 1, 2, 2)[0]);
  });
});

describe('NodeWebAudioDecoder', () => {
  const decoder = new NodeWebAudioDecoder();

  it('decodes a WAV at the requested rate', async () => {
    const audio = await decoder.decode(wavBytes(0.5, 48000), 48000);
    expect(audio.sampleRate).toBe(48000);
    expect(audio.channelData).toHaveLength(2);
    expect(audio.frameCount).toBe(24000);
  });

  it('resamples to the context rate, keeping the duration', async () => {
    const audio = await decoder.decode(wavBytes(0.5, 48000), 24000);
    expect(audio.sampleRate).toBe(24000);
    expect(audio.frameCount / audio.sampleRate).toBeCloseTo(0.5, 2);
  });

  it('leaves the caller’s bytes intact', async () => {
    const bytes = wavBytes(0.1);
    const copy = bytes.slice();
    await decoder.decode(bytes, 48000);
    expect(bytes).toEqual(copy);
  });

  it('reports undecodable input as AudioDecodeError', async () => {
    await expect(decoder.decode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 48000)).rejects.toBeInstanceOf(
      AudioDecodeError,
    );
  });
});

describe('OfflineSpatialRenderer', () => {
  const renderer = new OfflineSpatialRenderer();
  const source = [{ assetId: ASSET_A, audio: sine(1, 24000) }];
  const sampleRate = 24000;

  const render = (tracks: Project['tracks'], durationSeconds = 3) =>
    renderer.render({ durationSeconds, masterVolume: 1, sampleRate, tracks }, source);

  it('renders stereo audio exactly as long as the project', async () => {
    const out = await render([track()]);
    expect(out.channelData).toHaveLength(2);
    expect(out.frameCount).toBe(3 * sampleRate);
  });

  it('places a source on the left louder in the left ear', async () => {
    const out = await render([track({ position: { x: -5, y: 0, z: 0 }, clips: [clip({ durationSeconds: 1, loop: false })] })]);
    const [left, right] = out.channelData;
    expect(rms(left!, 0, sampleRate)).toBeGreaterThan(rms(right!, 0, sampleRate) * 1.5);
  });

  it('plays a one-shot clip only inside its span', async () => {
    const out = await render([track({ clips: [clip({ startSeconds: 1, durationSeconds: 1, loop: false })] })]);
    const [left] = out.channelData;
    expect(rms(left!, 0, sampleRate * 0.9)).toBeLessThan(1e-4);
    expect(rms(left!, sampleRate * 1.1, sampleRate * 1.9)).toBeGreaterThan(0.01);
  });

  it('loops a looping clip to fill it', async () => {
    const out = await render([track({ clips: [clip({ durationSeconds: 3, loop: true })] })]);
    expect(rms(out.channelData[0]!, sampleRate * 2.1, sampleRate * 2.9)).toBeGreaterThan(0.01);
  });

  it('silences a muted track entirely, reverb included', async () => {
    const out = await render([track({ muted: true })]);
    expect(Math.max(...out.channelData[0]!.map(Math.abs))).toBe(0);
  });

  it('skips clips whose audio was not supplied', async () => {
    const out = await renderer.render(
      { durationSeconds: 3, masterVolume: 1, sampleRate, tracks: [track()] },
      [],
    );
    expect(Math.max(...out.channelData[0]!.map(Math.abs))).toBe(0);
  });

  it('renders an automated path without failing', async () => {
    const out = await render([
      track({
        motionMode: 'path',
        pathInterpolation: 'smooth',
        pathLoopSeconds: 2,
        path: [
          { x: 3, y: 0, z: 0 },
          { x: 0, y: 0, z: 3 },
          { x: -3, y: 0, z: 0 },
        ],
      }),
    ]);
    expect(rms(out.channelData[0]!)).toBeGreaterThan(0.01);
  });
});
