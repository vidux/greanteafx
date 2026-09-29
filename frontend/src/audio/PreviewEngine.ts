'use client';

import { PANNER_SETTINGS, REVERB_SETTINGS } from '@/domain/constants';
import { positionAt } from '@/domain/motion';
import { isSilenced, soloActive } from '@/domain/tracks';
import { clipEnd, type Clip, type Track } from '@/domain/types';

/**
 * The live, interactive HRTF preview — a port of the prototype's `setupAudio`,
 * `createChannelAudio`, `startChannelSample` and `applyMotion`, extended to schedule clips.
 *
 * This stays entirely client-side by design. Streaming interactive audio through a server
 * would add a network round trip to every drag of a sound source, which is exactly the
 * responsiveness the cube UI depends on. The server's job is the offline mixdown, where
 * latency does not matter and CPU does.
 *
 * Deliberately not a React component and not in the store: AudioNodes are mutable handles and
 * an automated source's position changes every animation frame. Keeping all of it here means
 * a moving source never triggers a re-render.
 *
 *   clip sources -> panner(HRTF) -> trackGain -> masterGain -> destination
 *                                                    \
 *                                                     -> reverbSend -> convolver -> destination
 *
 * The panner and gain are per *track*: everything on a lane is heard from the same point in
 * space. Only the sources are per clip.
 */

interface ChannelNodes {
  panner: PannerNode;
  gain: GainNode;
  sources: AudioBufferSourceNode[];
}

