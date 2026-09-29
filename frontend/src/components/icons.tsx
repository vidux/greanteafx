/**
 * Inline SVG icons. Decorative: every button that uses one carries its own accessible name, so
 * the SVGs are hidden from assistive technology.
 */

const hidden = { 'aria-hidden': true, focusable: false } as const;

export function PlayIcon() {
  return (
    <svg {...hidden} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2v12l10-6z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg {...hidden} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="2" width="4" height="12" />
      <rect x="9" y="2" width="4" height="12" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg {...hidden} width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="1" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function RewindIcon() {
  return (
    <svg {...hidden} width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="3" width="2" height="10" />
      <path d="M14 3v10L5 8z" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg {...hidden} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 1v8M3.5 6L7 9.5 10.5 6M2 12.5h10" />
    </svg>
  );
}

export function UploadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...hidden} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M2 13h12" />
    </svg>
  );
}

/** Open eye — this source is drawn in the cube. */
export function EyeIcon() {
  return (
    <svg {...hidden} width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.6-4 7-4 7 4 7 4-2.6 4-7 4-7-4-7-4Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

/** Struck-through eye — hidden from the cube (but still sounding). */
export function EyeOffIcon() {
  return (
    <svg {...hidden} width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.6 4.9C1.6 6 1 8 1 8s2.6 4 7 4c1.2 0 2.2-.3 3.1-.7M6.1 4.3C6.7 4.1 7.3 4 8 4c4.4 0 7 4 7 4s-.8 1.2-2.2 2.3" />
      <path d="M6.6 6.6a1.9 1.9 0 0 0 2.7 2.7" />
      <path d="M2 2l12 12" />
    </svg>
  );
}

export function DuplicateIcon() {
  return (
    <svg {...hidden} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
      <path d="M9.5 2.5v-.5a1 1 0 0 0-1-1H2.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...hidden} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
}

/** I-beam between range brackets — the standard "select a span" mark. */
export function SelectToolIcon() {
  return (
    <svg {...hidden} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 2v12M13.5 2v12" />
      <path d="M6 4h4M6 12h4M8 4v8" />
    </svg>
  );
}

/** Horizontal double-headed arrow — "drag this along the timeline". */
export function MoveToolIcon() {
  return (
    <svg {...hidden} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 8h13" />
      <path d="M4.5 5 1.5 8l3 3M11.5 5l3 3-3 3" />
    </svg>
  );
}
