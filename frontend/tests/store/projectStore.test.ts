import { beforeEach, describe, expect, it } from 'vitest';

import {
  createInitialTracks,
  fillChannelPool,
  selectActiveTracks,
  trackAssets,
  useProjectStore,
} from '@/store/projectStore';
import type { AudioAsset, Track } from '@/domain/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const asset = (assetId: string): AudioAsset => ({
  assetId,
  fileName: 'loop.wav',
  durationSeconds: 2,
  sampleRate: 48000,
  channelCount: 2,
  peaks: [-0.5, 0.5],
});

const state = () => useProjectStore.getState();
const track = (id: string): Track => state().tracks.find((t) => t.id === id)!;

/** Loads a sample onto ch-0 as a full-length loop, the way an upload does. */
function loadSample() {
  state().registerAsset(asset(A));
  state().setTrackSample('ch-0', A);
}

beforeEach(() => {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
});

describe('initial state', () => {
  it('seeds ten channels on a 3 m circle with the first four active', () => {
    const tracks = createInitialTracks();
    expect(tracks).toHaveLength(10);
    expect(tracks.filter((t) => t.active).map((t) => t.id)).toEqual(['ch-0', 'ch-1', 'ch-2', 'ch-3']);
    expect(tracks[0]!.position).toEqual({ x: 3, y: 0, z: 0 });
    expect(selectActiveTracks(state())).toHaveLength(4);
  });
});

describe('track pool', () => {
  it('addTrack activates the next free channel and stops at ten', () => {
    state().addTrack();
    expect(track('ch-4').active).toBe(true);
    for (let i = 0; i < 10; i++) state().addTrack();
    expect(selectActiveTracks(state())).toHaveLength(10);
  });

  it('removeTrack keeps settings and drops selection, anchor and path editing on it', () => {
    state().setVolume('ch-1', 0.3);
    state().toggleEditingPath('ch-1');
    state().setSelection({ trackId: 'ch-1', startSeconds: 0, endSeconds: 1 });
    state().removeTrack('ch-1');
    expect(track('ch-1')).toMatchObject({ active: false, volume: 0.3 });
    expect(state().editingTrackId).toBeNull();
    expect(state().selection).toBeNull();
  });

  it('duplicateTrack copies onto a free channel with its own identity and fresh clip ids', () => {
    loadSample();
    state().addPathPoint('ch-0', { x: 1, y: 1 });
    state().toggleCubeVisible('ch-0');
    state().duplicateTrack('ch-0');

    const copy = track('ch-4');
    expect(copy).toMatchObject({ id: 'ch-4', name: 'CH05', active: true, cubeVisible: true });
    expect(copy.color).toBe(createInitialTracks()[4]!.color);
    expect(copy.clips[0]!.assetId).toBe(A);
    expect(copy.clips[0]!.id).not.toBe(track('ch-0').clips[0]!.id);
    expect(copy.path).toEqual(track('ch-0').path);
    expect(copy.path).not.toBe(track('ch-0').path);
  });

  it('keeps clip ids short across repeated duplicate and remove cycles', () => {
    loadSample();
    // Each round duplicates the previous duplicate, then frees its source for the next round.
    let source = 'ch-0';
    for (let i = 0; i < 25; i++) {
      const before = new Set(selectActiveTracks(state()).map((t) => t.id));
      state().duplicateTrack(source);
      const created = selectActiveTracks(state()).find((t) => !before.has(t.id))!;
      state().removeTrack(source);
      source = created.id;
    }
    const ids = state().tracks.flatMap((t) => t.clips.map((c) => c.id));
    // The render API rejects ids longer than 64 characters.
    expect(Math.max(...ids.map((id) => id.length))).toBeLessThanOrEqual(64);
  });

  it('reports when every channel is in use', () => {
    for (let i = 0; i < 6; i++) state().addTrack();
    state().duplicateTrack('ch-0');
    expect(state().status).toMatch(/All 10 channels are in use/);
  });
});

describe('selected track', () => {
  it('starts on the first channel and follows lane selections, but not their clearing', () => {
    expect(state().selectedTrackId).toBe('ch-0');
    state().setSelection({ trackId: 'ch-2', startSeconds: 0, endSeconds: 1 });
    expect(state().selectedTrackId).toBe('ch-2');
    state().setSelection(null);
    expect(state().selectedTrackId).toBe('ch-2');
  });

  it('arming path editing selects the track; selecting another one disarms it', () => {
    state().toggleEditingPath('ch-1');
    expect(state().selectedTrackId).toBe('ch-1');
    state().selectTrack('ch-1');
    state().setSelection({ trackId: 'ch-1', startSeconds: 0, endSeconds: 1 });
    expect(state().editingTrackId).toBe('ch-1');
    state().selectTrack('ch-2');
    expect(state().editingTrackId).toBeNull();
  });

  it('moves to the channel that adding or duplicating brings in', () => {
    state().addTrack();
    expect(state().selectedTrackId).toBe('ch-4');
    state().duplicateTrack('ch-0');
    expect(state().selectedTrackId).toBe('ch-5');
  });

  it('falls back to the first active track when the selected one is removed', () => {
    state().selectTrack('ch-2');
    state().removeTrack('ch-2');
    expect(state().selectedTrackId).toBe('ch-0');
    state().removeTrack('ch-1');
    expect(state().selectedTrackId).toBe('ch-0');
    state().removeTrack('ch-0');
    state().removeTrack('ch-3');
    expect(state().selectedTrackId).toBeNull();
  });
});

