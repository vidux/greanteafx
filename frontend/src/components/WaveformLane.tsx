'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { clipAt, extractRegion, healSeams, moveClips, spanOf } from '@/domain/clips';
import { keyframeTimes } from '@/domain/motion';
import type { AudioAsset, Clip, Selection, ToolMode, Track } from '@/domain/types';
import { drawClipLane } from '@/lib/waveform';

interface WaveformLaneProps {
  track: Track;
  assets: Record<string, AudioAsset>;
  projectDuration: number;
  selection: Selection | null;
  toolMode: ToolMode;
  onSelect: (selection: Selection | null) => void;
  onSetClips: (trackId: string, clips: Clip[]) => void;
  /** A file dropped onto the lane: loads it, replacing whatever the lane held. */
  onDropFile: (file: File) => void;
}

function carriesFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/** Below this many seconds of drag, treat the gesture as a click rather than a selection. */
const DRAG_THRESHOLD_SECONDS = 0.02;

/**
 * One track's lane: its clips drawn at their timeline positions, plus the editing surface.
 *
 * What a drag does depends on the active tool:
 *
 *  - **select** → drags out a time region; clicking a clip selects that whole clip
 *  - **move**   → drags audio along the timeline. Starting inside a selection cuts that region
 *    free and moves it; starting elsewhere moves the clip under the pointer. Audio never lands on
 *    top of other clips on the lane (see `moveClips`).
 *
 * The cut happens only once the pointer actually travels, so a plain click never splits a clip,
 * and when the drag ends any cut that still joins up with its neighbour is healed again.
 *
 * Holding **Alt** inverts the tool for one gesture, so the other mode is always a keypress
 * away without leaving the current one.
 *
 * A tool toggle rather than a bare modifier because an uploaded sample fills its entire lane:
 * "drag on a clip" is genuinely ambiguous between selecting part of it and moving it, and a
 * hidden modifier would leave half the tool undiscoverable.
 */
