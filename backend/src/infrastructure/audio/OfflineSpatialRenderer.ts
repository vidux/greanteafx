import {
  OfflineAudioContext,
  PannerNode,
  type AudioBuffer,
  type BaseAudioContext,
} from 'node-web-audio-api';

import type {
  SpatialRenderer,
  TrackSource,
} from '@/application/ports/SpatialRenderer';
import {
  LISTENER_SETTINGS,
  PANNER_SETTINGS,
  REVERB_SETTINGS,
  WAV_CHANNELS,
} from '@/domain/constants';
import { clipEndSeconds, type Clip } from '@/domain/entities/Clip';
import type { Project } from '@/domain/entities/Project';
import {
  audibleClips,
  effectiveGain,
  usesAutomation,
  type Track,
} from '@/domain/entities/Track';
import { RenderFailedError } from '@/domain/errors';
import { sampleAutomationCurves } from '@/domain/services/MotionPath';
import type { PcmAudio, SampleBuffer } from '@/domain/value-objects/PcmAudio';

import { createImpulseResponse } from './ImpulseResponse';

/**
 * Server-side port of the prototype's `renderMixdown(duration)`.
 *
 * The graph is reproduced node for node:
 *
 *   bufferSource(loop) -> panner(HRTF) -> trackGain -> masterGain -> destination
 *                                                          \
 *                                                           -> reverbSend(0.32) -> convolver -> destination
 *
 * `node-web-audio-api` implements the same Web Audio spec as the browser, including HRTF
 * panning against the IRCAM HRIR dataset that Chromium also uses, so this is a genuine port
 * rather than a reimplementation. See README "Why this engine".
 */
export class OfflineSpatialRenderer implements SpatialRenderer {
  async render(project: Project, sources: readonly TrackSource[]): Promise<PcmAudio> {
    const sampleRate = project.sampleRate;

    // Prototype: `new OfflineAudioContext(2, Math.ceil(sr*duration), sr)`.
    const frameCount = Math.ceil(sampleRate * project.durationSeconds);
    const ctx = new OfflineAudioContext(WAV_CHANNELS, frameCount, sampleRate);

    const master = this.buildMasterBus(ctx, project.masterVolume);
    this.positionListener(ctx);

    const audioByAsset = new Map(sources.map((s) => [s.assetId, s.audio]));
    // One decoded sample can feed many clips; converting it to an AudioBuffer once and reusing
    // the handle keeps a heavily pasted project from allocating a copy per clip.
    const bufferCache = new Map<string, AudioBuffer>();

    for (const track of project.tracks) {
      this.attachTrack(
        ctx,
        master,
        track,
        project.durationSeconds,
        audioByAsset,
        bufferCache,
      );
    }

    let rendered: AudioBuffer;
    try {
      rendered = await ctx.startRendering();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new RenderFailedError(`Offline render failed: ${detail}`);
    }

    const channelData: SampleBuffer[] = [];
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      channelData.push(rendered.getChannelData(c) as SampleBuffer);
    }

