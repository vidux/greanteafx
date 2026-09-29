'use client';

import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';

import {
  MAX_M,
  OVERLAY_CENTER,
  OVERLAY_SIZE,
  RADAR_SCALE,
  VIEW_AXES,
  type ViewName,
} from '@/domain/constants';
import { clientToOverlay, overlayToWorldAxes, worldToOverlay } from '@/domain/coordinates';
import { samplePathPolyline } from '@/domain/motion';
import { isShownInCube, isSilenced, soloActive } from '@/domain/tracks';
import type { Track, Vec3 } from '@/domain/types';
import { nearness } from '@/domain/views';
import { formatMetres } from '@/lib/format';
import { layoutLabels, type Box, type PlacedLabel } from '@/lib/labelLayout';

/** Dot radius at the far and near faces of the cube: the depth cue for the hidden axis. */
const FAR_RADIUS = 7;
const NEAR_RADIUS = 16;
const RING_RADIUS = 22;

/** One line per metre across the ±6 m cube. */
const GRID = Array.from({ length: 2 * MAX_M + 1 }, (_, i) => OVERLAY_CENTER + (i - MAX_M) * RADAR_SCALE);
const GRID_MIN = GRID[0]!;
const GRID_MAX = GRID[GRID.length - 1]!;

export interface CubeOverlayHandle {
  /**
   * Moves the dots of automated tracks without going through React. Called from the
   * animation-frame loop; routing sixty position updates a second through the store would
   * re-render the entire timeline for no visual gain.
   */
  applyLivePositions(positions: Map<string, Vec3>): void;
}

interface SourceElements {
  dot: SVGCircleElement | null;
  ring: SVGCircleElement | null;
  label: HTMLDivElement | null;
  depth: HTMLSpanElement | null;
}

interface SourceView {
  track: Track;
  sx: number;
  sy: number;
  r: number;
  depth: string;
}

function dotRadius(p: Vec3, view: ViewName): number {
  return FAR_RADIUS + nearness(p, view) * (NEAR_RADIUS - FAR_RADIUS);
}

function depthText(p: Vec3, view: ViewName): string {
  const axis = VIEW_AXES[view].lockedAxis;
  return `${axis.toUpperCase()} ${formatMetres(p[axis])}`;
}

function sourceView(track: Track, p: Vec3, view: ViewName): SourceView {
  const { sx, sy } = worldToOverlay(p, view);
  return { track, sx, sy, r: dotRadius(p, view), depth: depthText(p, view) };
}

/** The name at 12 px semibold or the readout at 10 px mono, whichever is wider — close enough. */
function labelWidth(s: SourceView): number {
  return Math.ceil(Math.max(s.track.name.length * 7.6, s.depth.length * 6.1)) + 4;
}

/**
 * Label positions in on-screen pixels, for a cube drawn `width` px wide. The selected source is
 * laid out first, so its label always sits right beside its dot.
 */
function placeLabels(
  sources: readonly SourceView[],
  width: number,
  selectedId: string | null,
): Map<string, PlacedLabel> {
  const k = width / OVERLAY_SIZE;
  // The listener's ring and its YOU caption, in overlay units.
  const listener: Box = {
    left: (OVERLAY_CENTER - 18) * k,
    right: (OVERLAY_CENTER + 18) * k,
    top: (OVERLAY_CENTER - 18) * k,
    bottom: (OVERLAY_CENTER + 33) * k,
  };
  const byPriority = [
    ...sources.filter((s) => s.track.id === selectedId),
    ...sources.filter((s) => s.track.id !== selectedId),
  ];
  const placed = layoutLabels(
    byPriority.map((s) => ({
      id: s.track.id,
      x: s.sx * k,
      y: s.sy * k,
      // The selected dot's ring is part of it as far as its neighbours' labels are concerned.
      r: (s.track.id === selectedId ? Math.max(s.r, RING_RADIUS) : s.r) * k,
      width: labelWidth(s),
    })),
    width,
    [listener],
  );
  return new Map(placed.map((p) => [p.id, p]));
}

