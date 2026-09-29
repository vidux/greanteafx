import type { WaveformAnalyzer } from '@/application/ports/WaveformAnalyzer';
import type { PcmAudio } from '@/domain/value-objects/PcmAudio';

/**
 * Min/max envelope extraction, ported from the prototype's `drawTrackWaveform`:
 *
 *   const data = ch.buffer.getChannelData(0);
 *   const step = Math.max(1, Math.floor(data.length/loopW));
 *   for (let x=0;x<loopW;x++){
 *     let min=1,max=-1; const start=x*step;
 *     for (let i=start;i<start+step && i<data.length;i++){ ... }
 *   }
 *
 * Two deliberate differences:
 *
 *  1. The prototype bucketed to *pixels*, recomputing on every resize. The server has no
 *     viewport, so it emits a fixed-resolution envelope once and the client downsamples it
 *     to whatever width the lane happens to be.
 *  2. The prototype's `min=1, max=-1` seeds stay inverted for a window that contains no
 *     samples (possible when buckets outnumber frames). That produced an upside-down bar;
 *     here such windows emit a flat `0, 0` instead.
 *
 * Channel 0 only, as in the prototype.
 */
export class MinMaxWaveformAnalyzer implements WaveformAnalyzer {
  extractPeaks(audio: PcmAudio, bucketCount: number): number[] {
    const data = audio.channelData[0];
    if (!data || data.length === 0 || bucketCount <= 0) return [];

    // Never ask for more buckets than there are frames — beyond that it is just zero padding.
    const buckets = Math.max(1, Math.min(Math.floor(bucketCount), data.length));
    const step = Math.max(1, Math.floor(data.length / buckets));

    const peaks = new Array<number>(buckets * 2);

    for (let b = 0; b < buckets; b++) {
      const start = b * step;
      const end = Math.min(start + step, data.length);

      if (start >= data.length) {
        peaks[b * 2] = 0;
        peaks[b * 2 + 1] = 0;
        continue;
      }

      let min = 1;
      let max = -1;
      for (let i = start; i < end; i++) {
        const v = data[i]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }

      peaks[b * 2] = min;
      peaks[b * 2 + 1] = max;
    }

    return peaks;
  }
}
