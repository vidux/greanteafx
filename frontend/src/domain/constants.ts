/**
 * Ported verbatim from `spatial-audio-console.html`, except the channel palette. These values
 * define the coordinate system; the backend mirrors the audio-relevant ones in its own domain
 * layer (the two services share no code, only this contract).
 */

/**
 * Channel colours, index = channel index. The redesign's palette rather than the prototype's:
 * softer, spread around the wheel, and with no red, which the UI keeps for delete.
 */
export const COLORS = [
  '#7EE6B0',
  '#F0B45A',
  '#5AD0E0',
  '#F07AB0',
  '#B59AF0',
  '#F0E07A',
  '#7AB8F0',
  '#F09A7A',
  '#9AF0D6',
  '#E07AF0',
] as const;

/** Overlay pixels per metre. Prototype `RADAR_SCALE = 30`. */
export const RADAR_SCALE = 30;

/** Per-axis clamp in metres. Prototype `MAX_M = 6`. */
export const MAX_M = 6;

/** Prototype `LOOP_OPTIONS`. */
export const LOOP_OPTIONS = [2, 4, 8, 16, 32] as const;

export const MAX_TRACKS = 10;

export const MIN_DURATION = 3;
export const MAX_DURATION = 600;
export const DEFAULT_DURATION = 30;
export const DEFAULT_MASTER_VOLUME = 0.8;

/** Tempo is a playback-rate multiplier — an addition to the prototype. See README. */
export const MIN_TEMPO = 0.25;
export const MAX_TEMPO = 4;
export const DEFAULT_TEMPO = 1;

/** The overlay SVG's viewBox is 400x400 with the listener dead centre. */
export const OVERLAY_SIZE = 400;
export const OVERLAY_CENTER = 200;

export type ViewName = 'front' | 'top' | 'side';
export type WorldAxis = 'x' | 'y' | 'z';

export interface ViewAxisMapping {
  /** World axis mapped to the overlay's horizontal screen axis. */
  readonly sxAxis: WorldAxis;
  readonly sxSign: 1 | -1;
  /** World axis mapped to the overlay's vertical screen axis. */
  readonly syAxis: WorldAxis;
  readonly sySign: 1 | -1;
  /** The axis you cannot edit in this view; it keeps whatever value it already had. */
  readonly lockedAxis: WorldAxis;
  readonly lockedLabel: string;
}

/**
 * Which two world axes are editable in each cube view, and which stays locked.
 * Prototype `VIEW_AXES` — copied exactly, including the sign flips. The Y and side-Z
 * inversions exist because SVG's Y axis grows downward while world Y grows upward.
 */
export const VIEW_AXES: Record<ViewName, ViewAxisMapping> = {
  front: { sxAxis: 'x', sxSign: 1, syAxis: 'y', sySign: -1, lockedAxis: 'z', lockedLabel: 'Z (depth)' },
  top: { sxAxis: 'x', sxSign: 1, syAxis: 'z', sySign: 1, lockedAxis: 'y', lockedLabel: 'Y (height)' },
  side: { sxAxis: 'z', sxSign: -1, syAxis: 'y', sySign: -1, lockedAxis: 'x', lockedLabel: 'X (left/right)' },
};

/** Panner/listener/reverb settings, kept identical to the backend so preview matches render. */
export const PANNER_SETTINGS = {
  panningModel: 'HRTF',
  distanceModel: 'inverse',
  refDistance: 1,
  maxDistance: 20,
  rolloffFactor: 1.1,
} as const;

export const REVERB_SETTINGS = {
  sendGain: 0.32,
  impulseDurationSeconds: 2.6,
  impulseDecay: 2.4,
} as const;
