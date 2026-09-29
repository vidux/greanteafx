'use client';

import {
  COLORS,
  DEFAULT_DURATION,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_TEMPO,
  LOOP_OPTIONS,
  MAX_DURATION,
  MAX_M,
  MAX_TRACKS,
  MIN_DURATION,
  type ViewName,
} from '@/domain/constants';
import { nextClipId } from '@/domain/clips';
import { clamp } from '@/domain/coordinates';
import type {
  AudioAsset,
  Clip,
  MotionMode,
  PathInterpolation,
  Track,
  Vec3,
} from '@/domain/types';

/**
 * The `.gtfx` project file.
 *
 * Design decision: the file stores **asset ids, not audio**. Embedding samples would make it
 * self-contained but a 10-track project would run to tens of megabytes of base64. Instead the
 * server keeps the bytes and the file references them.
 *
 * The waveform *peaks* are embedded though — they are small, and it means a reopened project
 * draws its timeline instantly, and still looks right even if the server has since expired the
 * underlying audio. In that case the asset is flagged `missing` and the user is asked to
 * re-upload; everything else about the project survives.
 *
 * ## Versions
 *
 * - **v1** — one sample per track (`track.asset`), looping across the whole project.
 * - **v2** — a project-level asset library plus `track.clips`, so audio can be trimmed, placed
 *   and pasted between lanes.
 *
 * v1 files still open: each track's sample becomes a single full-length looping clip, which is
 * exactly what v1 meant by it.
 */
export const PROJECT_FILE_FORMAT = 'greanteafx-project';
export const PROJECT_FILE_VERSION = 2;

/** Format id of `.sonar` files saved before the rename; still opened, never written. */
export const LEGACY_PROJECT_FILE_FORMAT = 'sonar-project';
const READABLE_FORMATS: ReadonlySet<unknown> = new Set([
  PROJECT_FILE_FORMAT,
  LEGACY_PROJECT_FILE_FORMAT,
]);

export interface GreanTeaFXProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: number;
  savedAt: string;
  projectDuration: number;
  masterVolume: number;
  currentView: ViewName;
  /** v2: shared sample library, keyed by asset id. */
  assets: Record<string, AudioAsset>;
  tracks: SerializedTrack[];
}

interface SerializedTrack {
  id: string;
  name: string;
  color: string;
  active: boolean;
  clips: Clip[];
  position: Vec3;
  volume: number;
  muted: boolean;
  /** Absent in files written before solo existed — defaults to not soloed. */
  soloed?: boolean;
  tempo: number;
  motionMode: MotionMode;
  path: Vec3[];
  pathLoopSec: number;
  pathInterpolation: PathInterpolation;
  /** Cube visibility. Absent in files written before show/hide existed — defaults to shown. */
  cubeVisible?: boolean;
  /** v1 only — read on load, never written. */
  asset?: AudioAsset | null;
}

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

/** Peaks dominate the file size; 4 decimals is well below what a waveform can show. */
function roundPeaks(peaks: readonly number[]): number[] {
  return peaks.map((v) => Math.round(v * 10000) / 10000);
}

export function serializeProject(input: {
  projectDuration: number;
  masterVolume: number;
  currentView: ViewName;
  tracks: readonly Track[];
  assets: Record<string, AudioAsset>;
}): GreanTeaFXProjectFile {
  // Only samples actually referenced by a clip are worth saving; an asset left over from a
  // replaced sample would otherwise bloat the file with peaks nothing draws.
  const usedIds = new Set(input.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));
  const assets: Record<string, AudioAsset> = {};
  for (const id of usedIds) {
    const asset = input.assets[id];
    if (asset) assets[id] = { ...asset, peaks: roundPeaks(asset.peaks) };
  }

  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    projectDuration: input.projectDuration,
    masterVolume: input.masterVolume,
    currentView: input.currentView,
    assets,
    tracks: input.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      active: t.active,
      clips: t.clips.map((c) => ({ ...c })),
      position: t.position,
      volume: t.volume,
      muted: t.muted,
      soloed: t.soloed,
      tempo: t.tempo,
      motionMode: t.motionMode,
      path: t.path.map((p) => ({ ...p })),
      pathLoopSec: t.pathLoopSec,
      pathInterpolation: t.pathInterpolation,
      cubeVisible: t.cubeVisible,
    })),
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamped to the cube: the backend rejects any render with an axis outside ±MAX_M. */
function vec3(value: unknown): Vec3 {
  const v = (value ?? {}) as Partial<Vec3>;
  const axis = (n: unknown) => clamp(num(n, 0), -MAX_M, MAX_M);
  return { x: axis(v.x), y: axis(v.y), z: axis(v.z) };
}

function readAsset(raw: unknown): AudioAsset | null {
  const a = raw as Partial<AudioAsset> | null;
  if (!a || typeof a.assetId !== 'string' || !Array.isArray(a.peaks)) return null;
  return {
    assetId: a.assetId,
    fileName: typeof a.fileName === 'string' ? a.fileName : 'sample',
    durationSeconds: num(a.durationSeconds, 0),
    sampleRate: num(a.sampleRate, 48000),
    channelCount: num(a.channelCount, 2),
    peaks: a.peaks,
  };
}

