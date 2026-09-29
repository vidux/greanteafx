import type { PcmAudio } from '@/domain/value-objects/PcmAudio';

/**
 * Turns encoded audio bytes (MP3, WAV, FLAC, ...) into float PCM.
 * Replaces the browser's `AudioContext.decodeAudioData`.
 */
export interface AudioDecoder {
  /**
   * @param bytes  Encoded file contents.
   * @param sampleRate Rate to decode at; implementations resample when the source differs.
   * @throws {AudioDecodeError} when the bytes are not decodable audio.
   */
  decode(bytes: Uint8Array, sampleRate: number): Promise<PcmAudio>;
}
