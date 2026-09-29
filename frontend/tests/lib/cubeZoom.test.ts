import { describe, expect, it } from 'vitest';

import {
  clampZoom,
  isZoomWheel,
  MAX_ZOOM,
  MIN_ZOOM,
  parseSavedZoom,
  wheelDeltaPixels,
  ZOOM_STEP,
  zoomByStep,
  zoomByWheel,
} from '@/lib/cubeZoom';

describe('zoomByWheel', () => {
  it('zooms in on scroll up and out on scroll down', () => {
    expect(zoomByWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomByWheel(1, 100)).toBeLessThan(1);
  });

  it('is symmetric, so up then down returns to the start', () => {
    expect(zoomByWheel(zoomByWheel(1, -120), 120)).toBeCloseTo(1, 2);
  });

  it('stays within the zoom range', () => {
    expect(zoomByWheel(1, -1e6)).toBe(MAX_ZOOM);
    expect(zoomByWheel(1, 1e6)).toBe(MIN_ZOOM);
  });

  it('never exceeds the space the cube has', () => {
    expect(zoomByWheel(1, -1e6, 1.4)).toBe(1.4);
  });
});

describe('zoomByStep', () => {
  it('multiplies by the step factor either way', () => {
    expect(zoomByStep(1, 1)).toBeCloseTo(ZOOM_STEP, 3);
    expect(zoomByStep(1, -1)).toBeCloseTo(1 / ZOOM_STEP, 3);
  });
});

describe('clampZoom', () => {
  it('keeps the minimum even when the panel is tiny', () => {
    expect(clampZoom(1, 0.2)).toBe(MIN_ZOOM);
  });

  it('rounds away floating-point drift', () => {
    expect(clampZoom(1.00000001)).toBe(1);
  });
});

describe('wheelDeltaPixels', () => {
  it('normalises line and page deltas to pixels', () => {
    expect(wheelDeltaPixels(3, 0)).toBe(3);
    expect(wheelDeltaPixels(3, 1)).toBe(48);
    expect(wheelDeltaPixels(1, 2)).toBe(400);
  });

  it('falls back to horizontal delta when Shift turned the wheel sideways', () => {
    expect(wheelDeltaPixels(0, 0, -120)).toBe(-120);
  });
});

describe('isZoomWheel', () => {
  type Keys = { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };
  const keys = (over: Partial<Keys>): Keys => ({
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...over,
  });

  it('zooms on Shift + wheel only', () => {
    expect(isZoomWheel(keys({ shiftKey: true }))).toBe(true);
    expect(isZoomWheel(keys({}))).toBe(false);
    expect(isZoomWheel(keys({ altKey: true }))).toBe(false);
  });

  it('leaves Ctrl + wheel and pinch to the browser', () => {
    expect(isZoomWheel(keys({ ctrlKey: true }))).toBe(false);
    expect(isZoomWheel(keys({ shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(isZoomWheel(keys({ shiftKey: true, metaKey: true }))).toBe(false);
  });
});

describe('parseSavedZoom', () => {
  it('restores a saved zoom and rejects junk', () => {
    expect(parseSavedZoom('1.5')).toBe(1.5);
    expect(parseSavedZoom('99')).toBe(MAX_ZOOM);
    expect(parseSavedZoom('abc')).toBe(1);
    expect(parseSavedZoom(null)).toBe(1);
  });
});