/**
 * Parses and normalises a project file.
 *
 * Every field is defaulted rather than trusted: a project file is user-supplied input that may
 * have been hand-edited or written by an older build. A missing `pathInterpolation` (files
 * predating curved paths) has to fall back to `linear`, not `undefined`, or interpolation
 * silently breaks.
 */
export function deserializeProject(raw: unknown): {
  projectDuration: number;
  masterVolume: number;
  currentView: ViewName;
  tracks: Track[];
  assets: Record<string, AudioAsset>;
} {
  if (!raw || typeof raw !== 'object') {
    throw new ProjectFileError('File is not valid JSON object data.');
  }

  const file = raw as Partial<GreanTeaFXProjectFile>;

  if (!READABLE_FORMATS.has(file.format)) {
    throw new ProjectFileError('Not a GreanTeaFX project file.');
  }
  if (typeof file.version !== 'number' || file.version > PROJECT_FILE_VERSION) {
    throw new ProjectFileError(
      `Project file version ${String(file.version)} is newer than this build understands.`,
    );
  }
  if (!Array.isArray(file.tracks)) {
    throw new ProjectFileError('Project file has no tracks.');
  }

  const view: ViewName =
    file.currentView === 'top' || file.currentView === 'side' ? file.currentView : 'front';

  const projectDuration = clamp(
    Math.round(num(file.projectDuration, DEFAULT_DURATION)),
    MIN_DURATION,
    MAX_DURATION,
  );

  const assets: Record<string, AudioAsset> = {};
  if (file.assets && typeof file.assets === 'object') {
    for (const [id, value] of Object.entries(file.assets)) {
      const asset = readAsset(value);
      if (asset) assets[id] = asset;
    }
  }

  const tracks: Track[] = file.tracks.slice(0, MAX_TRACKS).map((t, i) => {
    const src = (t ?? {}) as Partial<SerializedTrack>;

    let clips: Clip[] = Array.isArray(src.clips)
      ? src.clips
          .map((c) => {
            const clip = (c ?? {}) as Partial<Clip>;
            if (typeof clip.assetId !== 'string') return null;
            return {
              // Ids are regenerated so a hand-edited file cannot collide two clips.
              id: nextClipId(),
              assetId: clip.assetId,
              startSeconds: clamp(num(clip.startSeconds, 0), 0, MAX_DURATION),
              offsetSeconds: Math.max(0, num(clip.offsetSeconds, 0)),
              durationSeconds: clamp(num(clip.durationSeconds, 0), 0, MAX_DURATION),
              loop: clip.loop !== false,
            };
          })
          .filter((c): c is Clip => c !== null && c.durationSeconds > 0)
      : [];

    /*
     * v1 migration: a track carried one sample that looped across the entire project. That is
     * precisely one full-length looping clip, so old files open with identical behaviour
     * rather than merely similar behaviour.
     */
    const legacyAsset = readAsset(src.asset);
    if (clips.length === 0 && legacyAsset) {
      assets[legacyAsset.assetId] ??= legacyAsset;
      clips = [
        {
          id: nextClipId(),
          assetId: legacyAsset.assetId,
          startSeconds: 0,
          offsetSeconds: 0,
          durationSeconds: projectDuration,
          loop: true,
        },
      ];
    }

    return {
      id: typeof src.id === 'string' && src.id ? src.id : `ch-${i}`,
      name:
        typeof src.name === 'string' && src.name
          ? src.name
          : `CH${String(i + 1).padStart(2, '0')}`,
      color:
        typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color)
          ? src.color
          : COLORS[i % COLORS.length]!,
      active: src.active !== false,
      clips,
      position: vec3(src.position),
      volume: clamp(num(src.volume, 0.8), 0, 1),
      muted: src.muted === true,
      soloed: src.soloed === true,
      tempo: clamp(num(src.tempo, DEFAULT_TEMPO), 0.25, 4),
      motionMode: src.motionMode === 'path' ? 'path' : 'static',
      path: Array.isArray(src.path) ? src.path.map(vec3) : [],
      // Only the selectable lengths; anything else would not show in the loop picker.
      pathLoopSec: (LOOP_OPTIONS as readonly number[]).includes(num(src.pathLoopSec, 8))
        ? num(src.pathLoopSec, 8)
        : 8,
      pathInterpolation: src.pathInterpolation === 'smooth' ? 'smooth' : 'linear',
      loading: false,
      // Only an explicit `false` hides a source. Older files have no such field, and a project
      // that reopened with invisible tracks would look broken.
      cubeVisible: src.cubeVisible !== false,
    };
  });

  return {
    projectDuration,
    masterVolume: clamp(num(file.masterVolume, DEFAULT_MASTER_VOLUME), 0, 1),
    currentView: view,
    tracks,
    assets,
  };
}

/** Filename-safe timestamp, e.g. `greanteafx-project-2026-08-09-1432.gtfx`. */
export function suggestedFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `greanteafx-project-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.gtfx`;
}
