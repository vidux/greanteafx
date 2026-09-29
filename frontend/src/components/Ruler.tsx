'use client';

import { useCallback, useRef, type Ref } from 'react';

import { pickInterval } from '@/lib/format';

interface RulerProps {
  projectDuration: number;
  onSeek: (seconds: number) => void;
  /** The playhead marker; positioned by the animation-frame loop, never through state. */
  headRef: Ref<HTMLDivElement>;
}

/**
 * Time ruler above the lanes. Tick spacing widens with project length (`pickInterval`).
 *
 * Doubles as the scrub bar: pressing anywhere on it seeks, and holding drags the playhead.
 * Pointer capture means the drag keeps tracking even when the cursor leaves the ruler, which
 * is what makes scrubbing feel like a scrub rather than a series of clicks.
 */
export function Ruler({ projectDuration, onSeek, headRef }: RulerProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const interval = pickInterval(projectDuration);
  const ticks: number[] = [];
  for (let t = 0; t <= projectDuration; t += interval) ticks.push(t);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const lane = laneRef.current;
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(ratio * projectDuration);
    },
    [onSeek, projectDuration],
  );

  return (
    <div className="ruler">
      <div className="ruler-header-spacer" />
      <div
        ref={laneRef}
        className="ruler-lane"
        role="slider"
        tabIndex={0}
        aria-label="Playhead position"
        aria-valuemin={0}
        aria-valuemax={projectDuration}
        onPointerDown={(e) => {
          scrubbing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) seekFromEvent(e.clientX);
        }}
        onPointerUp={() => {
          scrubbing.current = false;
        }}
        onPointerCancel={() => {
          scrubbing.current = false;
        }}
        onKeyDown={(e) => {
          // Keyboard nudging, since the ruler is focusable.
          if (e.key === 'Home') onSeek(0);
          else if (e.key === 'End') onSeek(projectDuration);
          else return;
          e.preventDefault();
        }}
      >
        {ticks.map((t) => {
          const pct = (t / projectDuration) * 100;
          /*
           * A tick landing exactly on the lane's right edge would push its label outside the
           * lane and overflow the scroll container. That one is anchored to the right edge
           * instead, with its line and label turned inward.
           *
           * The threshold is deliberately tight: a looser one (say 98%) would also catch a
           * tick that merely lands *near* the end — 135s of a 137s project — and shift it to
           * 100%, drawing it some 20px away from the time it represents. Near-edge ticks keep
           * their true position; `.timeline-scroll { overflow-x: hidden }` absorbs the last
           * pixel or two of label.
           */
          const atEnd = pct > 99.9;
          return (
            <div
              key={t}
              className={`ruler-tick${atEnd ? ' at-end' : ''}`}
              style={atEnd ? undefined : { left: `${pct}%` }}
            >
              {t}s
            </div>
          );
        })}
        <div ref={headRef} className="ruler-head" aria-hidden="true" />
      </div>
    </div>
  );
}