export function WaveformLane({
  track,
  assets,
  projectDuration,
  selection,
  toolMode,
  onSelect,
  onSetClips,
  onDropFile,
}: WaveformLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropping, setDropping] = useState(false);
  // Entering a child fires dragleave on the parent, so hover is counted rather than toggled.
  const dragDepth = useRef(0);

  /** Live gesture state, in a ref so pointer moves never re-render. */
  const gesture = useRef<
    | { kind: 'select'; anchorSeconds: number; dragged: boolean }
    | {
        kind: 'move';
        ids: string[];
        /** Lane layout when the drag began; every frame recomputes from this, not from the last. */
        originClips: Clip[];
        anchorSeconds: number;
        /** Selected region to cut free on the first real movement; null when moving a whole clip. */
        region: { startSeconds: number; endSeconds: number } | null;
        moved: boolean;
        /** Clip ids that existed before the gesture — anything else was cut by it. */
        beforeIds: ReadonlySet<string>;
        lastClips: Clip[];
      }
    | null
  >(null);

  const laneSelection = selection?.trackId === track.id ? selection : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () =>
      drawClipLane(canvas, {
        clips: track.clips,
        assets,
        projectDuration,
        tempo: track.tempo,
        color: track.color,
        selection: laneSelection,
        activeClipId: null,
        // The lane's CSS font-family resolves the self-hosted mono font's generated name.
        fontFamily: getComputedStyle(canvas).fontFamily,
      });

    draw();

    // Labels drawn before the web font arrived would keep the fallback face until the next edit.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) draw();
    });

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [track.clips, track.tempo, track.color, assets, projectDuration, laneSelection]);

  const secondsAt = useCallback(
    (clientX: number): number => {
      const el = wrapRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(projectDuration, ratio * projectDuration));
    },
    [projectDuration],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Let the ruler own scrubbing; the lane owns selection and clip editing.
    if (e.button !== 0) return;
    const at = secondsAt(e.clientX);
    // Alt flips to the other tool for the duration of this gesture.
    const mode: ToolMode =
      e.altKey ? (toolMode === 'select' ? 'move' : 'select') : toolMode;

    e.currentTarget.setPointerCapture(e.pointerId);

    if (mode === 'move') {
      const inSelection =
        laneSelection &&
        laneSelection.endSeconds - laneSelection.startSeconds > DRAG_THRESHOLD_SECONDS &&
        at >= laneSelection.startSeconds &&
        at <= laneSelection.endSeconds;

      const beforeIds = new Set(track.clips.map((c) => c.id));

      // The selection is only two times; the audio under it is cut free on the first real
      // movement (see handlePointerMove), provided there is audio there to cut.
      if (
        inSelection &&
        extractRegion(track.clips, laneSelection.startSeconds, laneSelection.endSeconds, track.tempo).ids.length > 0
      ) {
        gesture.current = {
          kind: 'move',
          ids: [],
          originClips: [...track.clips],
          anchorSeconds: at,
          region: { startSeconds: laneSelection.startSeconds, endSeconds: laneSelection.endSeconds },
          moved: false,
          beforeIds,
          lastClips: [...track.clips],
        };
        return;
      }

      const hit = clipAt(track.clips, at);
      if (hit) {
        gesture.current = {
          kind: 'move',
          ids: [hit.id],
          originClips: [...track.clips],
          anchorSeconds: at,
          region: null,
          moved: false,
          beforeIds,
          lastClips: [...track.clips],
        };
        onSelect({
          trackId: track.id,
          startSeconds: hit.startSeconds,
          endSeconds: hit.startSeconds + hit.durationSeconds,
        });
        return;
      }
      // Nothing to move here; fall through and behave like the select tool.
    }

    const hit = clipAt(track.clips, at);
    gesture.current = { kind: 'select', anchorSeconds: at, dragged: false };

    /*
     * Claim the lane immediately, even for a click that selects nothing. Paste targets the
     * lane that holds the selection, so without a zero-width selection here, clicking an empty
     * track and pasting would silently land on some other lane.
     */
    onSelect(
      hit
        ? {
            trackId: track.id,
            startSeconds: hit.startSeconds,
            endSeconds: hit.startSeconds + hit.durationSeconds,
          }
        : { trackId: track.id, startSeconds: at, endSeconds: at },
    );
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const at = secondsAt(e.clientX);

    if (g.kind === 'move') {
      if (!g.moved) {
        // Still a click: nothing is cut or moved until the pointer really travels.
        if (Math.abs(at - g.anchorSeconds) < DRAG_THRESHOLD_SECONDS) return;
        g.moved = true;
        if (g.region) {
          const { clips, ids } = extractRegion(g.originClips, g.region.startSeconds, g.region.endSeconds, track.tempo);
          g.originClips = clips;
          g.ids = ids;
        }
      }

      const moved = moveClips(g.originClips, g.ids, at - g.anchorSeconds, projectDuration);
      g.lastClips = moved;
      onSetClips(track.id, moved);

      // Keep the highlight glued to the audio it is carrying.
      const span = spanOf(moved, g.ids);
      if (span) onSelect({ trackId: track.id, ...span });
      return;
    }

    const start = Math.min(g.anchorSeconds, at);
    const end = Math.max(g.anchorSeconds, at);
    // Below the threshold this is still a click; leave the click-selection alone so tapping a
    // clip keeps selecting the whole clip.
    if (!g.dragged && end - start < DRAG_THRESHOLD_SECONDS) return;

    g.dragged = true;
    onSelect({ trackId: track.id, startSeconds: start, endSeconds: end });
  };

  const endGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind !== 'move' || !g.moved) return;

    // Rejoin any cut this drag made that still lines up with its neighbour, so dropping audio
    // back where it came from leaves one clip rather than three.
    const cutByDrag = new Set(g.lastClips.map((c) => c.id).filter((id) => !g.beforeIds.has(id)));
    const healed = healSeams(g.lastClips, cutByDrag, track.tempo);
    if (healed !== g.lastClips) onSetClips(track.id, [...healed]);
  };

  const clipCount = track.clips.length;
  const marks =
    track.motionMode === 'path'
      ? keyframeTimes(track.path, track.pathLoopSec, projectDuration)
      : [];

  return (
    <div
      ref={wrapRef}
      className={`track-lane tool-${toolMode}${dropping ? ' dropping' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDropping(true);
      }}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropping(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (file) onDropFile(file);
      }}
      role="group"
      aria-label={`${track.name} lane, ${clipCount} clip${clipCount === 1 ? '' : 's'}`}
    >
      <canvas ref={canvasRef} />

      {marks.map((t, i) => (
        <span
          key={i}
          className="kf-mark"
          style={{ left: `${(t / projectDuration) * 100}%` }}
          aria-hidden="true"
        />
      ))}

      {/*
        Nothing clickable sits on an empty lane: pressing it has to select the lane, which is how
        an empty track becomes the paste target. Loading audio is a drop here or the header icon.
      */}
      {track.loading && <div className="lane-status">Decoding…</div>}

      {dropping && (
        <div className="lane-drop" aria-hidden="true">
          {clipCount > 0 ? 'Drop to replace this lane’s audio' : 'Drop to load this audio'}
        </div>
      )}
    </div>
  );
}