function pct(px: number, width: number): string {
  return `${(px / width) * 100}%`;
}

interface CubeOverlayProps {
  tracks: readonly Track[];
  view: ViewName;
  selectedTrackId: string | null;
  editingTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onMovePosition: (trackId: string, partial: Partial<Vec3>) => void;
  onMovePathPoint: (trackId: string, index: number, partial: Partial<Vec3>) => void;
  onAddPathPoint: (trackId: string, partial: Partial<Vec3>) => void;
  ref?: Ref<CubeOverlayHandle>;
}

/**
 * The cube's working surface: a flat 400×400 SVG at 30 px per metre, seen from the current
 * view. Rotating the view swaps *which two world axes* the surface edits; it never rotates the
 * surface, so dragging always moves a source.
 *
 * The third axis is shown two ways: dot size (nearer the viewer is bigger) and a readout under
 * each name. Names are HTML rather than SVG text so they stay the same size at any zoom.
 */
export function CubeOverlay({
  tracks,
  view,
  selectedTrackId,
  editingTrackId,
  onSelectTrack,
  onMovePosition,
  onMovePathPoint,
  onAddPathPoint,
  ref,
}: CubeOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const elements = useRef(new Map<string, SourceElements>());
  const [width, setWidth] = useState(OVERLAY_SIZE);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setWidth(svg.getBoundingClientRect().width || OVERLAY_SIZE);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  /*
   * Hidden tracks are dropped from the overlay entirely rather than merely faded. The point of
   * hiding is to be able to grab the source underneath, and a faded dot still has a hit area:
   * it would keep swallowing the pointer-down and the neighbour would stay unreachable.
   */
  const shown = tracks.filter(isShownInCube);
  // The selected source is drawn last, so it is on top and always grabbable.
  const ordered = [
    ...shown.filter((t) => t.id !== selectedTrackId),
    ...shown.filter((t) => t.id === selectedTrackId),
  ];
  const sources = ordered.map((t) => sourceView(t, t.position, view));
  const labels = placeLabels(sources, width, selectedTrackId);
  const solo = soloActive(tracks);

  // Read by the animation loop, which must not be rebuilt on every render.
  const live = useRef({ ordered, view, width, selectedTrackId });
  live.current = { ordered, view, width, selectedTrackId };

  useImperativeHandle(ref, () => ({
    applyLivePositions(positions) {
      const { ordered: current, view: v, width: w, selectedTrackId: selectedId } = live.current;
      const views = current.map((t) => sourceView(t, positions.get(t.id) ?? t.position, v));

      for (const s of views) {
        if (!positions.has(s.track.id)) continue;
        const els = elements.current.get(s.track.id);
        els?.dot?.setAttribute('cx', String(s.sx));
        els?.dot?.setAttribute('cy', String(s.sy));
        els?.dot?.setAttribute('r', String(s.r));
        els?.ring?.setAttribute('cx', String(s.sx));
        els?.ring?.setAttribute('cy', String(s.sy));
        if (els?.depth && els.depth.textContent !== s.depth) els.depth.textContent = s.depth;
      }

      // A moving source can bump into any label, so every label is laid out again.
      for (const [id, p] of placeLabels(views, w, selectedId)) {
        const label = elements.current.get(id)?.label;
        if (!label) continue;
        label.style.left = pct(p.x, w);
        label.style.top = pct(p.y, w);
        label.classList.toggle('flip', p.flip);
      }
    },
  }), []);

  const register = useCallback(
    <K extends keyof SourceElements>(trackId: string, key: K, el: SourceElements[K]) => {
      const map = elements.current;
      const entry = map.get(trackId) ?? { dot: null, ring: null, label: null, depth: null };
      entry[key] = el;
      map.set(trackId, entry);
    },
    [],
  );

  /** Converts a pointer event to the two world-axis values this view edits. */
  const axesFromEvent = useCallback(
    (clientX: number, clientY: number): Partial<Vec3> | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const { sx, sy } = clientToOverlay(svg, clientX, clientY);
      return overlayToWorldAxes(sx, sy, view);
    },
    [view],
  );

  /**
   * While path editing is armed, pressing anywhere on the surface drops a keyframe for that
   * track. Dots and keyframes stop propagation, so grabbing one never also adds a point.
   */
  const handleSurfacePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!editingTrackId) return;
    const partial = axesFromEvent(e.clientX, e.clientY);
    if (partial) onAddPathPoint(editingTrackId, partial);
  };

  const v = VIEW_AXES[view];
  const selected = shown.find((t) => t.id === selectedTrackId) ?? null;

  return (
    <>
      <svg
        ref={svgRef}
        className={`cube-svg${editingTrackId ? ' armed' : ''}`}
        viewBox={`0 0 ${OVERLAY_SIZE} ${OVERLAY_SIZE}`}
        onPointerDown={handleSurfacePointerDown}
        role="application"
        aria-label={`Spatial cube, ${view} view. Dragging a source sets ${v.sxAxis.toUpperCase()} and ${v.syAxis.toUpperCase()}.`}
      >
        <g aria-hidden="true">
          {GRID.map((p, i) => {
            const mid = i === MAX_M;
            return (
              <g key={p} className={mid ? 'grid-mid' : 'grid-line'}>
                <line x1={p} y1={GRID_MIN} x2={p} y2={GRID_MAX} />
                <line x1={GRID_MIN} y1={p} x2={GRID_MAX} y2={p} />
              </g>
            );
          })}

          {/* The listener: fixed at the origin. */}
          <circle className="listener-ring" cx={OVERLAY_CENTER} cy={OVERLAY_CENTER} r={16} />
          <circle className="listener-dot" cx={OVERLAY_CENTER} cy={OVERLAY_CENTER} r={5} />
          <text className="listener-label" x={OVERLAY_CENTER} y={OVERLAY_CENTER + 29}>
            YOU
          </text>
        </g>

        {/* Other tracks' paths, faint and out of the way; only the selected one is editable. */}
        <g aria-hidden="true" pointerEvents="none">
          {shown
            .filter((t) => t.id !== selectedTrackId && t.path.length >= 2)
            .map((t) => (
              <polygon
                key={t.id}
                className="path-line faint"
                points={pathOutline(t, view)}
                stroke={t.color}
              />
            ))}
        </g>

        <g>
          {sources.map((s) => {
            const isSelected = s.track.id === selectedTrackId;
            return (
              <Source
                key={s.track.id}
                source={s}
                selected={isSelected}
                silent={isSilenced(s.track, solo)}
                armedHere={editingTrackId === s.track.id}
                axesFromEvent={axesFromEvent}
                onSelectTrack={onSelectTrack}
                onMovePosition={onMovePosition}
                register={register}
              />
            );
          })}
        </g>

        {/* Above the dots: a keyframe under a moving source must stay grabbable. */}
        {selected && selected.path.length >= 1 && (
          <PathEditor
            track={selected}
            view={view}
            axesFromEvent={axesFromEvent}
            onMovePathPoint={onMovePathPoint}
          />
        )}
      </svg>

      <div className="cube-labels" aria-hidden="true">
        {sources.map((s) => {
          const p = labels.get(s.track.id)!;
          const silent = isSilenced(s.track, solo);
          return (
            <div
              key={s.track.id}
              ref={(el) => register(s.track.id, 'label', el)}
              className={`source-label${p.flip ? ' flip' : ''}${silent ? ' silent' : ''}`}
              style={{ left: pct(p.x, width), top: pct(p.y, width) }}
            >
              <span className="source-name">{s.track.name}</span>
              <span className="source-depth" ref={(el) => register(s.track.id, 'depth', el)}>
                {s.depth}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * A linear path's outline *is* its keyframes. A smooth one is sampled from the same spline the
 * audio engine evaluates, so the line you see is exactly the line the source travels.
 * A polygon, not a polyline: the path loops back to its first keyframe.
 */
function pathOutline(track: Track, view: ViewName): string {
  const points =
    track.pathInterpolation === 'smooth' && track.path.length >= 3
      ? samplePathPolyline(track.path, 'smooth')
      : track.path;
  return points
    .map((p) => worldToOverlay(p, view))
    .map((p) => `${p.sx},${p.sy}`)
    .join(' ');
}

interface SourceProps {
  source: SourceView;
  selected: boolean;
  silent: boolean;
  /** Path editing is armed on this very track, so pressing its dot drops a keyframe. */
  armedHere: boolean;
  axesFromEvent: (clientX: number, clientY: number) => Partial<Vec3> | null;
  onSelectTrack: (trackId: string) => void;
  onMovePosition: (trackId: string, partial: Partial<Vec3>) => void;
  register: <K extends keyof SourceElements>(trackId: string, key: K, el: SourceElements[K]) => void;
}

function Source({
  source,
  selected,
  silent,
  armedHere,
  axesFromEvent,
  onSelectTrack,
  onMovePosition,
  register,
}: SourceProps) {
  const dragging = useRef(false);
  const { track, sx, sy, r } = source;

  // In path mode the position comes from the keyframes, so the dot is not draggable — you move
  // the keyframes instead.
  const isPathMode = track.motionMode === 'path';

  const handlePointerDown = (e: React.PointerEvent<SVGGElement>) => {
    // Let the surface turn this press into a keyframe for the armed track.
    if (armedHere) return;
    e.stopPropagation();
    onSelectTrack(track.id);
    if (isPathMode) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragging.current) return;
    const partial = axesFromEvent(e.clientX, e.clientY);
    if (partial) onMovePosition(track.id, partial);
  };

  const endDrag = () => {
    dragging.current = false;
  };

  return (
    <g
      className={`source${isPathMode ? ' path-mode' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {selected && (
        <circle
          ref={(el) => register(track.id, 'ring', el)}
          className="source-ring"
          cx={sx}
          cy={sy}
          r={RING_RADIUS}
          stroke={track.color}
        />
      )}
      <circle
        ref={(el) => register(track.id, 'dot', el)}
        className="source-dot"
        cx={sx}
        cy={sy}
        r={r}
        fill={track.color}
        opacity={silent ? 0.35 : selected ? 1 : 0.85}
      />
    </g>
  );
}

interface PathEditorProps {
  track: Track;
  view: ViewName;
  axesFromEvent: (clientX: number, clientY: number) => Partial<Vec3> | null;
  onMovePathPoint: (trackId: string, index: number, partial: Partial<Vec3>) => void;
}

/** The selected track's path, with a draggable, numbered diamond on every keyframe. */
function PathEditor({ track, view, axesFromEvent, onMovePathPoint }: PathEditorProps) {
  const draggingIndex = useRef<number | null>(null);
  const points = track.path.map((p) => worldToOverlay(p, view));

  return (
    <g>
      {points.length >= 2 && (
        <polygon className="path-line" points={pathOutline(track, view)} stroke={track.color} />
      )}

      {points.map((p, idx) => (
        <g
          key={idx}
          className="keyframe"
          onPointerDown={(e) => {
            draggingIndex.current = idx;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.stopPropagation();
          }}
          onPointerMove={(e) => {
            if (draggingIndex.current !== idx) return;
            const partial = axesFromEvent(e.clientX, e.clientY);
            if (partial) onMovePathPoint(track.id, idx, partial);
          }}
          onPointerUp={() => {
            draggingIndex.current = null;
          }}
          onPointerCancel={() => {
            draggingIndex.current = null;
          }}
        >
          {/* A generous invisible hit area: the diamond itself is only 8 units across. */}
          <circle className="keyframe-hit" cx={p.sx} cy={p.sy} r={10} />
          <rect
            className="keyframe-diamond"
            x={p.sx - 4}
            y={p.sy - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${p.sx} ${p.sy})`}
            stroke={track.color}
          />
          <text className="keyframe-num" x={p.sx + 8} y={p.sy - 7}>
            {idx + 1}
          </text>
        </g>
      ))}
    </g>
  );
}
