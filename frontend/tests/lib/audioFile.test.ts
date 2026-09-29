import { describe, expect, it } from 'vitest';

import { isAudioFile } from '@/lib/audioFile';

describe('isAudioFile', () => {
  it('trusts an audio MIME type', () => {
    expect(isAudioFile({ name: 'take', type: 'audio/mpeg' })).toBe(true);
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(isAudioFile({ name: 'Pad.FLAC', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'song.m4a', type: '' })).toBe(true);
  });

  it('refuses anything else before it is uploaded', () => {
    expect(isAudioFile({ name: 'project.gtfx', type: 'application/json' })).toBe(false);
    expect(isAudioFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(false);
    expect(isAudioFile({ name: 'notes', type: '' })).toBe(false);
  });
});
