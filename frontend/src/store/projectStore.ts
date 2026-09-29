'use client';

import { create } from 'zustand';

import {
  COLORS,
  DEFAULT_DURATION,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_TEMPO,
  MAX_DURATION,
  MAX_TRACKS,
  MIN_DURATION,
  type ViewName,
} from '@/domain/constants';
import {
  copyRegion,
  fullLengthLoopClip,
  nextClipId,
  pasteClips,
  pasteStartSeconds,
  removeRegion,
  resizeSpanningLoops,
  splitAt,
} from '@/domain/clips';
import { clamp } from '@/domain/coordinates';
import type {
  AudioAsset,
  Clipboard,
  Clip,
  PasteAnchor,
  PathInterpolation,
  Selection,
  ToolMode,
  Track,
  Vec3,
} from '@/domain/types';

export type CubeMode = '2d' | '3d';

/**
 * Authored project state. Deliberately excludes anything the audio engine owns
 * (AudioBuffers, AudioNodes) and anything that changes every animation frame (the live
 * position of an automated source, the playhead) — those are driven imperatively so a moving
 * sound source does not re-render the timeline sixty times a second.
 */
interface ProjectState {
  tracks: Track[];
  /**
   * Project-level sample library, keyed by asset id.
   *
   * Assets live here rather than on tracks because copy-paste means one sample can appear on
   * several lanes at once; hanging it off a single track would make "which track owns it?"
   * unanswerable the moment a clip is pasted elsewhere.
   */
  assets: Record<string, AudioAsset>;
  projectDuration: number;
  masterVolume: number;
  /** The flat view (and the one saved in project files); see `cubeMode` for the 3D view. */
  currentView: ViewName;
  /**
   * Whether the cube shows a flat view or the free-orbit 3D view. Session UI state: kept apart
   * from `currentView` because the flat views' axis mapping, the inspector and project files all
   * depend on a flat view existing.
   */
  cubeMode: CubeMode;
  /**
   * The track the inspector shows. Separate from `selection`, which is a time range and is
   * cleared by Escape, while the inspector should keep showing the track you were working on.
   */
  selectedTrackId: string | null;
  /** Track whose path is being edited by clicking the cube; null when not editing. */
  editingTrackId: string | null;
  /** The dragged-out region on a lane that copy/cut/delete act on. */
  selection: Selection | null;
  clipboard: Clipboard | null;
  /** End of the last paste, so the next one on the same lane butts up against it. */
  pasteAnchor: PasteAnchor | null;
  /** Whether dragging a lane selects a region or moves audio. */
  toolMode: ToolMode;
  playing: boolean;
  /** What the last action did, for the status bar. Empty when there is nothing to report. */
  status: string;
  rendering: boolean;

  /** Picks a flat view, leaving 3D. */
  setView: (view: ViewName) => void;
  setCubeMode: (mode: CubeMode) => void;
  setDuration: (seconds: number) => void;
  setMasterVolume: (v: number) => void;
  setPlaying: (playing: boolean) => void;
  setStatus: (status: string) => void;
  setRendering: (rendering: boolean) => void;

  /** Points the inspector at a track. Selecting a different track disarms path editing. */
  selectTrack: (id: string | null) => void;
  addTrack: () => void;
  duplicateTrack: (id: string) => void;
  removeTrack: (id: string) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  /** Shows/hides a track's blip and path in the cube. Never affects audio. */
  toggleCubeVisible: (id: string) => void;
  showAllInCube: () => void;
  setVolume: (id: string, volume: number) => void;
  setTempo: (id: string, tempo: number) => void;
  setPosition: (id: string, partial: Partial<Vec3>) => void;
  setMotionMode: (id: string, mode: 'static' | 'path') => void;
  setPathLoopSec: (id: string, seconds: number) => void;
  setPathInterpolation: (id: string, interpolation: PathInterpolation) => void;
  toggleEditingPath: (id: string) => void;

  addPathPoint: (id: string, partial: Partial<Vec3>) => void;
  updatePathPoint: (id: string, index: number, partial: Partial<Vec3>) => void;
  undoPathPoint: (id: string) => void;
  clearPath: (id: string) => void;

  setTrackLoading: (id: string, loading: boolean) => void;
  registerAsset: (asset: AudioAsset) => void;
  markAssetMissing: (assetId: string) => void;
  /** Replaces a track's lane with one full-length looping clip — the upload/replace flow. */
  setTrackSample: (id: string, assetId: string) => void;

