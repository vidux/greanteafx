'use client';

import { isSilenced, soloActive } from '@/domain/tracks';
import type { AudioAsset, Track } from '@/domain/types';

interface StatusBarProps {
  playing: boolean;
  tracks: readonly Track[];
  assets: Record<string, AudioAsset>;
  /** The last action's message, if any. */
  status: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Transport state and what the project still needs, then the last message, then shortcuts. */
export function StatusBar({ playing, tracks, assets, status }: StatusBarProps) {
  const active = tracks.filter((t) => t.active);
  const solo = soloActive(tracks);

  let summary: string;
  if (playing) {
    const audible = active.filter(
      (t) =>
        !isSilenced(t, solo) &&
        t.clips.some((c) => assets[c.assetId] && !assets[c.assetId]!.missing),
    ).length;
    summary = `Playing · ${plural(audible, 'track')} audible`;
  } else {
    const empty = active.filter((t) => t.clips.length === 0).length;
    summary =
      empty > 0
        ? `Stopped · ${plural(empty, 'track')} still need${empty === 1 ? 's' : ''} audio`
        : active.length > 0
          ? 'Stopped · ready to export'
          : 'Stopped · no tracks';
  }

  return (
    <footer className="status-bar">
      <span className="status-state">
        <span className={`status-dot${playing ? ' live' : ''}`} aria-hidden="true" />
        {summary}
      </span>
      <span className="status-msg" role="status" title={status || undefined}>
        {status}
      </span>
      <span className="status-keys">
        Space play · V select · M move · S split · Del delete · ⇧ scroll zoom · ? guide
      </span>
    </footer>
  );
}
