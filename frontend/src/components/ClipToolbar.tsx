'use client';

import type { Clipboard, PasteAnchor, Selection, ToolMode, Track } from '@/domain/types';

import { MoveToolIcon, SelectToolIcon } from './icons';

interface ClipToolbarProps {
  selection: Selection | null;
  clipboard: Clipboard | null;
  pasteAnchor: PasteAnchor | null;
  tracks: readonly Track[];
  toolMode: ToolMode;
  /** The track paste and split act on — the selected one (see `editTargetId`). */
  editTarget: Track | null;
  onSetToolMode: (mode: ToolMode) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onPaste: () => void;
  onSplit: () => void;
}

const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl+';

/**
 * Lane tools, a readout of the selection and clipboard, and the edit buttons with their keys.
 *
 * The buttons exist because the shortcuts are invisible: a first-time user has no way to
 * discover Ctrl+C on a canvas. The readout matters as much — "what will paste do right now?"
 * is otherwise guesswork once a selection and a clipboard are both in play.
 */
export function ClipToolbar({
  selection,
  clipboard,
  pasteAnchor,
  tracks,
  toolMode,
  editTarget,
  onSetToolMode,
  onCopy,
  onCut,
  onDelete,
  onPaste,
  onSplit,
}: ClipToolbarProps) {
  const track = selection ? tracks.find((t) => t.id === selection.trackId) : null;
  const span = selection ? selection.endSeconds - selection.startSeconds : 0;
  const hasSelection = Boolean(selection) && span > 0;
  const hasClipboard = Boolean(clipboard && clipboard.items.length > 0);

  const canSplit = Boolean(editTarget && editTarget.clips.length > 0);

  // The next paste continues the run only while the anchor still points at the lane that would
  // receive it; say so, because "at the playhead" and "after the last one" are far apart.
  const appendingAt =
    pasteAnchor && editTarget && pasteAnchor.trackId === editTarget.id
      ? pasteAnchor.endSeconds
      : null;

  const toolHint =
    toolMode === 'select'
      ? 'Drag across a lane to select a region · click a clip to select it'
      : 'Drag a clip, or a selected region, to move it in time';

  const selectionText =
    hasSelection && track
      ? `${track.name} ${selection!.startSeconds.toFixed(2)}–${selection!.endSeconds.toFixed(2)}s · ${span.toFixed(2)}s selected`
      : null;
  // Naming the receiving track is what confirms that selecting an empty track worked.
  const clipboardText = hasClipboard
    ? `clipboard ${clipboard!.durationSeconds.toFixed(2)}s${editTarget ? ` → ${editTarget.name}` : ''}`
    : null;
  const chainText = appendingAt !== null ? `next paste at ${appendingAt.toFixed(2)}s` : null;

  return (
    <>
      <div className="segmented" role="group" aria-label="Lane tool">
        <button
          type="button"
          className="seg-btn seg-sm"
          aria-pressed={toolMode === 'select'}
          title="Select tool (V) — drag a lane to select a time region"
          onClick={() => onSetToolMode('select')}
        >
          <SelectToolIcon />
          Select <kbd>V</kbd>
        </button>
        <button
          type="button"
          className="seg-btn seg-sm"
          aria-pressed={toolMode === 'move'}
          title="Move tool (M) — drag audio along the timeline"
          onClick={() => onSetToolMode('move')}
        >
          <MoveToolIcon />
          Move <kbd>M</kbd>
        </button>
      </div>

      <span
        className="timeline-hint"
        title={[selectionText ?? toolHint, clipboardText, chainText].filter(Boolean).join(' · ')}
      >
        {selectionText ? <span className="hint-strong">{selectionText}</span> : toolHint}
        {clipboardText && <> · {clipboardText}</>}
        {chainText && (
          <>
            {' · '}
            <span className="hint-chain">{chainText}</span>
          </>
        )}
      </span>

      <div className="clip-actions">
        <button type="button" className="btn-action" disabled={!hasSelection} onClick={onCopy}>
          Copy <kbd>{MOD}C</kbd>
        </button>
        <button type="button" className="btn-action" disabled={!hasSelection} onClick={onCut}>
          Cut <kbd>{MOD}X</kbd>
        </button>
        <button
          type="button"
          className="btn-action"
          disabled={!hasClipboard}
          onClick={onPaste}
          title={
            !hasClipboard
              ? 'Copy or cut a region first'
              : appendingAt !== null
                ? `Paste as a new clip into ${editTarget!.name} at ${appendingAt.toFixed(2)}s, after the last paste`
                : `Paste as a new clip into ${editTarget?.name ?? 'the selected track'} at the playhead`
          }
        >
          Paste <kbd>{MOD}V</kbd>
        </button>
        <button
          type="button"
          className="btn-action"
          disabled={!canSplit}
          onClick={onSplit}
          title={`Split the clip under the playhead on ${editTarget?.name ?? 'the selected track'}`}
        >
          Split <kbd>S</kbd>
        </button>
        <button
          type="button"
          className="btn-action danger"
          disabled={!hasSelection}
          onClick={onDelete}
        >
          Delete <kbd>Del</kbd>
        </button>
      </div>
    </>
  );
}