export class PreviewEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private channels = new Map<string, ChannelNodes>();
  /** Decoded audio keyed by asset, since one sample may be used by clips on many lanes. */
  private buffers = new Map<string, AudioBuffer>();

  private playing = false;
  /**
   * The AudioContext time that corresponds to transport position 0. Seeking moves this
   * rather than resetting it, so `currentTime - playStartTime` is always the position.
   */
  private playStartTime = 0;
  /** Transport position held while stopped, so the playhead stays where you left it. */
  private pausedAt = 0;
  private pendingMasterVolume = 0.8;
  /**
   * Context time at which the next un-scheduled project repeat begins. One repeat is always
   * queued ahead so the loop point does not audibly gap while the scheduler catches up.
   */
  private nextPassOrigin = 0;

  /** Created lazily: browsers require a user gesture before an AudioContext may start. */
  ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.pendingMasterVolume;
    masterGain.connect(ctx.destination);

    // Parallel reverb send, exactly as the prototype wires it.
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = REVERB_SETTINGS.sendGain;
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(
      ctx,
      REVERB_SETTINGS.impulseDurationSeconds,
      REVERB_SETTINGS.impulseDecay,
    );
    masterGain.connect(reverbSend);
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    // Listener at the origin, facing -Z, +Y up.
    const l = ctx.listener;
    setParam(l.positionX, 0);
    setParam(l.positionY, 0);
    setParam(l.positionZ, 0);
    setParam(l.forwardX, 0);
    setParam(l.forwardY, 0);
    setParam(l.forwardZ, -1);
    setParam(l.upX, 0);
    setParam(l.upY, 1);
    setParam(l.upZ, 0);

    this.ctx = ctx;
    this.masterGain = masterGain;
    return ctx;
  }

  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get sampleRate(): number {
    // Before the context exists, report the rate the browser will most likely give us.
    return this.ctx?.sampleRate ?? 48000;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Current transport position in seconds, wrapped to the project length. Drives the playhead,
   * path automation and seeking.
   *
   * Deviation from the prototype, and a deliberate fix: the prototype drove path automation
   * from raw `audioCtx.currentTime`, which is wall-clock time since the page loaded and has no
   * relationship to where the playhead is. The server render evaluates the same paths from
   * t=0, so preview and render were always slightly out of phase with each other — and seeking
   * would have been meaningless. Both now read transport position.
   */
  transportTime(projectDuration: number): number {
    if (!this.ctx || projectDuration <= 0) return 0;
    const raw = this.playing ? this.ctx.currentTime - this.playStartTime : this.pausedAt;
    // `%` keeps the sign of the dividend, so guard against a negative from a seek to 0.
    return ((raw % projectDuration) + projectDuration) % projectDuration;
  }

  setMasterVolume(volume: number): void {
    this.pendingMasterVolume = volume;
    if (this.masterGain) this.masterGain.gain.value = volume;
  }

  hasAsset(assetId: string): boolean {
    return this.buffers.has(assetId);
  }

  /** Decodes an uploaded file for preview. The buffer never leaves the browser. */
  async loadAsset(assetId: string, data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const buffer = await ctx.decodeAudioData(data);
    this.buffers.set(assetId, buffer);
    return buffer;
  }

  forgetAsset(assetId: string): void {
    this.buffers.delete(assetId);
  }

  /** Drops every decoded sample — used when a different project is opened. */
  clearAssets(): void {
    this.buffers.clear();
  }

  /**
   * Reconciles the audio graph with the authored track list: creates missing nodes and
   * pushes gain and position. Cheap enough to call on every store change.
   *
   * Note it does *not* reschedule clips — that would restart audio on every unrelated tweak.
   * Clip changes call `reschedule` explicitly.
   */
  syncTracks(tracks: readonly Track[]): void {
    if (!this.ctx || !this.masterGain) return;

    const solo = soloActive(tracks);
    for (const track of tracks) {
      const nodes = this.nodesFor(track, solo);

      // An inactive track is silent but keeps its nodes, mirroring the prototype's pool.
      nodes.gain.gain.value = isSilenced(track, solo) ? 0 : track.volume;

      // Automated tracks have their position driven by `tick()`; writing it here too would
      // fight that loop every frame.
      if (!isAnimated(track)) {
        setParam(nodes.panner.positionX, track.position.x);
        setParam(nodes.panner.positionY, track.position.y);
        setParam(nodes.panner.positionZ, track.position.z);
      }
    }
  }

  /** Starts playback from the current transport position. */
  start(tracks: readonly Track[], projectDuration: number): void {
    const ctx = this.ensureContext();
    const from = this.pausedAt;
    this.playing = true;
    this.playStartTime = ctx.currentTime - from;
    this.scheduleFrom(tracks, from, projectDuration);
  }

  /** Stops, holding the transport position so the playhead does not jump back to zero. */
  stop(projectDuration?: number): void {
    if (this.playing && projectDuration) {
      this.pausedAt = this.transportTime(projectDuration);
    }
    this.playing = false;
    this.stopAllSources();
  }

  /**
   * Jumps the transport to `seconds` and re-queues everything from there.
   *
   * An `AudioBufferSourceNode` cannot be repositioned once started, so seeking means tearing
   * down every scheduled source and queueing fresh ones at the right offsets.
   */
  seek(seconds: number, tracks: readonly Track[], projectDuration: number): void {
    const ctx = this.ensureContext();
    const target = Math.max(0, Math.min(projectDuration, seconds));

    this.pausedAt = target;
    this.playStartTime = ctx.currentTime - target;

    if (this.playing) this.scheduleFrom(tracks, target, projectDuration);
  }

  /** Re-queues audio in place — called when clips are edited during playback. */
  reschedule(tracks: readonly Track[], projectDuration: number): void {
    if (!this.playing || !this.ctx) return;
    this.scheduleFrom(tracks, this.transportTime(projectDuration), projectDuration);
  }

  /**
   * Queues the current project pass plus one repeat ahead.
   *
   * The lookahead matters: with clips there is no eternally looping source to carry the audio
   * across the loop point, so if the next repeat were only queued when the playhead wrapped,
   * the gap would be however long it took an animation frame to notice — an audible click.
   */
  private scheduleFrom(
    tracks: readonly Track[],
    fromTransport: number,
    projectDuration: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || projectDuration <= 0) return;

    this.stopAllSources();

    const now = ctx.currentTime;
    // Remainder of the pass the playhead is in.
    this.scheduleWindow(tracks, fromTransport, now - fromTransport, projectDuration);
    // The repeat after it.
    const nextOrigin = now + (projectDuration - fromTransport);
    this.scheduleWindow(tracks, 0, nextOrigin, projectDuration);
    this.nextPassOrigin = nextOrigin + projectDuration;
  }

  /**
   * Called once per project repeat by the animation loop, to keep one pass queued ahead.
   * Cheap and idempotent-ish: it only ever appends the pass beyond what is already queued.
   */
  onProjectWrapped(tracks: readonly Track[], projectDuration: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing || projectDuration <= 0) return;
    // A backward seek also looks like a wrap to the caller, but `scheduleFrom` already queued a
    // full pass ahead; appending another would pile up passes with every seek.
    if (this.nextPassOrigin - ctx.currentTime > projectDuration) return;
    if (this.nextPassOrigin < ctx.currentTime) {
      // The loop fell far behind (tab was backgrounded); resynchronise instead of piling up.
      this.scheduleFrom(tracks, this.transportTime(projectDuration), projectDuration);
      return;
    }
    this.scheduleWindow(tracks, 0, this.nextPassOrigin, projectDuration);
    this.nextPassOrigin += projectDuration;
  }

  /**
   * Schedules every clip sounding in `[fromTransport, projectDuration)` of one project pass.
   *
   * @param originCtxTime context time corresponding to transport 0 of this pass.
   */
  private scheduleWindow(
    tracks: readonly Track[],
    fromTransport: number,
    originCtxTime: number,
    projectDuration: number,
  ): void {
    const solo = soloActive(tracks);
    for (const track of tracks) {
      // Muted and solo-excluded tracks are still scheduled — their gain is zero — so unmuting
      // mid-playback is heard at once instead of only after the next loop wrap.
      if (!track.active) continue;
      const nodes = this.nodesFor(track, solo);

      for (const clip of track.clips) {
        this.scheduleClip(
          nodes,
          clip,
          track.tempo,
          fromTransport,
          originCtxTime,
          projectDuration,
        );
      }
    }
  }

  private scheduleClip(
    nodes: ChannelNodes,
    clip: Clip,
    tempo: number,
    fromTransport: number,
    originCtxTime: number,
    projectDuration: number,
  ): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(clip.assetId);
    if (!ctx || !buffer || buffer.duration <= 0) return;

    const rate = tempo || 1;
    const start = Math.max(clip.startSeconds, fromTransport);
    const end = Math.min(clipEnd(clip), projectDuration);
    if (end <= start) return;

    // How far into the source we are when the clip is entered mid-way (seek, or a clip that
    // began before the window). The source advances `rate` times faster than the timeline.
    let offset = clip.offsetSeconds + (start - clip.startSeconds) * rate;

    if (offset >= buffer.duration) {
      if (!clip.loop) return; // Past the end of a one-shot: nothing left to play.
      offset = offset % buffer.duration;
    }

    const when = originCtxTime + start;
    const stopAt = originCtxTime + end;
    // Guard against scheduling in the past after a long stall.
    if (stopAt <= ctx.currentTime) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    if (clip.loop) {
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
    }

    source.connect(nodes.panner);
    source.start(Math.max(when, ctx.currentTime), offset);
    source.stop(stopAt);

    // Self-prune so a long session does not accumulate dead nodes.
    source.onended = () => {
      const i = nodes.sources.indexOf(source);
      if (i >= 0) nodes.sources.splice(i, 1);
      source.disconnect();
    };

    nodes.sources.push(source);
  }

  private stopAllSources(): void {
    for (const nodes of this.channels.values()) {
      for (const source of nodes.sources) {
        try {
          source.onended = null;
          source.stop();
        } catch {
          // Already stopped — the prototype swallows this too.
        }
        source.disconnect();
      }
      nodes.sources.length = 0;
    }
  }

  /**
   * Advances automated sources. Called once per animation frame.
   * Returns the live positions so the cube overlay can be updated from the same values,
   * keeping what you see locked to what you hear.
   */
  tick(
    tracks: readonly Track[],
    projectDuration: number,
  ): Map<string, { x: number; y: number; z: number }> {
    const live = new Map<string, { x: number; y: number; z: number }>();
    if (!this.ctx) return live;

    // Runs while stopped too, so a source parked by a seek shows and sounds at the right place
    // instead of snapping back only once playback resumes.
    const now = this.transportTime(projectDuration);
    for (const track of tracks) {
      if (!track.active || !isAnimated(track)) continue;

      const p = positionAt(track.path, track.pathLoopSec, now, track.pathInterpolation);
      if (!p) continue;

      const nodes = this.channels.get(track.id);
      if (nodes) {
        setParam(nodes.panner.positionX, p.x);
        setParam(nodes.panner.positionY, p.y);
        setParam(nodes.panner.positionZ, p.z);
      }
      live.set(track.id, p);
    }
    return live;
  }

  private nodesFor(track: Track, solo: boolean): ChannelNodes {
    const existing = this.channels.get(track.id);
    if (existing) return existing;

    const ctx = this.ensureContext();
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
    gain.gain.value = isSilenced(track, solo) ? 0 : track.volume;
    panner.connect(gain);
    gain.connect(this.masterGain!);

    const nodes: ChannelNodes = { panner, gain, sources: [] };
    this.channels.set(track.id, nodes);
    return nodes;
  }
}

