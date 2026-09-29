import type { PcmAudio } from '@/domain/value-objects/PcmAudio';

/**
 * Reduces decoded PCM to a min/max envelope for drawing.
 *
 * The prototype did this in the browser inside `drawTrackWaveform`, walking
 * `buffer.getChannelData(0)` in `step`-sized windows and keeping each window's min and max.
 * That work moves here; the client just paints the returned envelope.
 */
export interface WaveformAnalyzer {
  /**
   * @param bucketCount Number of min/max pairs to produce.
   * @returns Flat array of length `bucketCount * 2`: [min0, max0, min1, max1, ...].
   */
  extractPeaks(audio: PcmAudio, bucketCount: number): number[];
}
