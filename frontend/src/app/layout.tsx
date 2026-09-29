import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import './globals.css';

/*
 * Self-hosted from the @fontsource packages (OFL-1.1) rather than `next/font/google`. Google
 * sometimes serves these as `fonts.gstatic.com/l/font?kit=…&skey=…` URLs, which Turbopack's font
 * loader cannot parse ("next/font/google queries have exactly one entry"); the dev cache then
 * keeps failing until cleared. Local files also mean builds need no network. Latin subset only —
 * the UI is English, and its few symbols (· × ⇧ ⌘) fall back to system fonts.
 */
const instrumentSans = localFont({
  src: [
    { path: '../../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const plexMono = localFont({
  src: [
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GreanTeaFX — Spatial Audio Timeline',
  description:
    'Place sound sources in 3D, automate their motion, and render an HRTF-spatialised mixdown.',
};

// Dark-only UI: native controls, scrollbars and the page behind them should match.
export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0b0f0d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