    return {
      channelData,
      sampleRate: rendered.sampleRate,
      frameCount: rendered.length,
    };
  }

  /**
   * Master gain plus the parallel reverb send.
   * Prototype: `oMaster`, `oReverbSend` (0.32), `oConvolver` with a 2.6 s / 2.4-decay impulse.
   */
  private buildMasterBus(ctx: OfflineAudioContext, masterVolume: number) {
    const master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = REVERB_SETTINGS.sendGain;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.createImpulseBuffer(ctx);

    master.connect(reverbSend);
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    return master;
  }

  private createImpulseBuffer(ctx: BaseAudioContext): AudioBuffer {
    const channels = createImpulseResponse(ctx.sampleRate);
    const length = channels[0]!.length;
    const buffer = ctx.createBuffer(channels.length, length, ctx.sampleRate);
    // `getChannelData` hands back a copy in this binding, so writes must use copyToChannel.
    channels.forEach((data, index) => buffer.copyToChannel(data, index));
    return buffer;
  }

  /** Prototype: listener at the origin, facing -Z, +Y up. */
  private positionListener(ctx: OfflineAudioContext): void {
    const { position, forward, up } = LISTENER_SETTINGS;
    const l = ctx.listener;
    l.positionX.value = position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  }

  /**
   * Builds one spatial chain per track and hangs every audible clip off it.
   *
   * The panner and gain are per *track*, not per clip: all clips on a lane are heard from the
   * same point in space and move along the same path. Only the sources are per clip.
   */
  private attachTrack(
    ctx: OfflineAudioContext,
    master: ReturnType<OfflineAudioContext['createGain']>,
    track: Track,
    durationSeconds: number,
    audioByAsset: Map<string, PcmAudio>,
    bufferCache: Map<string, AudioBuffer>,
  ): void {
    const clips = audibleClips(track, durationSeconds);
    if (clips.length === 0) return;

    const panner = new PannerNode(ctx, {
      panningModel: PANNER_SETTINGS.panningModel,
      distanceModel: PANNER_SETTINGS.distanceModel,
      refDistance: PANNER_SETTINGS.refDistance,
      maxDistance: PANNER_SETTINGS.maxDistance,
      rolloffFactor: PANNER_SETTINGS.rolloffFactor,
      positionX: track.position.x,
      positionY: track.position.y,
      positionZ: track.position.z,
    });

    const gain = ctx.createGain();
    gain.gain.value = effectiveGain(track);
    panner.connect(gain);
    gain.connect(master);

    if (usesAutomation(track)) {
      this.applyAutomation(panner, track, durationSeconds);
    }

    for (const clip of clips) {
      const audio = audioByAsset.get(clip.assetId);
      if (!audio) continue; // Asset expired or was never uploaded; the clip is silent.

      let buffer = bufferCache.get(clip.assetId);
      if (!buffer) {
        buffer = this.toAudioBuffer(ctx, audio);
        bufferCache.set(clip.assetId, buffer);
      }

      this.scheduleClip(ctx, panner, clip, buffer, track.tempo, durationSeconds);
    }
  }

  /**
   * Places one clip on the timeline.
   *
   * `stop(when + duration)` rather than the third argument of `start(when, offset, duration)`:
   * that argument is measured in the *buffer's* timebase, so with a tempo multiplier it would
   * need pre-scaling, and implementations differ on how it interacts with looping. Stopping at
   * an explicit output time is unambiguous in both respects.
   */
  private scheduleClip(
    ctx: OfflineAudioContext,
    panner: PannerNode,
    clip: Clip,
    buffer: AudioBuffer,
    tempo: number,
    durationSeconds: number,
  ): void {
    const rate = tempo || 1;

    // A clip may begin before t=0 (dragged left past the start); render only the visible part
    // and skip correspondingly further into the source.
    const visibleStart = Math.max(0, clip.startSeconds);
    const visibleEnd = Math.min(durationSeconds, clipEndSeconds(clip));
    if (visibleEnd <= visibleStart) return;

    const trimmedLead = visibleStart - clip.startSeconds;
    // The source is consumed `rate` times faster than the timeline advances.
    let offset = clip.offsetSeconds + trimmedLead * rate;

    if (buffer.duration > 0 && offset >= buffer.duration) {
      // Past the end of the source: only meaningful if it repeats.
      if (!clip.loop) return;
      offset = offset % buffer.duration;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    if (clip.loop) {
      // Prototype behaviour: the sample repeats to fill the clip.
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
    }

    source.connect(panner);
    source.start(visibleStart, offset);
    source.stop(visibleEnd);
  }

  /**
   * Writes the sampled keyframe path onto the panner's position params.
   * Prototype wraps this in try/catch and falls back to pinning the source at `path[0]`;
   * that fallback is preserved because `setValueCurveAtTime` can still reject (e.g. a curve
   * overlapping an existing automation event).
   */
  private applyAutomation(
    panner: PannerNode,
    track: Track,
    durationSeconds: number,
  ): void {
    const curves = sampleAutomationCurves(
      track.path,
      track.pathLoopSeconds,
      durationSeconds,
      track.pathInterpolation,
    );
    if (!curves) return;

    try {
      panner.positionX.setValueCurveAtTime(curves.x, 0, durationSeconds);
      panner.positionY.setValueCurveAtTime(curves.y, 0, durationSeconds);
      panner.positionZ.setValueCurveAtTime(curves.z, 0, durationSeconds);
    } catch {
      const first = track.path[0]!;
      panner.positionX.value = first.x;
      panner.positionY.value = first.y;
      panner.positionZ.value = first.z;
    }
  }

  private toAudioBuffer(ctx: BaseAudioContext, audio: PcmAudio): AudioBuffer {
    const buffer = ctx.createBuffer(
      audio.channelData.length,
      audio.frameCount,
      audio.sampleRate,
    );
    audio.channelData.forEach((data, index) => buffer.copyToChannel(data, index));
    return buffer;
  }
}