describe('cube mode', () => {
  it('3D is left by picking a flat view, which keeps its own axis mapping', () => {
    expect(state().cubeMode).toBe('2d');
    state().setCubeMode('3d');
    expect(state()).toMatchObject({ cubeMode: '3d', currentView: 'front' });
    state().setView('top');
    expect(state()).toMatchObject({ cubeMode: '2d', currentView: 'top' });
  });
});

describe('solo', () => {
  it('toggles per track and travels with a duplicate', () => {
    state().toggleSolo('ch-1');
    expect(track('ch-1').soloed).toBe(true);
    state().duplicateTrack('ch-1');
    expect(track('ch-4').soloed).toBe(true);
    state().toggleSolo('ch-1');
    expect(track('ch-1').soloed).toBe(false);
  });
});

describe('track settings', () => {
  it('clamps volume', () => {
    state().setVolume('ch-0', 5);
    expect(track('ch-0').volume).toBe(1);
  });

  it('merges a partial position, keeping the locked axis', () => {
    state().setPosition('ch-0', { x: -2 });
    expect(track('ch-0').position).toEqual({ x: -2, y: 0, z: 0 });
  });

  it('switching to static motion disarms path editing on that track', () => {
    state().setMotionMode('ch-0', 'path');
    state().toggleEditingPath('ch-0');
    state().setMotionMode('ch-0', 'static');
    expect(state().editingTrackId).toBeNull();
  });

  it('hiding a track in the cube disarms path editing but changes nothing audible', () => {
    state().toggleEditingPath('ch-0');
    const before = track('ch-0');
    state().toggleCubeVisible('ch-0');
    expect(state().editingTrackId).toBeNull();
    expect(track('ch-0')).toEqual({ ...before, cubeVisible: false });
    state().showAllInCube();
    expect(track('ch-0').cubeVisible).toBe(true);
  });

  it('the first keyframe also moves the source; later ones do not', () => {
    state().addPathPoint('ch-0', { x: 1, y: 2 });
    expect(track('ch-0').position).toEqual({ x: 1, y: 2, z: 0 });
    state().addPathPoint('ch-0', { x: -1, y: -2 });
    expect(track('ch-0').position).toEqual({ x: 1, y: 2, z: 0 });
    expect(track('ch-0').path).toHaveLength(2);

    state().updatePathPoint('ch-0', 1, { y: 5 });
    expect(track('ch-0').path[1]).toEqual({ x: -1, y: 5, z: 0 });
    state().undoPathPoint('ch-0');
    expect(track('ch-0').path).toHaveLength(1);
    state().clearPath('ch-0');
    expect(track('ch-0').path).toEqual([]);
  });
});

describe('project length', () => {
  it('rounds and clamps', () => {
    state().setDuration(42.6);
    expect(state().projectDuration).toBe(43);
    state().setDuration(1);
    expect(state().projectDuration).toBe(3);
    state().setDuration(Number.NaN);
    expect(state().projectDuration).toBe(30);
  });

  it('carries a full-length sample loop to the new length', () => {
    loadSample();
    state().setDuration(90);
    expect(track('ch-0').clips[0]!.durationSeconds).toBe(90);
  });
});

