'use client';

import type { CSSProperties, RefObject } from 'react';

import { MAX_TRACKS } from '@/domain/constants';
import { editTargetId, isSilenced, soloActive } from '@/domain/tracks';
import type {
  AudioAsset,
  Clip,
  Clipboard,
  PasteAnchor,
  Selection,
  ToolMode,
  Track,
} from '@/domain/types';
import { pickInterval } from '@/lib/format';

import { ClipToolbar } from './ClipToolbar';
import { Ruler } from './Ruler';
import { TrackRow } from './TrackRow';

interface TimelineProps {
  tracks: readonly Track[];
  assets: Record<string, AudioAsset>;
  projectDuration: number;
  selectedTrackId: string | null;
  selection: Selection | null;
  clipboard: Clipboard | null;
  pasteAnchor: PasteAnchor | null;
  toolMode: ToolMode;
  /** Playhead over the lanes and marker in the ruler, both positioned by the frame loop. */
  lanesHeadRef: RefObject<HTMLDivElement | null>;
  rulerHeadRef: RefObject<HTMLDivElement | null>;
  onAddTrack: () => void;
  onSelectTrack: (id: string) => void;
  onToggleMute: (id: string) => void;
  onToggleSolo: (id: string) => void;
  onToggleCubeVisible: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onSetVolume: (id: string, volume: number) => void;
  onUpload: (id: string, file: File) => void | Promise<void>;
  onSeek: (seconds: number) => void;
  onSelect: (selection: Selection | null) => void;
  onSetClips: (trackId: string, clips: Clip[]) => void;
  onSetToolMode: (mode: ToolMode) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onPaste: () => void;
  onSplit: () => void;
}

export function Timeline(props: TimelineProps) {
  const { tracks, assets, projectDuration, selectedTrackId, selection } = props;
  const activeTracks = tracks.filter((t) => t.active);
  const solo = soloActive(tracks);

  const targetId = editTargetId(tracks, selectedTrackId, selection);
  const editTarget = activeTracks.find((t) => t.id === targetId) ?? null;

  // Faint gridlines under the lanes, one per ruler tick.
  const tickPct = (pickInterval(projectDuration) / projectDuration) * 100;

  return (
    <section className="timeline" aria-label="Tracks">
      <div className="timeline-bar">
        <h2 className="timeline-title">Tracks</h2>
        <span className="timeline-count">
          {activeTracks.length} / {MAX_TRACKS}
        </span>

        <ClipToolbar
          selection={selection}
          clipboard={props.clipboard}
          pasteAnchor={props.pasteAnchor}
          tracks={tracks}
          toolMode={props.toolMode}
          editTarget={editTarget}
          onSetToolMode={props.onSetToolMode}
          onCopy={props.onCopy}
          onCut={props.onCut}
          onDelete={props.onDelete}
          onPaste={props.onPaste}
          onSplit={props.onSplit}
        />

        <button
          type="button"
          className="btn btn-accent add-track"
          disabled={activeTracks.length >= MAX_TRACKS}
          onClick={props.onAddTrack}
        >
          + Add track
        </button>
      </div>

      <div className="timeline-scroll">
        <Ruler projectDuration={projectDuration} onSeek={props.onSeek} headRef={props.rulerHeadRef} />

        <div className="timeline-rows" style={{ '--tick-pct': `${tickPct}%` } as CSSProperties}>
          {activeTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              assets={assets}
              projectDuration={projectDuration}
              selected={track.id === selectedTrackId}
              silent={isSilenced(track, solo)}
              selection={selection}
              toolMode={props.toolMode}
              onSelectTrack={props.onSelectTrack}
              onToggleMute={props.onToggleMute}
              onToggleSolo={props.onToggleSolo}
              onToggleCubeVisible={props.onToggleCubeVisible}
              onDuplicate={props.onDuplicate}
              onRemove={props.onRemove}
              onSetVolume={props.onSetVolume}
              onUpload={props.onUpload}
              onSelect={props.onSelect}
              onSetClips={props.onSetClips}
            />
          ))}

          {activeTracks.length === 0 && (
            <p className="timeline-empty">No tracks yet — press + Add track to start.</p>
          )}

          {/* Spans every row, however far the list scrolls. */}
          <div ref={props.lanesHeadRef} className="playhead" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