  setSelection: (selection: Selection | null) => void;
  setToolMode: (mode: ToolMode) => void;
  /**
   * Replaces a lane's clips outright. Drag gestures compute the new layout from a snapshot
   * taken when the drag began, using the pure helpers in `domain/clips`, then commit it here —
   * which keeps per-frame drag maths out of the store and non-compounding.
   */
  setTrackClips: (trackId: string, clips: Clip[]) => void;
  copySelection: () => void;
  cutSelection: () => void;
  deleteSelection: () => void;
  pasteAt: (trackId: string, atSeconds: number) => void;
  /** Ends the paste chain, so the next paste lands at the playhead again. */
  clearPasteAnchor: () => void;
  splitTrackAt: (trackId: string, atSeconds: number) => void;
  clearTrackClips: (trackId: string) => void;

  loadProject: (project: {
    projectDuration: number;
    masterVolume: number;
    currentView: ViewName;
    tracks: Track[];
    assets: Record<string, AudioAsset>;
  }) => void;
}

/**
 * Ten channels seeded on a circle of radius 3 m, first four active.
 * Prototype:
 *   const angle = (i/10)*Math.PI*2;
 *   x: Math.round(Math.cos(angle)*3*10)/10, y: 0, z: Math.round(Math.sin(angle)*3*10)/10
 */
export function createInitialTracks(): Track[] {
  return Array.from({ length: MAX_TRACKS }, (_, i) => {
    const angle = (i / MAX_TRACKS) * Math.PI * 2;
    return {
      id: `ch-${i}`,
      name: 'CH' + (i + 1).toString().padStart(2, '0'),
      color: COLORS[i]!,
      active: i < 4,
      clips: [],
      position: {
        x: Math.round(Math.cos(angle) * 3 * 10) / 10,
        y: 0,
        z: Math.round(Math.sin(angle) * 3 * 10) / 10,
      },
      volume: 0.8,
      muted: false,
      soloed: false,
      tempo: DEFAULT_TEMPO,
      motionMode: 'static' as const,
      path: [],
      pathLoopSec: 8,
      pathInterpolation: 'linear' as const,
      loading: false,
      cubeVisible: true,
    };
  });
}

/**
 * Tops a loaded track list back up to the full pool with inactive seed channels. A hand-edited
 * file with fewer tracks would otherwise shrink the pool for the rest of the session.
 */
export function fillChannelPool(tracks: Track[]): Track[] {
  if (tracks.length >= MAX_TRACKS) return tracks;
  const used = new Set(tracks.map((t) => t.id));
  const spare = createInitialTracks()
    .filter((t) => !used.has(t.id))
    .map((t) => ({ ...t, active: false }));
  return [...tracks, ...spare.slice(0, MAX_TRACKS - tracks.length)];
}

/** Applies `updater` to one track, leaving the rest referentially untouched. */
function mapTrack(
  tracks: Track[],
  id: string,
  updater: (track: Track) => Track,
): Track[] {
  return tracks.map((t) => (t.id === id ? updater(t) : t));
}

function firstActiveId(tracks: readonly Track[]): string | null {
  return tracks.find((t) => t.active)?.id ?? null;
}