describe('clip editing', () => {
  beforeEach(loadSample);

  it('setTrackSample makes one full-length looping clip', () => {
    expect(track('ch-0').clips).toEqual([
      expect.objectContaining({ assetId: A, startSeconds: 0, durationSeconds: 30, loop: true }),
    ]);
  });

  it('copy then paste lands at the playhead, and repeat pastes line up end to end', () => {
    state().setSelection({ trackId: 'ch-0', startSeconds: 2, endSeconds: 4 });
    state().copySelection();
    expect(state().clipboard?.durationSeconds).toBe(2);

    state().pasteAt('ch-1', 5);
    state().pasteAt('ch-1', 5);
    state().pasteAt('ch-1', 5);

    expect(track('ch-1').clips.map((c) => c.startSeconds)).toEqual([5, 7, 9]);
    expect(state().pasteAnchor).toEqual({ trackId: 'ch-1', endSeconds: 11 });
    expect(state().selection).toEqual({ trackId: 'ch-1', startSeconds: 9, endSeconds: 11 });
    expect(state().status).toMatch(/^Appended/);
  });

  it('cut removes the region and fills the clipboard', () => {
    state().setSelection({ trackId: 'ch-0', startSeconds: 10, endSeconds: 12 });
    state().cutSelection();
    expect(state().clipboard?.items).toHaveLength(1);
    expect(track('ch-0').clips.map((c) => [c.startSeconds, c.durationSeconds])).toEqual([
      [0, 10],
      [12, 18],
    ]);
  });

  it.each([
    ['setSelection', () => state().setSelection({ trackId: 'ch-1', startSeconds: 0, endSeconds: 0 })],
    ['deleteSelection', () => state().deleteSelection()],
    ['splitTrackAt', () => state().splitTrackAt('ch-1', 6)],
    ['setTrackClips', () => state().setTrackClips('ch-1', [])],
    ['clearTrackClips', () => state().clearTrackClips('ch-1')],
  ])('%s ends the paste chain', (_name, act) => {
    state().setSelection({ trackId: 'ch-0', startSeconds: 2, endSeconds: 4 });
    state().copySelection();
    state().pasteAt('ch-1', 5);
    expect(state().pasteAnchor).not.toBeNull();
    act();
    expect(state().pasteAnchor).toBeNull();
  });

  it('delete leaves silence where the selection was', () => {
    state().setSelection({ trackId: 'ch-0', startSeconds: 0, endSeconds: 5 });
    state().deleteSelection();
    expect(track('ch-0').clips[0]!.startSeconds).toBe(5);
  });

  it('shifts a paste that would run past the end, and refuses only when nothing fits', () => {
    state().setSelection({ trackId: 'ch-0', startSeconds: 0, endSeconds: 20 });
    state().copySelection();
    state().pasteAt('ch-1', 15);
    expect(track('ch-1').clips[0]!.startSeconds).toBe(10);
    expect(state().status).toMatch(/shifted to fit/);

    const before = track('ch-1').clips;
    state().pasteAt('ch-1', 15);
    expect(state().status).toMatch(/^No room on CH02/);
    expect(track('ch-1').clips).toBe(before);
  });

  it('pasting onto existing audio never removes any of it', () => {
    state().setSelection({ trackId: 'ch-0', startSeconds: 0, endSeconds: 2 });
    state().copySelection();
    state().splitTrackAt('ch-0', 10);
    const before = track('ch-0').clips.reduce((n, c) => n + c.durationSeconds, 0);
    state().deleteSelection();
    state().pasteAt('ch-0', 5);
    const after = track('ch-0').clips.reduce((n, c) => n + c.durationSeconds, 0);
    expect(after).toBe(before);
  });

  it('explains empty selections and clipboards', () => {
    state().setSelection(null);
    state().copySelection();
    expect(state().status).toBe('Nothing selected');
    state().setSelection({ trackId: 'ch-2', startSeconds: 0, endSeconds: 3 });
    state().copySelection();
    expect(state().status).toMatch(/Selection is empty/);
    state().pasteAt('ch-2', 0);
    expect(state().status).toBe('Clipboard is empty');
  });

  it('split cuts the clip under the given time', () => {
    state().splitTrackAt('ch-0', 12);
    expect(track('ch-0').clips.map((c) => c.startSeconds)).toEqual([0, 12]);
  });
});

describe('assets', () => {
  it('markAssetMissing flags a known asset and ignores unknown ones', () => {
    state().registerAsset(asset(A));
    state().markAssetMissing(A);
    state().markAssetMissing(B);
    expect(state().assets[A]!.missing).toBe(true);
    expect(state().assets[B]).toBeUndefined();
  });

  it('trackAssets lists each referenced sample once', () => {
    loadSample();
    state().splitTrackAt('ch-0', 10);
    expect(trackAssets(track('ch-0'), state().assets).map((a) => a.assetId)).toEqual([A]);
  });
});

describe('loadProject', () => {
  it('replaces the session, clears the clipboard and refills the channel pool', () => {
    loadSample();
    state().setSelection({ trackId: 'ch-0', startSeconds: 0, endSeconds: 2 });
    state().copySelection();

    state().loadProject({
      projectDuration: 60,
      masterVolume: 0.4,
      currentView: 'side',
      tracks: createInitialTracks().slice(0, 3),
      assets: {},
    });

    expect(state()).toMatchObject({
      projectDuration: 60,
      masterVolume: 0.4,
      currentView: 'side',
      clipboard: null,
      selection: null,
      pasteAnchor: null,
      selectedTrackId: 'ch-0',
    });
    expect(state().tracks).toHaveLength(10);
  });
});

describe('fillChannelPool', () => {
  it('pads with inactive seed channels whose ids are not already used', () => {
    const custom = { ...createInitialTracks()[0]!, id: 'ch-7' };
    const pool = fillChannelPool([custom]);
    expect(pool).toHaveLength(10);
    expect(new Set(pool.map((t) => t.id)).size).toBe(10);
    expect(pool.slice(1).every((t) => !t.active)).toBe(true);
  });

  it('leaves a full pool untouched', () => {
    const full = createInitialTracks();
    expect(fillChannelPool(full)).toBe(full);
  });
});
