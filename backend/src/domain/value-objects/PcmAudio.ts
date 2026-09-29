/**
 * A channel of samples backed by a plain (non-shared) ArrayBuffer.
 *
 * TypeScript 5.7 made the typed arrays generic over their backing buffer, and the Web Audio
 * binding's `copyToChannel` requires specifically `ArrayBuffer` rather than `ArrayBufferLike`
 * (which admits `SharedArrayBuffer`). Naming it once here keeps that detail out of every
 * signature that passes audio around.
 */
export type SampleBuffer = Float32Array<ArrayBuffer>;

/**
 * Deinterleaved floating-point PCM — the common currency between the decoder, the renderer
 * and the encoder. Samples are nominally in [-1, 1] but are not guaranteed to be: the WAV
 * encoder is responsible for the final clamp, exactly as the prototype's
 * `audioBufferToWav` does.
 */
export interface PcmAudio {
  /** One channel of samples per entry, each of length `frameCount`. */
  readonly channelData: readonly SampleBuffer[];
  readonly sampleRate: number;
  /** Frames per channel. */
  readonly frameCount: number;
}

export function channelCount(audio: PcmAudio): number {
  return audio.channelData.length;
}

/** Length in seconds. */
export function durationSeconds(audio: PcmAudio): number {
  return audio.sampleRate > 0 ? audio.frameCount / audio.sampleRate : 0;
}
