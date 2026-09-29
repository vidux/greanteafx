'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';

import { VIEW_AXES, type ViewName } from '@/domain/constants';
import { hiddenFromCube } from '@/domain/tracks';
import type { Track, Vec3 } from '@/domain/types';
import { AXIS_ENDS, VIEW_INFO, viewEdgeLabels } from '@/domain/views';
import {
  clampZoom,
  isZoomWheel,
  MAX_ZOOM,
  MIN_ZOOM,
  parseSavedZoom,
  wheelDeltaPixels,
  zoomByStep,
  zoomByWheel,
} from '@/lib/cubeZoom';
import { formatMetres } from '@/lib/format';
import type { CubeMode } from '@/store/projectStore';

import { CubeOverlay, type CubeOverlayHandle } from './CubeOverlay';

// three.js is large, so the 3D view is fetched the first time someone opens it.
const Cube3DView = dynamic(() => import('./Cube3DView').then((m) => m.Cube3DView), {
  ssr: false,
  loading: () => <div className="cube3d cube3d-message">Loading the 3D view…</div>,
});

const VIEWS: ViewName[] = ['front', 'top', 'side'];
const ZOOM_STORAGE_KEY = 'greanteafx.cubeZoom';
/** The cube's size at 100 %. A panel narrower than this shrinks the cube to fit instead. */
const STAGE_PX = 420;

function readSavedZoom(): number {
  try {
    return parseSavedZoom(window.localStorage.getItem(ZOOM_STORAGE_KEY));
  } catch {
    return 1;
  }
}

/**
 * Cube zoom: Shift + wheel while the pointer is over the cube (see `isZoomWheel`), plus buttons for
 * anyone who does not know the gesture.
 *
 * Zoom resizes the cube itself, so the page reflows around it and every source stays in view.
 * The zoom that is shown is clamped to what the panel can hold; the one the user chose is what
 * gets remembered, so a narrow window for a moment does not overwrite it.
 */
function useCubeZoom(enabled: boolean) {
  const [zoom, setZoom] = useState(readSavedZoom);
  /** Width the cube may use, in px; null until measured. */
  const [room, setRoom] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      // The edge labels take a column on either side of the cube; CSS owns that width.
      const labelColumn = parseFloat(getComputedStyle(body).getPropertyValue('--axis-col')) || 0;
      setRoom(Math.max(0, body.clientWidth - 2 * labelColumn));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const base = room === null ? STAGE_PX : Math.max(1, Math.min(STAGE_PX, room));
  const fit = room === null ? MAX_ZOOM : room / base;
  const shown = clampZoom(zoom, fit);

  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // Native and non-passive: React's onWheel is passive, and the page must not scroll sideways.
    const onWheel = (e: WheelEvent) => {
      if (!isZoomWheel(e)) return;
      e.preventDefault();
      const delta = wheelDeltaPixels(e.deltaY, e.deltaMode, e.deltaX);
      setZoom((z) => zoomByWheel(clampZoom(z, fitRef.current), delta, fitRef.current));
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
    // Re-attached on return from 3D, which replaced the box element.
  }, [enabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
    } catch {
      // Storage blocked (private mode); zoom still works for this session.
    }
  }, [zoom]);

  return {
    shown,
    size: Math.round(base * shown),
    bodyRef,
    boxRef,
    zoomIn: () => setZoom(zoomByStep(shown, 1, fit)),
    zoomOut: () => setZoom(zoomByStep(shown, -1, fit)),
    reset: () => setZoom(1),
    canZoomIn: shown < Math.min(MAX_ZOOM, fit) - 1e-3,
    canZoomOut: shown > MIN_ZOOM + 1e-3,
  };
}

