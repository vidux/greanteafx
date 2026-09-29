import { OfflineAudioContext } from 'node-web-audio-api';

import type { AudioDecoder } from '@/application/ports/AudioDecoder';
import { AudioDecodeError } from '@/domain/errors';
import type { PcmAudio, SampleBuffer } from '@/domain/value-objects/PcmAudio';

/**
 * Decodes MP3/WAV/FLAC/OGG bytes via `node-web-audio-api`'s `decodeAudioData`, the direct
 * server-side counterpart of the prototype's `audioCtx.decodeAudioData(reader.result)`.
 *
 * As in the browser, decoding happens *at the context's sample rate*, so the library
 * resamples the source for us and every track in a render already agrees on a rate. Verified:
 * a 44.1 kHz source decoded on a 48 kHz context comes back at 48 kHz with the same duration.
 */
export class NodeWebAudioDecoder implements AudioDecoder {
  /**
   * `decodeAudioData` lives on BaseAudioContext, so a decode needs *a* context. They are
   * cheap but not free; one per distinct sample rate is reused for the process lifetime.
   */
  private readonly contexts = new Map<number, OfflineAudioContext>();

  async decode(bytes: Uint8Array, sampleRate: number): Promise<PcmAudio> {
    const ctx = this.contextFor(sampleRate);

    // decodeAudioData takes ownership of the ArrayBuffer, so hand it a private copy: `bytes`
    // may be a view into a larger pooled buffer, and the caller still needs its data intact
    // (the repository writes the same bytes to disk).
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    let buffer;
    try {
      buffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new AudioDecodeError(
        `Could not decode audio (unsupported or corrupt file): ${detail}`,
      );
    }

    if (buffer.length === 0) {
      throw new AudioDecodeError('Decoded audio contains no samples.');
    }

    const channelData: SampleBuffer[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      // getChannelData returns a copy in this binding, which is exactly what we want here.
      channelData.push(buffer.getChannelData(c) as SampleBuffer);
    }

    return {
      channelData,
      sampleRate: buffer.sampleRate,
      frameCount: buffer.length,
    };
  }

  private contextFor(sampleRate: number): OfflineAudioContext {
    let ctx = this.contexts.get(sampleRate);
    if (!ctx) {
      // Length is irrelevant for decoding; 1 frame keeps the allocation trivial.
      ctx = new OfflineAudioContext(1, 1, sampleRate);
      this.contexts.set(sampleRate, ctx);
    }
    return ctx;
  }
}
