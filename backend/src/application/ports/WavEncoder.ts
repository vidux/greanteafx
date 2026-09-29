import type { PcmAudio } from '@/domain/value-objects/PcmAudio';

/**
 * Serialises float PCM to a 16-bit PCM RIFF/WAVE file.
 * Byte-for-byte port of the prototype's `audioBufferToWav`.
 */
export interface WavEncoder {
  encode(audio: PcmAudio): Uint8Array;
}
