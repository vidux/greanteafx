'use client';

import { useId, type CSSProperties } from 'react';

import {
  LOOP_OPTIONS,
  MAX_M,
  MAX_TEMPO,
  MIN_TEMPO,
  VIEW_AXES,
  type ViewName,
  type WorldAxis,
} from '@/domain/constants';
import type { MotionMode, PathInterpolation, Track, Vec3 } from '@/domain/types';
import { AXIS_ENDS } from '@/domain/views';
import { formatMetres } from '@/lib/format';

interface InspectorProps {
  track: Track | null;
  view: ViewName;
  /** The cube is in free-orbit 3D, where no axis is hidden. */
  view3d: boolean;
  isEditingPath: boolean;
  onSetPosition: (id: string, partial: Partial<Vec3>) => void;
  onSetMotionMode: (id: string, mode: MotionMode) => void;
  onSetPathLoopSec: (id: string, seconds: number) => void;
  onSetPathInterpolation: (id: string, interpolation: PathInterpolation) => void;
  onToggleEditingPath: (id: string) => void;
  onUndoPathPoint: (id: string) => void;
  onClearPath: (id: string) => void;
  onSetTempo: (id: string, tempo: number) => void;
}

const ALL_AXES: WorldAxis[] = ['x', 'y', 'z'];

/**
 * Everything about the selected source that is not on its timeline row: where it sits, how it
 * moves, and how fast it plays.
 *
 * In path mode the source follows its keyframes, so in a flat view only one slider is left: the
 * axis that view cannot show. Cube clicks set the other two, and new keyframes take this one. In
 * 3D no axis is hidden and keyframes are moved with the view's arrows, so none is needed.
 */
