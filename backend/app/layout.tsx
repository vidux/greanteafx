import type { ReactNode } from 'react';

export const metadata = {
  title: 'GreanTeaFX Render Service',
  description: 'Audio decoding, waveform extraction and offline HRTF mixdown for GreanTeaFX.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#0A0D0B',
          color: '#D8E8DC',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {children}
      </body>
    </html>
  );
}