interface CubePanelProps {
  tracks: readonly Track[];
  view: ViewName;
  cubeMode: CubeMode;
  selectedTrackId: string | null;
  editingTrackId: string | null;
  onSetView: (view: ViewName) => void;
  onSetCubeMode: (mode: CubeMode) => void;
  onSelectTrack: (trackId: string) => void;
  onMovePosition: (trackId: string, partial: Partial<Vec3>) => void;
  onMovePathPoint: (trackId: string, index: number, partial: Partial<Vec3>) => void;
  onAddPathPoint: (trackId: string, partial: Partial<Vec3>) => void;
  onStopEditingPath: (trackId: string) => void;
  onShowAll: () => void;
  overlayRef?: Ref<CubeOverlayHandle>;
}

/**
 * The cube, seen flat from one of three fixed views or in free-orbit 3D. In the flat views the
 * tabs are the only thing that changes the angle — dragging inside always moves a sound source,
 * never the view. In 3D, dragging empty space orbits and the move arrows position things.
 */
export function CubePanel({
  tracks,
  view,
  cubeMode,
  selectedTrackId,
  editingTrackId,
  onSetView,
  onSetCubeMode,
  onSelectTrack,
  onMovePosition,
  onMovePathPoint,
  onAddPathPoint,
  onStopEditingPath,
  onShowAll,
  overlayRef,
}: CubePanelProps) {
  const axes = VIEW_AXES[view];
  const edges = viewEdgeLabels(view);
  const [lockedNeg, lockedPos] = AXIS_ENDS[axes.lockedAxis];
  const locked = axes.lockedAxis.toUpperCase();
  const hidden = hiddenFromCube(tracks);
  const editing = tracks.find((t) => t.id === editingTrackId) ?? null;
  const is3d = cubeMode === '3d';
  const zoom = useCubeZoom(!is3d);

  // In 3D the zoom controls move the camera instead of resizing the cube.
  const [zoom3d, setZoom3d] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const zoomControls = is3d
    ? {
        shown: zoom3d,
        zoomIn: () => setZoom3d((z) => zoomByStep(z, 1)),
        zoomOut: () => setZoom3d((z) => zoomByStep(z, -1)),
        reset: () => {
          setZoom3d(1);
          setResetKey((k) => k + 1);
        },
        canZoomIn: zoom3d < MAX_ZOOM - 1e-3,
        canZoomOut: zoom3d > MIN_ZOOM + 1e-3,
      }
    : zoom;
  const onWheelZoom3d = useCallback(
    (delta: number) => setZoom3d((z) => zoomByWheel(z, delta)),
    [],
  );

  const stopEditing = useCallback(() => {
    if (editingTrackId) onStopEditingPath(editingTrackId);
  }, [editingTrackId, onStopEditingPath]);

  return (
    <section className="panel cube-panel" aria-label="Cube">
      <div className="cube-head">
        <div className="segmented" role="group" aria-label="Cube view">
          {VIEWS.map((name) => {
            const a = VIEW_AXES[name];
            return (
              <button
                key={name}
                type="button"
                className="seg-btn"
                aria-pressed={!is3d && view === name}
                onClick={() => onSetView(name)}
              >
                <span className="seg-axes">
                  {a.sxAxis.toUpperCase()}·{a.syAxis.toUpperCase()}
                </span>
                {VIEW_INFO[name].label}
              </button>
            );
          })}
          <button
            type="button"
            className="seg-btn"
            aria-pressed={is3d}
            title="Free view: orbit around the listener and move sources with arrows"
            onClick={() => onSetCubeMode('3d')}
          >
            <span className="seg-axes">XYZ</span>
            3D
          </button>
        </div>

        {is3d ? (
          <p className="cube-desc">
            Free view · the arrows point <strong className="axis-x">X</strong> right,{' '}
            <strong className="axis-y">Y</strong> up, <strong className="axis-z">Z</strong> behind
          </p>
        ) : (
          <p className="cube-desc">
            Looking <strong>{VIEW_INFO[view].looking}</strong> · drag to set{' '}
            <strong>
              {axes.sxAxis.toUpperCase()} and {axes.syAxis.toUpperCase()}
            </strong>
            , <span className="cube-desc-locked">{locked} ({lockedNeg.toLowerCase()}/{lockedPos.toLowerCase()})</span>{' '}
            stays put
          </p>
        )}

        <div className="zoom" role="group" aria-label="Cube zoom">
          <button
            type="button"
            className="btn btn-outline btn-sq-sm"
            onClick={zoomControls.zoomOut}
            disabled={!zoomControls.canZoomOut}
            title="Zoom out (Shift + scroll down over the cube)"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm zoom-readout"
            onClick={zoomControls.reset}
            title={is3d ? 'Reset the view' : 'Reset zoom'}
            aria-label={`Zoom ${Math.round(zoomControls.shown * 100)} percent, ${is3d ? 'reset the view' : 'reset'}`}
          >
            {Math.round(zoomControls.shown * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sq-sm"
            onClick={zoomControls.zoomIn}
            disabled={!zoomControls.canZoomIn}
            title="Zoom in (Shift + scroll up over the cube)"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="cube-body" ref={zoom.bodyRef}>
        {is3d ? (
          <Cube3DView
            tracks={tracks}
            selectedTrackId={selectedTrackId}
            editingTrackId={editingTrackId}
            zoom={zoom3d}
            resetKey={resetKey}
            onSelectTrack={onSelectTrack}
            onMovePosition={onMovePosition}
            onMovePathPoint={onMovePathPoint}
            onAddPathPoint={onAddPathPoint}
            onWheelZoom={onWheelZoom3d}
            handleRef={overlayRef}
          />
        ) : (
        <div className="cube-grid">
          <span className="axis-label axis-top">{edges.top}</span>
          <span className="axis-label axis-left">{edges.left}</span>
          <div
            className="cube-box"
            ref={zoom.boxRef}
            style={{ width: zoom.size, height: zoom.size }}
          >
            <CubeOverlay
              ref={overlayRef}
              tracks={tracks}
              view={view}
              selectedTrackId={selectedTrackId}
              editingTrackId={editingTrackId}
              onSelectTrack={onSelectTrack}
              onMovePosition={onMovePosition}
              onMovePathPoint={onMovePathPoint}
              onAddPathPoint={onAddPathPoint}
            />
          </div>
          <span className="axis-label axis-right">{edges.right}</span>
          <span className="axis-label axis-bottom">{edges.bottom}</span>
        </div>
        )}
      </div>

      {editing ? (
        <div className="cube-note armed" role="status">
          {is3d ? (
            <span>
              Adding keyframes to <strong>{editing.name}</strong> — click to drop one at the depth of
              the last keyframe, then drag its arrows to place it exactly.
            </span>
          ) : (
            <span>
              Adding keyframes to <strong>{editing.name}</strong> — click the cube to drop one.{' '}
              {axes.sxAxis.toUpperCase()} and {axes.syAxis.toUpperCase()} come from the click;{' '}
              {locked} stays at {formatMetres(editing.position[axes.lockedAxis])}.
            </span>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={stopEditing}>
            Done
          </button>
        </div>
      ) : (
        <p className="cube-hint">
          <span className="hint-mark" aria-hidden="true">
            i
          </span>
          {is3d ? (
            <>
              Drag to orbit, Shift + drag to pan, Shift + scroll to zoom. Click a source — or a
              keyframe on its path — then drag a coloured arrow to move it along that axis.
            </>
          ) : (
            <>
              Bigger dots are nearer the viewer along {locked}, the axis this view can’t show.
              Dragging never rotates the view — use the tabs above to change angle.
            </>
          )}
        </p>
      )}

      {/*
        A hidden source leaves no trace in the cube, so without this the only clue is scrolling
        the track list looking for a struck-through eye. Anything hidden is announced here, with
        the way back attached to the announcement.
      */}
      {hidden.length > 0 && (
        <div className="cube-note hidden-note">
          <span>
            <strong>{hidden.length}</strong> source{hidden.length === 1 ? '' : 's'} hidden —{' '}
            {hidden.map((t) => t.name).join(', ')} · still playing
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={onShowAll}>
            Show all
          </button>
        </div>
      )}
    </section>
  );
}