export function Inspector({
  track,
  view,
  view3d,
  isEditingPath,
  onSetPosition,
  onSetMotionMode,
  onSetPathLoopSec,
  onSetPathInterpolation,
  onToggleEditingPath,
  onUndoPathPoint,
  onClearPath,
  onSetTempo,
}: InspectorProps) {
  const tempoId = useId();

  if (!track) {
    return (
      <aside className="panel inspector inspector-empty" aria-label="Selected source">
        <span className="eyebrow">Selected source</span>
        <p>No track selected. Click a track or a dot in the cube to inspect it.</p>
      </aside>
    );
  }

  const axes = VIEW_AXES[view];
  const isPath = track.motionMode === 'path';
  const keyframes = track.path.length;
  const shown = `${axes.sxAxis.toUpperCase()} and ${axes.syAxis.toUpperCase()}`;

  const pathHint = view3d
    ? isEditingPath
      ? 'Click the view to drop keyframes at the depth of the last one, then drag the arrows to place each exactly.'
      : keyframes < 2
        ? 'Press + Add keyframes, then click the view. The source starts moving at two keyframes.'
        : 'Click a keyframe in the view and drag its arrows to reshape the path. After the last keyframe it loops back to the first.'
    : isEditingPath
      ? 'Click the cube to drop keyframes. Switch views between clicks to build a 3D path.'
      : keyframes < 2
        ? 'Press + Add keyframes, then click the cube. The source starts moving at two keyframes.'
        : 'Drag a keyframe in the cube to reshape the path. After the last one it loops back to the first.';
  const sliderAxes = isPath ? (view3d ? [] : [axes.lockedAxis]) : ALL_AXES;

  return (
    <aside
      className="panel inspector"
      aria-label="Selected source"
      style={{ '--ch-color': track.color } as CSSProperties}
    >
      <div className="insp-head">
        <span className="insp-swatch" aria-hidden="true" />
        <div className="insp-title">
          <span className="eyebrow">Selected source</span>
          <span className="insp-name">{track.name}</span>
        </div>
        {!isPath && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            title="Move the source onto the listener"
            onClick={() => onSetPosition(track.id, { x: 0, y: 0, z: 0 })}
          >
            Center
          </button>
        )}
      </div>

      <div className="insp-sliders">
        {isPath &&
          (view3d ? (
            <p className="insp-note">Follows its path — move its keyframes with the arrows in the view.</p>
          ) : (
            <p className="insp-note">
              Follows its path. New keyframes take {shown} from your click and{' '}
              {axes.lockedAxis.toUpperCase()} from here:
            </p>
          ))}
        {sliderAxes.map((axis) => (
          <AxisSlider
            key={axis}
            axis={axis}
            value={track.position[axis]}
            hiddenInView={!view3d && axis === axes.lockedAxis}
            onChange={(value) => onSetPosition(track.id, { [axis]: value })}
          />
        ))}
      </div>

      <div className="insp-divider" />

      <div className="insp-section">
        <span className="eyebrow">Motion</span>
        <div className="segmented segmented-fill" role="group" aria-label="Motion">
          <button
            type="button"
            className="seg-btn"
            aria-pressed={!isPath}
            onClick={() => onSetMotionMode(track.id, 'static')}
          >
            Stays in place
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={isPath}
            onClick={() => onSetMotionMode(track.id, 'path')}
          >
            Moves on a path
          </button>
        </div>

        {isPath && (
          <>
            <div className="insp-grid">
              <label className="field">
                Loop every
                <select
                  value={track.pathLoopSec}
                  onChange={(e) => onSetPathLoopSec(track.id, parseInt(e.target.value, 10))}
                >
                  {LOOP_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s} s
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Path shape
                <select
                  value={track.pathInterpolation}
                  onChange={(e) =>
                    onSetPathInterpolation(track.id, e.target.value as PathInterpolation)
                  }
                  // Below three keyframes a spline has no curvature to work with.
                  disabled={keyframes < 3}
                  title={keyframes < 3 ? 'Needs at least 3 keyframes to curve' : undefined}
                >
                  <option value="linear">Straight lines</option>
                  <option value="smooth">Smooth curve</option>
                </select>
              </label>
            </div>

            <div className="insp-keyframes">
              <span className="insp-count">
                <strong>{keyframes}</strong> keyframe{keyframes === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                aria-pressed={isEditingPath}
                onClick={() => onToggleEditingPath(track.id)}
              >
                {isEditingPath ? 'Done' : '+ Add keyframes'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={keyframes === 0}
                title="Remove the last keyframe"
                onClick={() => onUndoPathPoint(track.id)}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={keyframes === 0}
                title="Remove every keyframe"
                onClick={() => onClearPath(track.id)}
              >
                Clear
              </button>
            </div>

            <p className="insp-hint">{pathHint}</p>
          </>
        )}
      </div>

      <div className="insp-divider" />

      <div className="insp-section">
        <span className="eyebrow">Playback</span>
        <div className="axis-slider">
          <div className="axis-row">
            <label htmlFor={tempoId} className="axis-name">
              Tempo
            </label>
            <span className="axis-value">{track.tempo.toFixed(2)}×</span>
          </div>
          <input
            id={tempoId}
            type="range"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            step={0.05}
            value={track.tempo}
            onChange={(e) => onSetTempo(track.id, parseFloat(e.target.value))}
          />
          <p className="insp-hint">Playback speed. Like a record, faster also raises the pitch.</p>
        </div>
      </div>
    </aside>
  );
}

function AxisSlider({
  axis,
  value,
  hiddenInView,
  onChange,
}: {
  axis: WorldAxis;
  value: number;
  hiddenInView: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [neg, pos] = AXIS_ENDS[axis];
  const key = axis.toUpperCase();

  return (
    <div className="axis-slider">
      <div className="axis-row">
        <label htmlFor={id} className="axis-key">
          {key}
        </label>
        <span className="axis-end">{neg}</span>
        <span className="axis-value">{formatMetres(value)}</span>
        <span className="axis-end">{pos}</span>
        {hiddenInView && (
          <span
            className="badge"
            title="Not visible in the current view — edit it here or switch view"
          >
            hidden in view
          </span>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={-MAX_M}
        max={MAX_M}
        step={0.1}
        value={value}
        aria-valuetext={`${key} ${formatMetres(value)} metres`}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
