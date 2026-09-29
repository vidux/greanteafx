/**
 * Every constant here is lifted verbatim from `spatial-audio-console.html`, which is the
 * behavioural specification for this service. Changing a value here changes the sound of a
 * render, so each one cites the line it came from.
 */

/** Maximum simultaneous tracks. Prototype: `for (let i=0;i<10;i++)` channel pool. */
export const MAX_TRACKS = 10;

/** Per-axis position clamp in metres. Prototype: `const MAX_M = 6`. */
export const MAX_POSITION_M = 6;

/** Project length bounds in seconds. Prototype: `Math.max(3, Math.min(600, v))`. */
export const MIN_PROJECT_SECONDS = 3;
export const MAX_PROJECT_SECONDS = 600;
export const DEFAULT_PROJECT_SECONDS = 30;

/** Prototype `LOOP_OPTIONS = [2,4,8,16,32]` — the selectable path cycle lengths. */
export const LOOP_LENGTH_OPTIONS = [2, 4, 8, 16, 32] as const;
export const DEFAULT_LOOP_SECONDS = 8;

/** Prototype `masterVol` input default. */
export const DEFAULT_MASTER_VOLUME = 0.8;

/** Prototype channel seed: `volume: 0.8`. */
export const DEFAULT_TRACK_VOLUME = 0.8;

/**
 * Tempo is a playback-rate multiplier (see README "Deviations"). The prototype had no tempo
 * control; 1.0 is the neutral value that reproduces prototype behaviour exactly.
 */
export const DEFAULT_TRACK_TEMPO = 1;
export const MIN_TRACK_TEMPO = 0.25;
export const MAX_TRACK_TEMPO = 4;

/**
 * PannerNode configuration. Prototype `createChannelAudio` / `renderMixdown`:
 *   panningModel:'HRTF', distanceModel:'inverse',
 *   refDistance:1, maxDistance:20, rolloffFactor:1.1
 */
export const PANNER_SETTINGS = {
  panningModel: 'HRTF',
  distanceModel: 'inverse',
  refDistance: 1,
  maxDistance: 20,
  rolloffFactor: 1.1,
} as const;

/**
 * Listener sits at the origin facing -Z with +Y up. Prototype `setupAudio` / `renderMixdown`.
 */
export const LISTENER_SETTINGS = {
  position: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
} as const;

/**
 * Reverb bus. Prototype: `reverbSend.gain.value = 0.32` and
 * `convolver.buffer = makeImpulse(ctx, 2.6, 2.4)`.
 */
export const REVERB_SETTINGS = {
  sendGain: 0.32,
  impulseDurationSeconds: 2.6,
  impulseDecay: 2.4,
} as const;

/**
 * Path automation sampling grid. Prototype `renderMixdown`:
 *   const dt = 0.05;
 *   const numSamples = Math.max(2, Math.ceil(duration/dt));
 */
export const AUTOMATION_TIMESTEP_SECONDS = 0.05;
export const AUTOMATION_MIN_SAMPLES = 2;

/**
 * Render sample rate used when the client does not pin one. The prototype inherited the
 * browser's `audioCtx.sampleRate`; on the server there is no such ambient device rate, so the
 * client sends its own and this is the fallback.
 */
export const DEFAULT_SAMPLE_RATE = 48000;
export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 192000;

/** WAV output is 16-bit PCM, matching the prototype's `audioBufferToWav`. */
export const WAV_BITS_PER_SAMPLE = 16;
export const WAV_CHANNELS = 2;
