'use client';

import { useEffect, useRef } from 'react';

/**
 * The quick "how this works" guide, as a native modal <dialog>: it traps focus, closes on
 * Escape and hands focus back to whatever opened it. The full guide stays at /help.
 */
export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React's autoFocus does not reach showModal's focusing steps, so focus by hand.
      doneRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="guide"
      aria-labelledby="guide-title"
      onClose={onClose}
      // The dialog box itself has no padding, so a click that lands on it is a backdrop click.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="guide-body">
        <h2 id="guide-title" className="guide-title">
          How this works
        </h2>
        <ol className="guide-steps">
          <li>
            <strong>Add a track</strong> and drop an audio file on its lane, or use the upload
            button beside its name.
          </li>
          <li>
            <strong>Place the sound</strong> by dragging its dot in the cube. The dot in the middle
            is you, the listener.
          </li>
          <li>
            <strong>Switch view</strong> (Front / Top / Side) to move along the third axis, or open{' '}
            <strong>3D</strong>, orbit freely and drag the red, green and blue arrows.
          </li>
          <li>
            <strong>Make it move</strong>: pick “Moves on a path”, press “+ Add keyframes” and click
            the cube.
          </li>
          <li>
            <strong>Press play</strong> to hear it, then export the mix.
          </li>
        </ol>
        <p className="guide-note">Best with headphones — the spatial effect needs both ears.</p>
        <div className="guide-foot">
          {/* New tab: navigating away would drop the unsaved session and stop playback. */}
          <a href="/help" target="_blank" rel="noopener">
            Read the full guide ↗
          </a>
          <button ref={doneRef} type="button" className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </dialog>
  );
}
