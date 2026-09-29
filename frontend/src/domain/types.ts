export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type MotionMode = 'static' | 'path';

/**
 * How keyframes are joined. `linear` is the prototype's behaviour (straight segments);
 * `smooth` runs a closed Catmull-Rom spline through them.
 */
export type PathInterpolation = 'linear' | 'smooth';

/** Waveform + duration metadata returned by the backend for an uploaded sample. */
export interface AudioAsset {
  readonly assetId: string;
  readonly fileName: string;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  /** Flat [min0, max0, min1, max1, ...] envelope. */
  readonly peaks: readonly number[];
  /**
   * Set when a reopened project references a sample the server no longer has (TTL expired).
   * Waveforms still draw — peaks live in the project file — but there is no audio to preview
   * or render until it is re-uploaded.
   */
  readonly missing?: boolean;
}

/**
 * A placed piece of audio on a track's lane.
 *
 * The prototype had no such concept: a track was one sample looping across the whole project,
 * so "copy this region and paste it there" had nowhere to land. A clip carries its own source,
 * its own trim into that source, and its own position, which is what a paste target needs.
 *
 * Uploading a sample still produces a single full-length looping clip, so the prototype's
 * behaviour is a special case of this model rather than something it replaced.
 */
export interface Clip {
  readonly id: string;
  readonly assetId: string;
  /** Where the clip begins on the project timeline, in seconds. */
  readonly startSeconds: number;
  /** How far into the source sample the clip begins, in seconds. */
  readonly offsetSeconds: number;
  /** How long the clip occupies the timeline, in seconds. */
  readonly durationSeconds: number;
  /** When true the source repeats to fill the clip, as the prototype did. */
  readonly loop: boolean;
}

export function clipEnd(clip: Clip): number {
  return clip.startSeconds + clip.durationSeconds;
}

/**
 * A channel. Mirrors the prototype's `channels[]` entries, minus the Web Audio node handles
 * — those live in the preview engine, not in application state, so that React never
 * re-renders because an AudioParam changed.
 *
 * Spatial settings belong to the track, not to individual clips: everything on a lane is
 * heard from the same point in space and moves along the same path.
 */
export interface Track {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Prototype `ch.active`: whether the channel is on the timeline at all. */
  readonly active: boolean;
  readonly clips: readonly Clip[];
  readonly position: Vec3;
  readonly volume: number;
  readonly muted: boolean;
  /**
   * While any active track is soloed, every track that is not drops out of the mix — the
   * preview and the exported file alike. Addition to the prototype.
   */
  readonly soloed: boolean;
  /** Playback-rate multiplier. Addition to the prototype. */
  readonly tempo: number;
  readonly motionMode: MotionMode;
  readonly path: readonly Vec3[];
  readonly pathLoopSec: number;
  readonly pathInterpolation: PathInterpolation;
  /** An upload is in flight for this track. */
  readonly loading: boolean;
  /**
   * Whether this track's blip and path are drawn in the cube.
   *
   * Purely a **view filter** — it never touches the audio. Sources bunch up in the cube as soon
   * as two of them share a region of space, and once blips overlap the topmost one swallows
   * every pointer-down, so the one underneath cannot be grabbed at all. Hiding the neighbours
   * is the only way to reach it. Muting would be the wrong tool: it changes the mix.
   */
  readonly cubeVisible: boolean;
}

/**
 * Which gesture a drag on a lane performs.
 *
 * An explicit mode rather than a modifier key: an uploaded sample fills its whole lane, so
 * "drag on a clip" is ambiguous between selecting part of it and moving it, and a hidden
 * modifier makes half the tool undiscoverable.
 */
export type ToolMode = 'select' | 'move';

/** A dragged-out time range on one lane. */
export interface Selection {
  readonly trackId: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** One piece of copied audio, positioned relative to the start of the copied region. */
export interface ClipboardItem {
  readonly assetId: string;
  readonly offsetSeconds: number;
  readonly durationSeconds: number;
  readonly loop: boolean;
  /** Offset from the start of the copied region, so multi-clip regions keep their spacing. */
  readonly relativeStart: number;
}

export interface Clipboard {
  readonly items: readonly ClipboardItem[];
  readonly durationSeconds: number;
}

/**
 * Where the last paste finished, so the next one can butt up against it.
 *
 * Pastes never overlap existing audio, but without this a repeat paste would aim at the playhead
 * again and land wherever the nearest gap happened to be. Carrying the end position forward makes
 * repeated pastes lay clips end to end, which is what "paste again" means everywhere else: a text
 * editor moves the caret past what it just inserted.
 *
 * Session state only. It is never written to a project file, and any deliberate act of pointing
 * somewhere else — seeking, selecting, editing a lane — discards it.
 */
export interface PasteAnchor {
  readonly trackId: string;
  readonly endSeconds: number;
}

export type TransportStatus = string;
