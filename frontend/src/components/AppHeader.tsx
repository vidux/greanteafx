'use client';

import { useEffect, useRef, useState, type Ref } from 'react';

import { MAX_DURATION, MIN_DURATION } from '@/domain/constants';
import { formatClock } from '@/lib/format';

import { Brand } from './Brand';
import { DownloadIcon, PauseIcon, PlayIcon, RewindIcon, StopIcon } from './icons';

interface AppHeaderProps {
  playing: boolean;
  projectDuration: number;
  masterVolume: number;
  rendering: boolean;
  /** The running clock; written by the animation-frame loop, never through state. */
  clockRef: Ref<HTMLSpanElement>;
  onTogglePlay: () => void;
  onRewind: () => void;
  onStop: () => void;
  onSetDuration: (seconds: number) => void;
  onSetMasterVolume: (v: number) => void;
  onRender: () => void;
  onSaveProject: () => void;
  onOpenProject: (file: File) => void | Promise<void>;
  onOpenGuide: () => void;
}

export function AppHeader({
  playing,
  projectDuration,
  masterVolume,
  rendering,
  clockRef,
  onTogglePlay,
  onRewind,
  onStop,
  onSetDuration,
  onSetMasterVolume,
  onRender,
  onSaveProject,
  onOpenProject,
  onOpenGuide,
}: AppHeaderProps) {
  const openRef = useRef<HTMLInputElement>(null);

  /**
   * The number field is intentionally uncontrolled-ish: clamping mid-keystroke would make
   * typing "300" impossible (the leading "3" would snap to the minimum). The prototype
   * committed on `change` for the same reason; this mirrors it and re-syncs if the store
   * value moves for any other reason.
   */
  const [draft, setDraft] = useState(String(projectDuration));

  useEffect(() => {
    setDraft(String(projectDuration));
  }, [projectDuration]);

  const commit = () => {
    const parsed = parseInt(draft, 10);
    onSetDuration(Number.isFinite(parsed) ? parsed : 30);
  };

  const master = Math.round(masterVolume * 100);

  return (
    <header className="app-header">
      <Brand subtitle="Spatial audio timeline" heading />

      <div className="header-actions">
        <button type="button" className="btn btn-outline" onClick={() => openRef.current?.click()}>
          Open
        </button>
        <input
          ref={openRef}
          type="file"
          hidden
          accept=".gtfx,.sonar,application/json"
          onChange={async (e) => {
            const input = e.target;
            const file = input.files?.[0];
            if (!file) return;
            try {
              await onOpenProject(file);
            } finally {
              // Cleared only after the read completes — see the note in TrackRow.
              input.value = '';
            }
          }}
        />
        <button type="button" className="btn btn-outline" onClick={onSaveProject}>
          Save
        </button>
        <button
          type="button"
          className="btn btn-outline btn-square"
          onClick={onOpenGuide}
          title="Quick guide (?)"
          aria-label="Quick guide"
        >
          ?
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={rendering}
          aria-busy={rendering}
          onClick={onRender}
        >
          <DownloadIcon />
          {rendering ? 'Exporting…' : 'Export mix (WAV)'}
        </button>
      </div>

      <div className="transport" role="group" aria-label="Transport">
        <button type="button" className="btn-icon" onClick={onRewind} title="Back to start" aria-label="Back to start">
          <RewindIcon />
        </button>
        <button
          type="button"
          className="btn-play"
          onClick={onTogglePlay}
          title="Play / Pause (Space)"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="btn-icon"
          onClick={onStop}
          title="Stop and return to the start"
          aria-label="Stop"
        >
          <StopIcon />
        </button>

        <div className="clock" role="timer" aria-label="Playhead position">
          <span ref={clockRef}>{formatClock(0)}</span>
          <span className="clock-total">/ {formatClock(projectDuration)}</span>
        </div>

        <span className="transport-divider" aria-hidden="true" />

        <label className="transport-field">
          Length
          <input
            type="number"
            className="input-number"
            min={MIN_DURATION}
            max={MAX_DURATION}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
          <span>s</span>
        </label>

        <label className="transport-field">
          Master
          <input
            type="range"
            className="transport-master"
            min={0}
            max={100}
            step={1}
            value={master}
            onChange={(e) => onSetMasterVolume(parseInt(e.target.value, 10) / 100)}
          />
          <output className="transport-value">{master}</output>
        </label>
      </div>
    </header>
  );
}