/** Selection moves to `id`; path editing survives only if it was on that same track. */
function selecting(s: ProjectState, id: string | null) {
  return {
    selectedTrackId: id,
    editingTrackId: s.editingTrackId === id ? s.editingTrackId : null,
  };
}

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: createInitialTracks(),
  assets: {},
  projectDuration: DEFAULT_DURATION,
  masterVolume: DEFAULT_MASTER_VOLUME,
  currentView: 'front',
  cubeMode: '2d',
  selectedTrackId: 'ch-0',
  editingTrackId: null,
  selection: null,
  clipboard: null,
  pasteAnchor: null,
  toolMode: 'select',
  playing: false,
  status: '',
  rendering: false,

  setView: (currentView) => set({ currentView, cubeMode: '2d' }),
  setCubeMode: (cubeMode) => set({ cubeMode }),

  setDuration: (seconds) =>
    set((s) => {
      const projectDuration = clamp(
        Number.isFinite(seconds) ? Math.round(seconds) : DEFAULT_DURATION,
        MIN_DURATION,
        MAX_DURATION,
      );
      return {
        projectDuration,
        tracks: s.tracks.map((t) => {
          const clips = resizeSpanningLoops(t.clips, s.projectDuration, projectDuration);
          return clips === t.clips ? t : { ...t, clips };
        }),
      };
    }),

  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setPlaying: (playing) => set({ playing }),
  setStatus: (status) => set({ status }),
  setRendering: (rendering) => set({ rendering }),

  selectTrack: (id) => set((s) => selecting(s, id)),

  /** Prototype: activates the next inactive channel from the fixed pool of ten. */
  addTrack: () =>
    set((s) => {
      const next = s.tracks.find((t) => !t.active);
      if (!next) return s;
      return {
        tracks: mapTrack(s.tracks, next.id, (t) => ({ ...t, active: true })),
        ...selecting(s, next.id),
      };
    }),

  /**
   * Copies a track's entire configuration — clips, spatial position, keyframe path, levels —
   * onto the next free channel in the pool.
   *
   * Clips get fresh ids so the two lanes can be edited independently; sharing ids would make
   * a later "delete this clip" ambiguous. The asset ids are shared, which is the point: the
   * duplicate references the same audio without re-uploading or re-decoding it.
   */
  duplicateTrack: (id) =>
    set((s) => {
      const source = s.tracks.find((t) => t.id === id);
      if (!source) return s;

      const target = s.tracks.find((t) => !t.active);
      if (!target) return { ...s, status: `All ${MAX_TRACKS} channels are in use` };

      return {
        tracks: mapTrack(s.tracks, target.id, (t) => ({
          ...source,
          // Identity stays with the destination channel.
          id: t.id,
          name: t.name,
          color: t.color,
          active: true,
          loading: false,
          // A fresh channel starts visible even when copied from a hidden one; a duplicate that
          // silently never appears in the cube reads as a broken duplicate.
          cubeVisible: true,
          // Deep-copied so editing one track's path never mutates the other's.
          path: source.path.map((p) => ({ ...p })),
          position: { ...source.position },
          // Fresh ids rather than prefixed ones: prefixes grow with every duplicate of a
          // duplicate and eventually break the backend's 64-character id limit.
          clips: source.clips.map((c) => ({ ...c, id: nextClipId() })),
        })),
        ...selecting(s, target.id),
        status: `Duplicated ${source.name} → ${target.name}`,
      };
    }),

  /**
   * Prototype sets `active=false` but keeps the channel in the pool, so removing and
   * re-adding restores its previous settings. That behaviour is preserved.
   */
  removeTrack: (id) =>
    set((s) => {
      const tracks = mapTrack(s.tracks, id, (t) => ({ ...t, active: false }));
      return {
        tracks,
        selectedTrackId: s.selectedTrackId === id ? firstActiveId(tracks) : s.selectedTrackId,
        editingTrackId: s.editingTrackId === id ? null : s.editingTrackId,
        selection: s.selection?.trackId === id ? null : s.selection,
        pasteAnchor: s.pasteAnchor?.trackId === id ? null : s.pasteAnchor,
      };
    }),

  toggleMute: (id) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, muted: !t.muted })) })),

  toggleSolo: (id) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, soloed: !t.soloed })) })),

  /**
   * Hides a track's blip and path in the cube so an overlapping neighbour can be grabbed.
   *
   * Hiding also disarms path editing on that track: EDIT PATH turns cube clicks into keyframe
   * drops, and dropping keyframes onto a path you cannot see is a way to wreck it silently.
   */
  toggleCubeVisible: (id) =>
    set((s) => {
      const track = s.tracks.find((t) => t.id === id);
      if (!track) return s;
      const cubeVisible = !track.cubeVisible;
      return {
        tracks: mapTrack(s.tracks, id, (t) => ({ ...t, cubeVisible })),
        editingTrackId:
          !cubeVisible && s.editingTrackId === id ? null : s.editingTrackId,
        status: cubeVisible
          ? `${track.name} shown in the cube`
          : `${track.name} hidden in the cube — it still plays`,
      };
    }),

  showAllInCube: () =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.cubeVisible ? t : { ...t, cubeVisible: true })),
      status: 'All sources shown',
    })),

  setVolume: (id, volume) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => ({ ...t, volume: clamp(volume, 0, 1) })),
    })),

  setTempo: (id, tempo) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, tempo })) })),

  setPosition: (id, partial) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => ({
        ...t,
        position: { ...t.position, ...partial },
      })),
    })),

  setMotionMode: (id, motionMode) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => ({ ...t, motionMode })),
      editingTrackId:
        motionMode === 'static' && s.editingTrackId === id ? null : s.editingTrackId,
    })),

  setPathLoopSec: (id, pathLoopSec) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, pathLoopSec })) })),

  setPathInterpolation: (id, pathInterpolation) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, pathInterpolation })) })),

  // Arming also selects, so the inspector always shows the track that cube clicks will edit.
  toggleEditingPath: (id) =>
    set((s) =>
      s.editingTrackId === id
        ? { editingTrackId: null }
        : { editingTrackId: id, selectedTrackId: id },
    ),

  /**
   * Drops a keyframe. The two axes visible in the current view come from the click; the
   * locked axis carries over from the track's current position — which is what makes the
   * "rotate the cube, click again" workflow build a genuine 3D path.
   */
  addPathPoint: (id, partial) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => {
        const point: Vec3 = { ...t.position, ...partial };
        const path = [...t.path, point];
        return {
          ...t,
          path,
          position: path.length === 1 ? { ...t.position, ...partial } : t.position,
        };
      }),
    })),

  updatePathPoint: (id, index, partial) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => ({
        ...t,
        path: t.path.map((p, i) => (i === index ? { ...p, ...partial } : p)),
      })),
    })),

  undoPathPoint: (id) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => ({ ...t, path: t.path.slice(0, -1) })),
    })),

  clearPath: (id) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, path: [] })) })),

  setTrackLoading: (id, loading) =>
    set((s) => ({ tracks: mapTrack(s.tracks, id, (t) => ({ ...t, loading })) })),

  registerAsset: (asset) =>
    set((s) => ({ assets: { ...s.assets, [asset.assetId]: asset } })),

  markAssetMissing: (assetId) =>
    set((s) => {
      const existing = s.assets[assetId];
      if (!existing) return s;
      return { assets: { ...s.assets, [assetId]: { ...existing, missing: true } } };
    }),

  setTrackSample: (id, assetId) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, id, (t) => ({
        ...t,
        // Upload/replace resets the lane to the prototype's behaviour: one sample looping
        // across the whole project. Everything else about clips is opt-in from there.
        clips: [fullLengthLoopClip(assetId, s.projectDuration)],
        loading: false,
      })),
      // The lane this anchor pointed into no longer exists in that form.
      pasteAnchor: s.pasteAnchor?.trackId === id ? null : s.pasteAnchor,
    })),

  /*
   * Every one of the next few actions drops `pasteAnchor`. Pointing at a lane, dragging out a
   * region, editing clips or filling the clipboard afresh are all the user saying "here" — and
   * a paste chain that outlived that would drop audio somewhere they are no longer looking.
   * `pasteAt` sets the anchor through its own `set`, so it is unaffected by these.
   */
  // Working on a lane selects its track; clearing the range (Escape) leaves the inspector alone.
  setSelection: (selection) =>
    set((s) => ({
      selection,
      pasteAnchor: null,
      ...selecting(s, selection?.trackId ?? s.selectedTrackId),
    })),

  setToolMode: (toolMode) => set({ toolMode }),

  setTrackClips: (trackId, clips) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, trackId, (t) => ({ ...t, clips })),
      pasteAnchor: null,
    })),

  copySelection: () =>
    set((s) => {
      const sel = s.selection;
      if (!sel) return { status: 'Nothing selected' };
      const track = s.tracks.find((t) => t.id === sel.trackId);
      if (!track) return s;

      const items = copyRegion(track.clips, sel.startSeconds, sel.endSeconds, track.tempo);
      if (items.length === 0) return { status: 'Selection is empty — nothing to copy' };

      return {
        clipboard: { items, durationSeconds: sel.endSeconds - sel.startSeconds },
        pasteAnchor: null,
        status: `Copied ${(sel.endSeconds - sel.startSeconds).toFixed(2)}s from ${track.name}`,
      };
    }),

  cutSelection: () =>
    set((s) => {
      const sel = s.selection;
      if (!sel) return { status: 'Nothing selected' };
      const track = s.tracks.find((t) => t.id === sel.trackId);
      if (!track) return s;

      const items = copyRegion(track.clips, sel.startSeconds, sel.endSeconds, track.tempo);
      if (items.length === 0) return { status: 'Selection is empty — nothing to cut' };

      return {
        clipboard: { items, durationSeconds: sel.endSeconds - sel.startSeconds },
        pasteAnchor: null,
        tracks: mapTrack(s.tracks, sel.trackId, (t) => ({
          ...t,
          clips: removeRegion(t.clips, sel.startSeconds, sel.endSeconds, t.tempo),
        })),
        status: `Cut ${(sel.endSeconds - sel.startSeconds).toFixed(2)}s from ${track.name}`,
      };
    }),

  deleteSelection: () =>
    set((s) => {
      const sel = s.selection;
      if (!sel) return { status: 'Nothing selected' };
      return {
        tracks: mapTrack(s.tracks, sel.trackId, (t) => ({
          ...t,
          clips: removeRegion(t.clips, sel.startSeconds, sel.endSeconds, t.tempo),
        })),
        pasteAnchor: null,
        status: 'Deleted the selection',
      };
    }),

  /**
   * Pastes the clipboard onto a lane as a new clip.
   *
   * The first paste aims at the playhead; each further paste onto the *same* lane aims directly
   * after the one before it, so holding Ctrl+V builds a run of clips. A paste never overwrites or
   * overlaps: if its spot is taken it shifts to the nearest gap that fits (`pasteClips`).
   */
  pasteAt: (trackId, atSeconds) =>
    set((s) => {
      const board = s.clipboard;
      if (!board || board.items.length === 0) return { status: 'Clipboard is empty' };
      const track = s.tracks.find((t) => t.id === trackId);
      if (!track) return s;

      const chained = s.pasteAnchor?.trackId === trackId;
      const desired = pasteStartSeconds(s.pasteAnchor, trackId, atSeconds, s.projectDuration);
      const span = board.durationSeconds;

      const result = pasteClips(track.clips, board.items, desired, span, s.projectDuration);
      if (!result) {
        return { status: `No room on ${track.name} for ${span.toFixed(2)}s — clear space or lengthen the project` };
      }

      const at = result.startSeconds;
      const endSeconds = at + span;
      const shifted = Math.abs(at - desired) > 1e-6 ? ' (shifted to fit)' : '';

      return {
        tracks: mapTrack(s.tracks, trackId, (t) => ({ ...t, clips: result.clips })),
        selection: { trackId, startSeconds: at, endSeconds },
        pasteAnchor: { trackId, endSeconds },
        status: `${chained ? 'Appended' : 'Pasted'} ${span.toFixed(2)}s ${chained ? 'to' : 'into'} ${track.name} at ${at.toFixed(2)}s${shifted}`,
      };
    }),

  clearPasteAnchor: () => set({ pasteAnchor: null }),

  splitTrackAt: (trackId, atSeconds) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, trackId, (t) => ({
        ...t,
        clips: splitAt(t.clips, atSeconds, t.tempo),
      })),
      pasteAnchor: null,
      status: 'Split at the playhead',
    })),

  clearTrackClips: (trackId) =>
    set((s) => ({
      tracks: mapTrack(s.tracks, trackId, (t) => ({ ...t, clips: [] })),
      selection: s.selection?.trackId === trackId ? null : s.selection,
      pasteAnchor: s.pasteAnchor?.trackId === trackId ? null : s.pasteAnchor,
    })),

  loadProject: ({ projectDuration, masterVolume, currentView, tracks, assets }) =>
    set({
      projectDuration,
      masterVolume,
      currentView,
      tracks: fillChannelPool(tracks),
      assets,
      selectedTrackId: firstActiveId(tracks),
      editingTrackId: null,
      selection: null,
      // Its samples belong to the old project's library, whose buffers were just dropped.
      clipboard: null,
      pasteAnchor: null,
      rendering: false,
    }),
}));

/**
 * Development-only handle on the store.
 *
 * Clips are drawn to a canvas, so their geometry is invisible to the DOM — there is no way to
 * inspect or assert on the timeline from the outside without this. Stripped from production
 * builds by the environment check.
 */
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __greanteafxStore: typeof useProjectStore }).__greanteafxStore =
    useProjectStore;
}

export const selectActiveTracks = (s: ProjectState): Track[] =>
  s.tracks.filter((t) => t.active);

/** The distinct samples a lane references, for the track header summary. */
export function trackAssets(track: Track, assets: Record<string, AudioAsset>): AudioAsset[] {
  const ids = [...new Set(track.clips.map((c) => c.assetId))];
  return ids.map((id) => assets[id]).filter((a): a is AudioAsset => Boolean(a));
}

export type { Clip };
