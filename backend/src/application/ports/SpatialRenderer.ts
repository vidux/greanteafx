import type { Project } from '@/domain/entities/Project';
import type { PcmAudio } from '@/domain/value-objects/PcmAudio';

/**
 * A decoded sample, keyed by asset rather than by track: clips on different tracks routinely
 * share one source after a copy-paste, and decoding it once per asset avoids repeating that
 * work per clip.
 */
export interface TrackSource {
  readonly assetId: string;
  readonly audio: PcmAudio;
}

/**
 * Renders a project offline into a stereo mixdown.
 *
 * The implementation is the server-side stand-in for the prototype's
 * `OfflineAudioContext` + `PannerNode('HRTF')` graph in `renderMixdown`.
 */
export interface SpatialRenderer {
  /**
   * @param project Already normalised (see `normalizeProject`).
   * @param sources Decoded audio for every renderable track, keyed by track id.
   * @throws {RenderFailedError}
   */
  render(project: Project, sources: readonly TrackSource[]): Promise<PcmAudio>;
}