/**
 * Where inside a looping buffer transport time `fromSeconds` lands.
 *
 * The source is consumed `tempo` times faster than the timeline advances, so after T seconds
 * of transport the buffer has advanced `T * tempo` seconds — wrapped by the loop length. Pure
 * and exported so the seek maths can be tested without a browser.
 */
export function bufferOffsetFor(
  fromSeconds: number,
  tempo: number,
  bufferDuration: number,
): number {
  if (!(bufferDuration > 0)) return 0;
  const rate = tempo || 1;
  const advanced = fromSeconds * rate;
  // `%` keeps the dividend's sign; normalise so a negative never reaches `start()`.
  return ((advanced % bufferDuration) + bufferDuration) % bufferDuration;
}

function isAnimated(track: Track): boolean {
  return track.motionMode === 'path' && track.path.length >= 2;
}

/**
 * Prototype `setParam` — older Safari exposes plain numbers instead of AudioParams on the
 * listener, so guard before assigning.
 */
function setParam(param: AudioParam | number | undefined, value: number): void {
  if (param && typeof (param as AudioParam).value !== 'undefined') {
    (param as AudioParam).value = value;
  }
}

/**
 * Prototype `makeImpulse(ctx, duration, decay)`: white noise under an exponential decay.
 * Kept with `Math.random()` here — the preview is ephemeral, so reproducibility buys nothing.
 * The server's copy is seeded so downloaded mixes are deterministic.
 */
function makeImpulse(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const buf = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buf;
}

/** One engine per page. */
let engine: PreviewEngine | null = null;

export function getPreviewEngine(): PreviewEngine {
  engine ??= new PreviewEngine();
  return engine;
}
