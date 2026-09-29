'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';

import { LoadingScreen, type BootStage } from './LoadingScreen';

type ConsoleComponent = ComponentType<{ onReady?: () => void }>;

/**
 * Mounts the console client-side only, behind a full-screen loading cover.
 *
 * Nothing in this app is meaningful server-rendered: the timeline is drawn to canvases, the
 * cube is driven by pointer drags, and playback needs an `AudioContext` that browsers refuse
 * to start without a user gesture. It is also a render that can *fail*: the store is a
 * module-level singleton, which on the server is shared across requests and survives Fast
 * Refresh, and any divergence shows up as a hydration mismatch. Not rendering it on the server
 * removes that whole class of failure.
 *
 * The console is imported by hand in an effect rather than through `next/dynamic` so that its
 * two milestones — bundle loaded, console painted — can drive the progress bar. The server
 * renders only the loading cover, which is static, so it hydrates without mismatch.
 */
export function ConsoleMount() {
  const [Console, setConsole] = useState<ConsoleComponent | null>(null);
  const [stage, setStage] = useState<BootStage>('fetching');

  useEffect(() => {
    let cancelled = false;
    import('./Console')
      .then((m) => {
        if (cancelled) return;
        setConsole(() => m.Console);
        setStage('starting');
      })
      .catch((error: unknown) => {
        console.error('[greanteafx] console failed to load', error);
        if (!cancelled) setStage('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReady = useCallback(() => setStage('ready'), []);

  return (
    <>
      {Console && <Console onReady={handleReady} />}
      <LoadingScreen stage={stage} />
    </>
  );
}
