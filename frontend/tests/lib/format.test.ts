import { describe, expect, it } from 'vitest';

import { bufferOffsetFor } from '@/audio/PreviewEngine';
import { formatClock, formatDuration, formatMetres, formatSpan, pickInterval } from '@/lib/format';

describe('pickInterval', () => {
  it.each([
    [3, 2],
    [20, 2],
    [21, 5],
    [60, 5],
    [61, 15],
    [180, 15],
    [181, 30],
    [600, 30],
  ])('a %is project gets %is ticks', (duration, interval) => {
    expect(pickInterval(duration)).toBe(interval);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [30, '0:30'],
    [125, '2:05'],
    [600, '10:00'],
  ])('%is reads %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('bufferOffsetFor (seek maths)', () => {
  it('advances through the buffer at the tempo rate and wraps', () => {
    expect(bufferOffsetFor(3, 1, 2)).toBeCloseTo(1);
    expect(bufferOffsetFor(3, 2, 4)).toBeCloseTo(2);
  });

  it('never returns a negative offset', () => {
    expect(bufferOffsetFor(-1, 1, 4)).toBeCloseTo(3);
  });

  it('is 0 for an empty buffer', () => {
    expect(bufferOffsetFor(5, 1, 0)).toBe(0);
  });
});

describe('formatClock', () => {
  it.each([
    [0, '0:00.0'],
    [12.4, '0:12.4'],
    [1.2, '0:01.2'],
    [59.96, '0:59.9'],
    [60, '1:00.0'],
    [600, '10:00.0'],
    [-1, '0:00.0'],
  ])('%s s -> %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });
});

describe('formatSpan', () => {
  it('drops trailing zeros', () => {
    expect([30, 2.5, 2.25, 0.125].map(formatSpan)).toEqual(['30s', '2.5s', '2.25s', '0.13s']);
  });
});

describe('formatMetres', () => {
  it('uses a true minus and never shows negative zero', () => {
    expect([1.25, -1.25, -0.04, 0, 6].map(formatMetres)).toEqual(['1.3', '−1.3', '0.0', '0.0', '6.0']);
  });
});
