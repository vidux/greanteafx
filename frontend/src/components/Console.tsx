'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getPreviewEngine } from '@/audio/PreviewEngine';
import { editTargetId, soloActive } from '@/domain/tracks';
import type { Selection, Vec3 } from '@/domain/types';
import {
  ApiError,
  downloadBlob,
  fetchAssetBytes,
  renderMixdown,
  uploadSample,
} from '@/lib/api';
import { isAudioFile } from '@/lib/audioFile';
import { formatClock } from '@/lib/format';
import {
  deserializeProject,
  ProjectFileError,
  serializeProject,
  suggestedFileName,
} from '@/lib/projectFile';
import { useProjectStore } from '@/store/projectStore';

import { AppHeader } from './AppHeader';
import { CubePanel } from './CubePanel';
import type { CubeOverlayHandle } from './CubeOverlay';
import { GuideDialog } from './GuideDialog';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { Timeline } from './Timeline';

/**
 * Wires the authored project state to the two things that are not React: the Web Audio
 * preview graph and the per-frame animation loop.
 *
 * Division of labour:
 *  - the store owns what the user authored (clips, positions, keyframes, levels, tempo);
 *  - the preview engine owns the audio graph and the clip schedule;
 *  - the animation frame loop moves automated sources, the playheads and the clock by writing to
 *    the DOM directly, so continuous motion never triggers a React render.
 */
