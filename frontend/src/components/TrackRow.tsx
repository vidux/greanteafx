'use client';

import { useRef, type CSSProperties } from 'react';

import { totalClipSeconds } from '@/domain/clips';
import type { AudioAsset, Clip, Selection, ToolMode, Track } from '@/domain/types';

import { CloseIcon, DuplicateIcon, EyeIcon, EyeOffIcon, UploadIcon } from './icons';
import { WaveformLane } from './WaveformLane';

interface TrackRowProps {
  track: Track;
  assets: Record<string, AudioAsset>;
  projectDuration: number;
  /** Shown in the inspector. */
  selected: boolean;
  /** Muted, or left out by another track's solo. */
  silent: boolean;
  selection: Selection | null;
  toolMode: ToolMode;
  onSelectTrack: (id: string) => void;
  onToggleMute: (id: string) => void;
  onToggleSolo: (id: string) => void;
  onToggleCubeVisible: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onSetVolume: (id: string, volume: number) => void;
  onUpload: (id: string, file: File) => void | Promise<void>;
  onSelect: (selection: Selection | null) => void;
  onSetClips: (trackId: string, clips: Clip[]) => void;
}

/**
 * Summarises what is on a lane. With clips, "the track's file name" is no longer a single
 * answer — a lane can hold pieces of several different samples after a few pastes.
 */
function describeLane(track: Track, assets: Record<string, AudioAsset>): string {
  if (track.loading) return 'uploading…';
  if (track.clips.length === 0) return 'no audio yet';

  const ids = [...new Set(track.clips.map((c) => c.assetId))];
  const prefix = ids.some((id) => assets[id]?.missing) ? '⚠ ' : '';

  if (ids.length === 1) {
    const name = assets[ids[0]!]?.fileName ?? 'sample';
    return track.clips.length === 1 ? prefix + name : `${prefix}${name} ×${track.clips.length}`;
  }
  return `${prefix}${track.clips.length} clips · ${ids.length} sources`;
}

/** One timeline row: the track's controls on the left, its clip lane on the right. */
export function TrackRow({
  track,
  assets,
  projectDuration,
  selected,
  silent,
  selection,
  toolMode,
  onSelectTrack,
  onToggleMute,
  onToggleSolo,
  onToggleCubeVisible,
  onDuplicate,
  onRemove,
  onSetVolume,
  onUpload,
  onSelect,
  onSetClips,
}: TrackRowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const label = describeLane(track, assets);
  const hasMissing = track.clips.some((c) => assets[c.assetId]?.missing);
  const seconds = totalClipSeconds(track.clips);
  const volume = Math.round(track.volume * 100);
  const hasAudio = track.clips.length > 0;

  const pickFile = () => {
    onSelectTrack(track.id);
    fileRef.current?.click();
  };

  // Controls act on this row without moving the inspector, as in the design.
  const only = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    action();
  };

  return (
    <div
      className={`track-row${selected ? ' selected' : ''}${silent ? ' silent' : ''}`}
      style={{ '--ch-color': track.color } as CSSProperties}
    >
      <div className="track-head" onClick={() => onSelectTrack(track.id)}>
        {/* A hidden source still has to be findable in a ten-row list, so its stripe goes dashed. */}
        <span className={`track-stripe${track.cubeVisible ? '' : ' dashed'}`} aria-hidden="true" />

        <div className="track-head-body">
          <div className="track-line">
            <button
              type="button"
              className="track-name"
              aria-pressed={selected}
              title={`Inspect ${track.name}`}
              onClick={only(() => onSelectTrack(track.id))}
            >
              {track.name}
            </button>
            <span
              className={`track-summary${hasMissing ? ' warn' : ''}`}
              title={
                hasMissing
                  ? 'A sample on this lane expired from the server cache — re-upload it to preview or export.'
                  : `${label}${seconds > 0 ? ` · ${seconds.toFixed(1)}s of audio` : ''}`
              }
            >
              {label}
            </span>
            <div className="track-icons">
              <button
                type="button"
                className="icon-btn"
                title={hasAudio ? 'Replace audio — the lane’s clips are discarded' : 'Upload audio'}
                aria-label={hasAudio ? `Replace ${track.name} audio` : `Upload audio to ${track.name}`}
                onClick={only(pickFile)}
              >
                <UploadIcon size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={`Duplicate ${track.name} onto a free channel`}
                aria-label={`Duplicate ${track.name}`}
                onClick={only(() => onDuplicate(track.id))}
              >
                <DuplicateIcon />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="Remove track"
                aria-label={`Remove ${track.name}`}
                onClick={only(() => onRemove(track.id))}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="track-line">
            {/*
              Show/hide is a *view* control, not a mix control — it sits next to M precisely so
              the pair reads as "get it out of the way" vs "silence it".
            */}
            <button
              type="button"
              className={`chip${track.cubeVisible ? ' on' : ''}`}
              aria-pressed={track.cubeVisible}
              aria-label={`Show ${track.name} in the cube`}
              title={
                track.cubeVisible
                  ? 'Shown in the cube — click to hide it (it keeps playing)'
                  : 'Hidden from the cube — click to show it'
              }
              onClick={only(() => onToggleCubeVisible(track.id))}
            >
              {track.cubeVisible ? <EyeIcon /> : <EyeOffIcon />}
            </button>
            <button
              type="button"
              className={`chip chip-mute${track.muted ? ' on' : ''}`}
              aria-pressed={track.muted}
              aria-label={`Mute ${track.name}`}
              title="Mute"
              onClick={only(() => onToggleMute(track.id))}
            >
              M
            </button>
            <button
              type="button"
              className={`chip chip-solo${track.soloed ? ' on' : ''}`}
              aria-pressed={track.soloed}
              aria-label={`Solo ${track.name}`}
              title="Solo — while any track is soloed, only soloed tracks play and export"
              onClick={only(() => onToggleSolo(track.id))}
            >
              S
            </button>
            <input
              type="range"
              className="track-vol"
              min={0}
              max={100}
              step={1}
              value={volume}
              aria-label={`${track.name} volume`}
              title="Volume"
              onChange={(e) => onSetVolume(track.id, parseInt(e.target.value, 10) / 100)}
            />
            <output className="track-vol-value">{volume}</output>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          hidden
          accept="audio/*"
          onChange={async (e) => {
            const input = e.target;
            const file = input.files?.[0];
            if (!file) return;
            try {
              await onUpload(track.id, file);
            } finally {
              /*
               * Reset so re-picking the same file fires `change` again — but only once the
               * upload has finished reading it. Clearing `value` while `file.arrayBuffer()`
               * is still in flight invalidates the File and the read fails with
               * `NotFoundError`.
               */
              input.value = '';
            }
          }}
        />
      </div>

      <WaveformLane
        track={track}
        assets={assets}
        projectDuration={projectDuration}
        selection={selection}
        toolMode={toolMode}
        onSelect={onSelect}
        onSetClips={onSetClips}
        onDropFile={(file) => {
          onSelectTrack(track.id);
          void onUpload(track.id, file);
        }}
      />
    </div>
  );
}
