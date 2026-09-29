import { REVERB_SETTINGS } from '@/domain/constants';
import type { SampleBuffer } from '@/domain/value-objects/PcmAudio';

/**
 * Generates the reverb impulse response used by the convolver.
 *
 * Prototype `makeImpulse(ctx, duration, decay)`:
 *   d[i] = (Math.random()*2-1) * Math.pow(1 - i/length, decay)
 *
 * Deviation: `Math.random()` is replaced with a seeded mulberry32 PRNG so that rendering the
 * same project twice produces byte-identical WAVs. The noise has the same distribution
 * (uniform white noise in [-1,1]) under the same decay envelope, so the reverb tail is
 * perceptually and statistically the same — it is simply reproducible. A server that returns
 * a different file for identical input is hostile to caching, diffing and testing.
 */
export function createImpulseResponse(
  sampleRate: number,
  durationSeconds: number = REVERB_SETTINGS.impulseDurationSeconds,
  decay: number = REVERB_SETTINGS.impulseDecay,
  seed = 0x5ee6a0,
): SampleBuffer[] {
  const length = Math.floor(sampleRate * durationSeconds);
  const channels: SampleBuffer[] = [];

  for (let c = 0; c < 2; c++) {
    // Per-channel seed offset keeps L/R decorrelated, as independent Math.random() draws were.
    const random = mulberry32(seed + c * 0x9e3779b9);
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = (random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    channels.push(data);
  }

  return channels;
}

/** Small, fast, well-distributed 32-bit PRNG. Deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
