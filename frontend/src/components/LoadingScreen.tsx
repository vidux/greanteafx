'use client';

import { useEffect, useRef, useState } from 'react';

import {
  FLOOR,
  liftToStage,
  scaleXFromTransform,
  trickle,
  type BootStage,
} from '@/lib/bootProgress';

import { Brand } from './Brand';

export type { BootStage };

const SLOW_HINT_MS = 6000;

const LABEL: Record<BootStage, string> = {
  fetching: 'Loading the audio engine…',
  starting: 'Building the console…',
  ready: 'Ready',
  failed: 'Could not load the console',
};

/** Keep in sync with the `.boot` opacity transition in globals.css. */
const FADE_MS = 350;

/** Current horizontal scale of an element, including any running CSS animation. */
function visualScaleX(el: HTMLElement | null): number | null {
  return el ? scaleXFromTransform(getComputedStyle(el).transform) : null;
}

/**
 * Full-screen cover shown until the console has painted, so a half-built page is never visible.
 *
 * Two phases. Before React hydrates — which on a cold dev server can take many seconds — the bar
 * and percentage run on a pure CSS animation, since no script is running yet to move them. On
 * hydration, JS reads where that animation has visually got to and carries on from there, with
 * real milestones (bundle loaded, console mounted) lifting the bar as they land.
 */
export function LoadingScreen({ stage }: { stage: BootStage }) {
  const fillRef = useRef<HTMLDivElement>(null);
  // null = still on the CSS animation. Must start null so the client's first render matches the
  // server HTML exactly.
  const [progress, setProgress] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setProgress(visualScaleX(fillRef.current) ?? FLOOR.fetching);

    // Measured from navigation, not hydration, so a long pre-hydration wait counts towards it.
    const timer = setTimeout(() => setSlow(true), Math.max(0, SLOW_HINT_MS - performance.now()));
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stage === 'ready') {
      setProgress(1);
      const fade = setTimeout(() => setLeaving(true), 250);
      const remove = setTimeout(() => setGone(true), 250 + FADE_MS);
      return () => {
        clearTimeout(fade);
        clearTimeout(remove);
      };
    }
    if (stage === 'failed') return;

    setProgress((p) => liftToStage(p ?? FLOOR.fetching, stage));

    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      // Clamped so a backgrounded tab does not leap forward when it wakes.
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      setProgress((p) => trickle(p ?? FLOOR.fetching, dt));
    }, 50);
    return () => clearInterval(timer);
  }, [stage]);

  if (gone) return null;

  const onCss = progress === null;
  const percent = onCss ? undefined : Math.round(progress * 100);

  return (
    <div className={`boot${leaving ? ' leaving' : ''}${stage === 'failed' ? ' failed' : ''}`}>
      <div className="boot-inner">
        <div className="boot-brand">
          <Brand subtitle="Spatial audio timeline" />
        </div>

        <div
          className="boot-bar"
          role="progressbar"
          aria-label="Loading the console"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            ref={fillRef}
            className={`boot-bar-fill${onCss ? ' css-trickle' : ''}`}
            style={onCss ? undefined : { transform: `scaleX(${progress})` }}
          />
        </div>

        <div className="boot-meta">
          <span role="status">{LABEL[stage]}</span>
          {stage !== 'failed' &&
            (onCss ? <span className="boot-pct-css" /> : <span>{percent}%</span>)}
        </div>

        {stage === 'failed' ? (
          <div className="boot-error">
            <p>Check your connection, then reload the page.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        ) : (
          <p className="boot-hint">
            {slow && stage !== 'ready'
              ? 'Still working — the first load can take a little while.'
              : 'Best with headphones — the spatial effect needs both ears.'}
          </p>
        )}
      </div>
    </div>
  );
}
