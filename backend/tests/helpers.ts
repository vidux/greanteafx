import type { Clip } from '@/domain/entities/Clip';
import type { Track } from '@/domain/entities/Track';
import { RiffWavEncoder } from '@/infrastructure/audio/RiffWavEncoder';
import type { PcmAudio, SampleBuffer } from '@/domain/value-objects/PcmAudio';

export const ASSET_A = '11111111-1111-4111-8111-111111111111';
export const ASSET_B = '22222222-2222-4222-8222-222222222222';
export const ASSET_GONE = '33333333-3333-4333-8333-333333333333';

/** A sine tone as float PCM, identical on every channel. */
export function sine(seconds: number, sampleRate = 48000, channels = 2, hz = 440): PcmAudio {
  const frameCount = Math.round(seconds * sampleRate);
  const data = new Float32Array(frameCount) as SampleBuffer;
  for (let i = 0; i < frameCount; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return {
    channelData: Array.from({ length: channels }, () => data.slice() as SampleBuffer),
    sampleRate,
    frameCount,
  };
}

/** A real, decodable WAV file, on a plain ArrayBuffer so it can be used as a `BlobPart`. */
export function wavBytes(seconds = 0.5, sampleRate = 48000): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new RiffWavEncoder().encode(sine(seconds, sampleRate)));
}

export function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    assetId: ASSET_A,
    startSeconds: 0,
    offsetSeconds: 0,
    durationSeconds: 2,
    loop: true,
    ...over,
  };
}

export function track(over: Partial<Track> = {}): Track {
  return {
    id: 't1',
    name: 'CH01',
    color: '#5EE6A0',
    clips: [clip()],
    muted: false,
    volume: 0.8,
    tempo: 1,
    position: { x: 0, y: 0, z: 0 },
    motionMode: 'static',
    path: [],
    pathLoopSeconds: 8,
    pathInterpolation: 'linear',
    ...over,
  };
}

/** Root-mean-square level over sample indexes [from, to); fractional bounds are floored. */
export function rms(data: Float32Array, from = 0, to = data.length): number {
  const start = Math.floor(from);
  const end = Math.min(data.length, Math.floor(to));
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i]! * data[i]!;
  return Math.sqrt(sum / Math.max(1, end - start));
}
