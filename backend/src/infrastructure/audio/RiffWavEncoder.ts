import type { WavEncoder } from '@/application/ports/WavEncoder';
import type { PcmAudio } from '@/domain/value-objects/PcmAudio';

/**
 * 16-bit PCM RIFF/WAVE encoder — a line-for-line port of the prototype's `audioBufferToWav`.
 *
 * The arithmetic is deliberately kept identical rather than "improved":
 *
 *  - Asymmetric scaling (`sample<0 ? sample*0x8000 : sample*0x7FFF`) preserves the prototype's
 *    exact quantisation. Using a single 0x7FFF factor would shift every negative sample.
 *  - `DataView.setInt16` is used rather than `Buffer.writeInt16LE`. `setInt16` applies the
 *    ECMAScript ToInt16 conversion, which truncates toward zero; Node's Buffer writers
 *    range-check and would both throw on out-of-range input and round differently. Same tool,
 *    same result.
 *  - The clamp to [-1, 1] happens here, not upstream, so the encoder is the single place
 *    where headroom is enforced.
 *
 * Header layout (44 bytes, canonical PCM):
 *   0  "RIFF"        4  chunkSize=36+data   8  "WAVE"
 *   12 "fmt "        16 subchunk1Size=16    20 audioFormat=1 (PCM)
 *   22 numChannels   24 sampleRate          28 byteRate
 *   32 blockAlign    34 bitsPerSample=16    36 "data"   40 dataSize
 */
export class RiffWavEncoder implements WavEncoder {
  encode(audio: PcmAudio): Uint8Array {
    const numChannels = audio.channelData.length;
    const { sampleRate, frameCount } = audio;

    const blockAlign = numChannels * 2;
    const dataSize = frameCount * blockAlign;

    const arrBuf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrBuf);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, 'WAVE');

    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM, uncompressed
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);

    writeAscii(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = audio.channelData;
    let offset = 44;
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numChannels; c++) {
        const raw = channels[c]![i] ?? 0;
        const clamped = Math.max(-1, Math.min(1, raw));
        const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        view.setInt16(offset, scaled, true);
        offset += 2;
      }
    }

    return new Uint8Array(arrBuf);
  }
}

/** Prototype: `writeWavString(view, offset, str)`. ASCII only, one byte per char. */
function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