export function Console({ onReady }: { onReady?: () => void } = {}) {
  const store = useProjectStore();

  // Waits a frame so the console has painted before the loading cover lifts off it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [onReady]);
  const engine = getPreviewEngine();

  const overlayRef = useRef<CubeOverlayHandle>(null);
  const lanesHeadRef = useRef<HTMLDivElement>(null);
  const rulerHeadRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  const [guideOpen, setGuideOpen] = useState(false);
  const guideOpenRef = useRef(guideOpen);
  guideOpenRef.current = guideOpen;

  /**
   * The animation loop runs for the page's whole lifetime and must not be torn down and
   * rebuilt on every state change, so it reads live state through a ref instead of closing
   * over it.
   */
  const liveState = useRef({ tracks: store.tracks, projectDuration: store.projectDuration });
  liveState.current = { tracks: store.tracks, projectDuration: store.projectDuration };

  // Keep the audio graph in step with the authored state.
  useEffect(() => {
    engine.syncTracks(store.tracks);
  }, [engine, store.tracks]);

  useEffect(() => {
    engine.setMasterVolume(store.masterVolume);
  }, [engine, store.masterVolume]);

  /**
   * Editing clips during playback has to re-queue the schedule: sources were started with
   * fixed start/stop times, so a clip that just moved is still playing where it used to be.
   *
   * Keyed on the clip arrays only — re-queueing on every volume nudge would restart audio
   * constantly.
   */
  const clipSignature = store.tracks
    .map((t) => `${t.id}:${t.active ? 'A' : ''}:${t.tempo}:${t.clips.map((c) => `${c.id}@${c.startSeconds}+${c.durationSeconds}#${c.offsetSeconds}${c.loop ? 'L' : ''}`).join(',')}`)
    .join('|');

  /*
   * A length change re-anchors the transport: the queued passes were laid out for the old
   * length, and wrapping the old position by the new length would jump the playhead. Declared
   * before the reschedule effect so that one sees the re-anchored transport.
   */
  const previousDuration = useRef(store.projectDuration);
  useEffect(() => {
    const before = previousDuration.current;
    previousDuration.current = store.projectDuration;
    if (before === store.projectDuration) return;
    const at = engine.transportTime(before);
    engine.seek(Math.min(at, store.projectDuration), liveState.current.tracks, store.projectDuration);
  }, [engine, store.projectDuration]);

  useEffect(() => {
    engine.reschedule(liveState.current.tracks, liveState.current.projectDuration);
  }, [engine, clipSignature]);

  // Prototype `motionLoop` + `playheadLoop`, merged into a single rAF.
  useEffect(() => {
    let frame = 0;
    let previousTransport = 0;
    let shownClock = '';

    const loop = () => {
      const { tracks, projectDuration } = liveState.current;

      const livePositions = engine.tick(tracks, projectDuration);
      if (livePositions.size > 0) overlayRef.current?.applyLivePositions(livePositions);

      const transport = engine.transportTime(projectDuration);

      /*
       * A drop in transport position means the project just looped. With clips there is no
       * eternally looping source to carry audio across that seam, so the engine has to be told
       * to queue the next repeat.
       */
      if (engine.isPlaying && transport < previousTransport) {
        engine.onProjectWrapped(tracks, projectDuration);
      }
      previousTransport = transport;

      // Painted whether or not the transport is running, so a seek while stopped moves the
      // playhead immediately instead of waiting for playback to resume.
      const pct = transport / projectDuration;
      const lanesHead = lanesHeadRef.current;
      if (lanesHead) {
        lanesHead.style.left = `calc(var(--header-w) + (100% - var(--header-w)) * ${pct})`;
      }
      const rulerHead = rulerHeadRef.current;
      if (rulerHead) rulerHead.style.left = `${pct * 100}%`;

      const clock = formatClock(transport);
      if (clock !== shownClock && clockRef.current) {
        clockRef.current.textContent = clock;
        shownClock = clock;
      }

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  /*
   * A file dropped anywhere but a lane would make the browser open it in place of the page,
   * throwing away the unsaved session. Lanes accept drops themselves (their handlers prevent the
   * default first); everywhere else the drop is refused.
   */
  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (carriesFiles(e) && !e.defaultPrevented) e.preventDefault();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // ---------------------------------------------------------------- transport

  const handleTogglePlay = useCallback(async () => {
    await engine.resume();

    if (engine.isPlaying) {
      engine.stop(liveState.current.projectDuration);
      store.setPlaying(false);
      store.setStatus('');
      return;
    }

    engine.start(liveState.current.tracks, liveState.current.projectDuration);
    store.setPlaying(true);
    store.setStatus('');
  }, [engine, store]);

  /** Scrubbing the ruler. Works stopped or playing; sources re-queue at the matching offsets. */
  const handleSeek = useCallback(
    (seconds: number) => {
      const { tracks, projectDuration } = liveState.current;
      engine.seek(seconds, tracks, projectDuration);
      // Moving the playhead is the user saying where the next paste goes, so it ends any run of
      // appended pastes rather than continuing one from a position they have just left.
      store.clearPasteAnchor();
    },
    [engine, store],
  );

  const handleRewind = useCallback(() => handleSeek(0), [handleSeek]);

  /** Stop, unlike pause, also returns the playhead to the start. */
  const handleStop = useCallback(() => {
    engine.stop(liveState.current.projectDuration);
    store.setPlaying(false);
    store.setStatus('');
    handleSeek(0);
  }, [engine, store, handleSeek]);

  // ---------------------------------------------------------------- upload

  /**
   * A sample is needed in two places, so it is used in two ways:
   *  - decoded locally into an AudioBuffer for the interactive preview (never leaves the tab);
   *  - uploaded to the backend, which decodes it again to extract the waveform envelope and
   *    caches the bytes for the mixdown.
   *
   * Both run concurrently; the preview becomes audible as soon as the local decode lands,
   * without waiting on the network.
   */
  const handleUpload = useCallback(
    async (trackId: string, file: File) => {
      const track = liveState.current.tracks.find((t) => t.id === trackId);
      if (!track) return;

      if (!isAudioFile(file)) {
        store.setStatus(`${file.name} is not an audio file — try MP3, WAV, FLAC or OGG`);
        return;
      }

      store.setTrackLoading(trackId, true);
      store.setStatus(`Decoding ${file.name} for ${track.name}…`);

      // Created here so the sample rate is settled before anything is decoded at it.
      engine.ensureContext();

      try {
        /*
         * Read the picked file exactly once. Reading the `File` twice — for decode and for the
         * upload's FormData — races two reads against a handle the browser may already have
         * released, which surfaces as a `NotFoundError` on one of them.
         */
        const bytes = await file.arrayBuffer();

        // Built before decoding: `decodeAudioData` detaches the ArrayBuffer it is handed, and
        // the File constructor copies, so this must happen first.
        const uploadFile = new File([bytes], file.name || 'sample', {
          type: file.type || 'application/octet-stream',
        });

        const asset = await uploadSample(uploadFile, engine.sampleRate);
        await engine.loadAsset(asset.assetId, bytes);

        store.registerAsset(asset);
        store.setTrackSample(trackId, asset.assetId);
        store.setStatus(`Loaded ${asset.fileName} on ${track.name}`);
      } catch (error) {
        store.setTrackLoading(trackId, false);
        store.setStatus(
          error instanceof ApiError
            ? `Upload failed — ${error.message}`
            : 'Could not decode that file — try another',
        );
        console.error('[greanteafx] sample load failed', error);
      }
    },
    [engine, store],
  );

  // ---------------------------------------------------------------- render

  /**
   * "Export mix" — the prototype's `renderMixdown` + `downloadWav`, except the offline render
   * now happens on the server. The browser sends the project graph and asset ids and gets a
   * finished WAV back.
   */
  const handleRender = useCallback(async () => {
    const state = useProjectStore.getState();

    const hasAudio = state.tracks.some(
      (t) => t.active && t.clips.some((c) => state.assets[c.assetId] && !state.assets[c.assetId]!.missing),
    );
    if (!hasAudio) {
      store.setStatus('Nothing to export — add audio to at least one track');
      return;
    }

    store.setRendering(true);
    store.setStatus('Rendering the mix…');

    // A forgotten solo would export one track; say so rather than let it surprise.
    const soloed = soloActive(state.tracks)
      ? state.tracks.filter((t) => t.active && t.soloed).map((t) => t.name)
      : [];
    const soloNote = soloed.length > 0 ? ` (solo: ${soloed.join(', ')})` : '';

    try {
      const { blob, renderMs } = await renderMixdown({
        durationSeconds: state.projectDuration,
        masterVolume: state.masterVolume,
        sampleRate: engine.sampleRate,
        tracks: state.tracks,
        assets: state.assets,
      });

      downloadBlob(blob, `greanteafx-mixdown-${Date.now()}.wav`);
      store.setStatus(
        renderMs !== null
          ? `Mix exported — rendered in ${renderMs} ms${soloNote}`
          : `Mix exported${soloNote}`,
      );
    } catch (error) {
      console.error('[greanteafx] render failed', error);
      store.setStatus(
        error instanceof ApiError
          ? `Export failed — ${error.message}`
          : 'Export failed — is the render service running?',
      );
    } finally {
      store.setRendering(false);
    }
  }, [engine, store]);

  // ---------------------------------------------------------------- project files

  /** Writes a `.gtfx` file. Asset ids and waveform peaks; the audio itself stays server-side. */
  const handleSaveProject = useCallback(() => {
    const state = useProjectStore.getState();
    const file = serializeProject({
      projectDuration: state.projectDuration,
      masterVolume: state.masterVolume,
      currentView: state.currentView,
      tracks: state.tracks,
      assets: state.assets,
    });

    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    downloadBlob(blob, suggestedFileName());

    const clips = state.tracks.reduce((n, t) => n + (t.active ? t.clips.length : 0), 0);
    store.setStatus(`Project saved — ${clips} clip${clips === 1 ? '' : 's'}`);
  }, [store]);

  /**
   * Opens a `.gtfx` file and rebuilds the session.
   *
   * The file carries asset *ids*, so each sample's bytes are fetched back from the server and
   * decoded locally to restore the preview buffers. An asset that has aged out of the server
   * cache is not fatal: its waveform still draws from the peaks saved in the file, and it is
   * flagged so the user knows to re-upload just that one.
   */
  const handleOpenProject = useCallback(
    async (file: File) => {
      store.setStatus('Opening project…');

      let parsed;
      try {
        parsed = deserializeProject(JSON.parse(await file.text()));
      } catch (error) {
        store.setStatus(
          error instanceof ProjectFileError
            ? `Could not open the project — ${error.message}`
            : 'Could not open the project — the file is not valid JSON',
        );
        return;
      }

      // Tear down the old session before adopting the new one.
      engine.stop(liveState.current.projectDuration);
      engine.clearAssets();
      store.setPlaying(false);

      store.loadProject(parsed);
      engine.ensureContext();
      engine.seek(0, parsed.tracks, parsed.projectDuration);

      const assetIds = Object.keys(parsed.assets);
      const results = await Promise.all(
        assetIds.map(async (assetId) => {
          try {
            const bytes = await fetchAssetBytes(assetId);
            if (!bytes) return { assetId, missing: true };
            await engine.loadAsset(assetId, bytes);
            return { assetId, missing: false };
          } catch (error) {
            console.error('[greanteafx] could not restore sample', assetId, error);
            return { assetId, missing: true };
          }
        }),
      );

      const missing = results.filter((r) => r.missing);
      for (const r of missing) store.markAssetMissing(r.assetId);

      // Playback may have started while samples were still downloading; queue the ones now loaded.
      engine.reschedule(liveState.current.tracks, liveState.current.projectDuration);

      store.setStatus(
        missing.length === 0
          ? `Project opened — ${assetIds.length} sample${assetIds.length === 1 ? '' : 's'} restored`
          : `Project opened — ${missing.length} sample${missing.length === 1 ? '' : 's'} expired; re-upload to export`,
      );
    },
    [engine, store],
  );

  // ---------------------------------------------------------------- clip editing

  const targetTrackId = useCallback((): string | null => {
    const state = useProjectStore.getState();
    return editTargetId(state.tracks, state.selectedTrackId, state.selection);
  }, []);

  const handlePaste = useCallback(() => {
    const state = useProjectStore.getState();
    // At the playhead on the selected track — the same rule a video editor uses, so where it
    // lands is predictable.
    const trackId = targetTrackId();
    if (!trackId) return;
    state.pasteAt(trackId, engine.transportTime(state.projectDuration));
  }, [engine, targetTrackId]);

  const handleSplit = useCallback(() => {
    const state = useProjectStore.getState();
    const trackId = targetTrackId();
    if (!trackId) return;
    state.splitTrackAt(trackId, engine.transportTime(state.projectDuration));
  }, [engine, targetTrackId]);

  /** Keyboard shortcuts. Ignored while typing, so a project length of "42" still works. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The guide is modal; it handles its own keys (Escape closes it).
      if (guideOpenRef.current) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const meta = e.ctrlKey || e.metaKey;
      const state = useProjectStore.getState();

      if (meta && e.key.toLowerCase() === 'c') {
        state.copySelection();
        e.preventDefault();
      } else if (meta && e.key.toLowerCase() === 'x') {
        state.cutSelection();
        e.preventDefault();
      } else if (meta && e.key.toLowerCase() === 'v') {
        handlePaste();
        e.preventDefault();
      } else if (meta && e.key.toLowerCase() === 'd') {
        const id = targetTrackId();
        if (id) state.duplicateTrack(id);
        e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        state.deleteSelection();
        e.preventDefault();
      } else if (e.key.toLowerCase() === 's' && !meta) {
        handleSplit();
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'v' && !meta) {
        state.setToolMode('select');
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'm' && !meta) {
        state.setToolMode('move');
        e.preventDefault();
      } else if (e.key === ' ') {
        void handleTogglePlay();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        state.setSelection(null);
        if (state.editingTrackId) state.toggleEditingPath(state.editingTrackId);
      } else if (e.key === '?') {
        setGuideOpen(true);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePaste, handleSplit, handleTogglePlay, targetTrackId]);

  const handleSelect = useCallback(
    (selection: Selection | null) => store.setSelection(selection),
    [store],
  );

  // ---------------------------------------------------------------- cube

  const handleMovePosition = useCallback(
    (trackId: string, partial: Partial<Vec3>) => store.setPosition(trackId, partial),
    [store],
  );

  const handleMovePathPoint = useCallback(
    (trackId: string, index: number, partial: Partial<Vec3>) =>
      store.updatePathPoint(trackId, index, partial),
    [store],
  );

  const handleAddPathPoint = useCallback(
    (trackId: string, partial: Partial<Vec3>) => store.addPathPoint(trackId, partial),
    [store],
  );

  /** Removing a track silences it but keeps its settings in the pool, as the prototype did. */
  const handleRemove = useCallback(
    (trackId: string) => store.removeTrack(trackId),
    [store],
  );

  const selectedTrack =
    store.tracks.find((t) => t.id === store.selectedTrackId && t.active) ?? null;

  return (
    <>
      <AppHeader
        playing={store.playing}
        projectDuration={store.projectDuration}
        masterVolume={store.masterVolume}
        rendering={store.rendering}
        clockRef={clockRef}
        onTogglePlay={handleTogglePlay}
        onRewind={handleRewind}
        onStop={handleStop}
        onSetDuration={store.setDuration}
        onSetMasterVolume={store.setMasterVolume}
        onRender={handleRender}
        onSaveProject={handleSaveProject}
        onOpenProject={handleOpenProject}
        onOpenGuide={() => setGuideOpen(true)}
      />

      <main className="workspace">
        <div className="stage">
          <CubePanel
            overlayRef={overlayRef}
            tracks={store.tracks}
            view={store.currentView}
            cubeMode={store.cubeMode}
            selectedTrackId={store.selectedTrackId}
            editingTrackId={store.editingTrackId}
            onSetView={store.setView}
            onSetCubeMode={store.setCubeMode}
            onSelectTrack={store.selectTrack}
            onMovePosition={handleMovePosition}
            onMovePathPoint={handleMovePathPoint}
            onAddPathPoint={handleAddPathPoint}
            onStopEditingPath={store.toggleEditingPath}
            onShowAll={store.showAllInCube}
          />

          <Inspector
            track={selectedTrack}
            view={store.currentView}
            view3d={store.cubeMode === '3d'}
            isEditingPath={selectedTrack !== null && store.editingTrackId === selectedTrack.id}
            onSetPosition={handleMovePosition}
            onSetMotionMode={store.setMotionMode}
            onSetPathLoopSec={store.setPathLoopSec}
            onSetPathInterpolation={store.setPathInterpolation}
            onToggleEditingPath={store.toggleEditingPath}
            onUndoPathPoint={store.undoPathPoint}
            onClearPath={store.clearPath}
            onSetTempo={store.setTempo}
          />
        </div>

        <Timeline
          tracks={store.tracks}
          assets={store.assets}
          projectDuration={store.projectDuration}
          selectedTrackId={store.selectedTrackId}
          selection={store.selection}
          clipboard={store.clipboard}
          pasteAnchor={store.pasteAnchor}
          toolMode={store.toolMode}
          lanesHeadRef={lanesHeadRef}
          rulerHeadRef={rulerHeadRef}
          onAddTrack={store.addTrack}
          onSelectTrack={store.selectTrack}
          onToggleMute={store.toggleMute}
          onToggleSolo={store.toggleSolo}
          onToggleCubeVisible={store.toggleCubeVisible}
          onDuplicate={store.duplicateTrack}
          onRemove={handleRemove}
          onSetVolume={store.setVolume}
          onUpload={handleUpload}
          onSeek={handleSeek}
          onSelect={handleSelect}
          onSetClips={store.setTrackClips}
          onSetToolMode={store.setToolMode}
          onCopy={store.copySelection}
          onCut={store.cutSelection}
          onDelete={store.deleteSelection}
          onPaste={handlePaste}
          onSplit={handleSplit}
        />
      </main>

      <StatusBar
        playing={store.playing}
        tracks={store.tracks}
        assets={store.assets}
        status={store.status}
      />

      <GuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
