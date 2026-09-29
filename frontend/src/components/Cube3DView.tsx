'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { CubeScene } from '@/cube3d/CubeScene';
import type { Track, Vec3 } from '@/domain/types';

import type { CubeOverlayHandle } from './CubeOverlay';

interface Cube3DViewProps {
  tracks: readonly Track[];
  selectedTrackId: string | null;
  editingTrackId: string | null;
  zoom: number;
  /** Bumped to put the camera back where it started. */
  resetKey: number;
  onSelectTrack: (trackId: string) => void;
  onMovePosition: (trackId: string, partial: Partial<Vec3>) => void;
  onMovePathPoint: (trackId: string, index: number, partial: Partial<Vec3>) => void;
  onAddPathPoint: (trackId: string, partial: Partial<Vec3>) => void;
  onWheelZoom: (deltaPixels: number) => void;
  /**
   * Receives moving sources' positions from the frame loop. A plain prop rather than `ref`, so it
   * passes through the lazy-loading wrapper untouched.
   */
  handleRef?: Ref<CubeOverlayHandle>;
}

/** Hosts the three.js scene; see `CubeScene` for how the view behaves. */
export function Cube3DView(props: Cube3DViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CubeScene | null>(null);
  const [failed, setFailed] = useState(false);

  // Handler identities change every render; the scene calls through this ref instead.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    let scene: CubeScene;
    try {
      scene = new CubeScene(host, labels, {
        selectTrack: (id) => latest.current.onSelectTrack(id),
        movePosition: (id, p) => latest.current.onMovePosition(id, p),
        movePathPoint: (id, index, p) => latest.current.onMovePathPoint(id, index, p),
        addPathPoint: (id, p) => latest.current.onAddPathPoint(id, p),
        wheelZoom: (delta) => latest.current.onWheelZoom(delta),
      });
    } catch (error) {
      console.error('[greanteafx] 3D view unavailable', error);
      setFailed(true);
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const { tracks, selectedTrackId, editingTrackId, zoom, resetKey } = props;

  useEffect(() => {
    sceneRef.current?.update({ tracks, selectedTrackId, editingTrackId });
  }, [tracks, selectedTrackId, editingTrackId]);

  // Before the reset below, so a reset lands at the zoom it was asked for.
  useEffect(() => {
    sceneRef.current?.setZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    if (resetKey > 0) sceneRef.current?.resetView();
  }, [resetKey]);

  useImperativeHandle(
    props.handleRef,
    () => ({
      applyLivePositions: (positions) => sceneRef.current?.applyLivePositions(positions),
    }),
    [],
  );

  if (failed) {
    return (
      <div className="cube3d cube3d-message" role="status">
        The 3D view needs WebGL, which this browser has turned off. The Front, Top and Side views
        still work.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="cube3d"
      role="application"
      aria-label="3D view of the cube. Drag to orbit, Shift and drag to pan, Shift and scroll to zoom. Use the inspector's sliders to set positions from the keyboard."
    >
      <div ref={labelsRef} className="cube3d-labels" aria-hidden="true" />
    </div>
  );
}
