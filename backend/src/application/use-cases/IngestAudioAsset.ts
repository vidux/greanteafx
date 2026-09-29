import type { AudioDecoder } from '../ports/AudioDecoder';
import type {
  AudioAssetMetadata,
  AudioAssetRepository,
} from '../ports/AudioAssetRepository';
import type { WaveformAnalyzer } from '../ports/WaveformAnalyzer';
import { ValidationError } from '@/domain/errors';
import { audioContentType } from '@/domain/value-objects/AudioContentType';
import { channelCount, durationSeconds } from '@/domain/value-objects/PcmAudio';

export interface IngestAudioAssetInput {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** Rate to decode at, so peaks and the eventual render agree. */
  readonly sampleRate: number;
  /** How many min/max pairs to extract for the waveform. */
  readonly peakBuckets: number;
}

/**
 * Accepts an uploaded sample, decodes it, extracts its waveform envelope, and stores it for
 * later reference by a render job.
 *
 * This is the "backend owns audio decoding and waveform peak extraction" half of the brief.
 * The client still decodes the same file locally for *live preview* only — that buffer never
 * leaves the browser and is never used for the mixdown.
 */
export class IngestAudioAssetUseCase {
  constructor(
    private readonly decoder: AudioDecoder,
    private readonly analyzer: WaveformAnalyzer,
    private readonly repository: AudioAssetRepository,
    private readonly limits: { maxUploadBytes: number },
  ) {}

  async execute(input: IngestAudioAssetInput): Promise<AudioAssetMetadata> {
    if (input.bytes.byteLength === 0) {
      throw new ValidationError('Uploaded file is empty.');
    }
    if (input.bytes.byteLength > this.limits.maxUploadBytes) {
      throw new ValidationError(
        `File exceeds the ${Math.floor(this.limits.maxUploadBytes / 1_048_576)} MB upload limit.`,
      );
    }

    const decoded = await this.decoder.decode(input.bytes, input.sampleRate);
    const peaks = this.analyzer.extractPeaks(decoded, input.peakBuckets);
    const contentType = audioContentType(input.contentType);

    return this.repository.save({
      fileName: input.fileName,
      contentType,
      bytes: input.bytes,
      metadata: {
        fileName: input.fileName,
        contentType,
        byteSize: input.bytes.byteLength,
        durationSeconds: durationSeconds(decoded),
        sampleRate: decoded.sampleRate,
        channelCount: channelCount(decoded),
        peaks,
      },
    });
  }
}
