import { describe, expect, it } from 'vitest';

import {
  clipAt,
  clipsOverlapping,
  copyRegion,
  extractRegion,
  fullLengthLoopClip,
  healSeams,
  moveClips,
  nearestFreeStart,
  nextClipId,
  pasteClips,
  pasteStartSeconds,
  removeRegion,
  resizeSpanningLoops,
  sortClips,
  sourceOffsetAt,
  spanOf,
  splitAt,
  totalClipSeconds,
} from '@/domain/clips';
import type { Clip, ClipboardItem } from '@/domain/types';

const ASSET = '11111111-1111-4111-8111-111111111111';

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: nextClipId(),
    assetId: ASSET,
    startSeconds: 0,
    offsetSeconds: 0,
    durationSeconds: 4,
    loop: false,
    ...over,
  };
}

function overlapFree(lane: readonly Clip[]): boolean {
  const sorted = sortClips(lane);
  return sorted.every((c, i) => i === 0 || c.startSeconds >= sorted[i - 1]!.startSeconds + sorted[i - 1]!.durationSeconds - 1e-9);
}

const shape = (c: Clip) => ({
  start: c.startSeconds,
  offset: c.offsetSeconds,
  duration: c.durationSeconds,
});

describe('nextClipId', () => {
  it('never repeats within a session', () => {
    const ids = new Set(Array.from({ length: 1000 }, nextClipId));
    expect(ids.size).toBe(1000);
  });
});

describe('sourceOffsetAt', () => {
  it('advances into the source at the tempo rate', () => {
    const c = clip({ startSeconds: 2, offsetSeconds: 1 });
    expect(sourceOffsetAt(c, 5, 2)).toBe(7);
  });

  it('clamps to the clip start for earlier times', () => {
    const c = clip({ startSeconds: 2, offsetSeconds: 1 });
    expect(sourceOffsetAt(c, 0, 1)).toBe(1);
  });

  it('treats a zero tempo as 1', () => {
    expect(sourceOffsetAt(clip(), 3, 0)).toBe(3);
  });
});

describe('clipsOverlapping / clipAt', () => {
  it('uses half-open intervals, so touching clips do not overlap', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 4 });
    expect(clipsOverlapping([a], 4, 6)).toEqual([]);
    expect(clipsOverlapping([a], 3.9, 6)).toEqual([a]);
  });

  it('returns the most recently added clip under a point', () => {
    const under = clip({ startSeconds: 0, durationSeconds: 10 });
    const over = clip({ startSeconds: 2, durationSeconds: 2 });
    expect(clipAt([under, over], 3)).toBe(over);
    expect(clipAt([under, over], 4)).toBe(under);
    expect(clipAt([under, over], 10)).toBeUndefined();
  });
});

describe('copyRegion', () => {
  it('copies each overlapping fragment with its source offset and spacing', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 4 });
    const b = clip({ startSeconds: 6, durationSeconds: 2, offsetSeconds: 1, loop: true });
    const items = copyRegion([a, b], 2, 7, 1);
    expect(items).toEqual([
      { assetId: ASSET, offsetSeconds: 2, durationSeconds: 2, loop: false, relativeStart: 0 },
      { assetId: ASSET, offsetSeconds: 1, durationSeconds: 1, loop: true, relativeStart: 4 },
    ]);
  });

  it('accounts for tempo when computing the source offset', () => {
    const [item] = copyRegion([clip({ durationSeconds: 10 })], 3, 4, 2);
    expect(item!.offsetSeconds).toBe(6);
  });

  it('returns nothing for empty space or an inverted range', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 4 });
    expect(copyRegion([a], 5, 8, 1)).toEqual([]);
    expect(copyRegion([a], 3, 1, 1)).toEqual([]);
  });
});

describe('removeRegion', () => {
  it('splits a clip that contains the range and advances the right-hand piece', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 10 });
    const result = removeRegion([a], 3, 5, 2);
    expect(result.map(shape)).toEqual([
      { start: 0, offset: 0, duration: 3 },
      { start: 5, offset: 10, duration: 5 },
    ]);
    expect(result.every((c) => c.id !== a.id)).toBe(true);
  });

  it('keeps untouched clips by reference and drops fully covered ones', () => {
    const keep = clip({ startSeconds: 20, durationSeconds: 2 });
    const covered = clip({ startSeconds: 3, durationSeconds: 1 });
    const result = removeRegion([keep, covered], 2, 5, 1);
    expect(result).toEqual([keep]);
    expect(result[0]).toBe(keep);
  });

  it('trims a clip overlapping only one edge', () => {
    const a = clip({ startSeconds: 4, durationSeconds: 4 });
    expect(removeRegion([a], 2, 6, 1).map(shape)).toEqual([{ start: 6, offset: 2, duration: 2 }]);
  });

  it('is a no-op for an empty range', () => {
    const a = clip();
    expect(removeRegion([a], 2, 2, 1)).toEqual([a]);
  });
});

describe('pasteStartSeconds', () => {
  it('continues after the previous paste on the same lane', () => {
    expect(pasteStartSeconds({ trackId: 't1', endSeconds: 9 }, 't1', 2, 30)).toBe(9);
  });

  it('uses the playhead on a different lane or without an anchor', () => {
    expect(pasteStartSeconds({ trackId: 't1', endSeconds: 9 }, 't2', 2, 30)).toBe(2);
    expect(pasteStartSeconds(null, 't1', 2, 30)).toBe(2);
  });

  it('clamps into the project and survives a non-finite playhead', () => {
    expect(pasteStartSeconds(null, 't1', 99, 30)).toBe(30);
    expect(pasteStartSeconds(null, 't1', -5, 30)).toBe(0);
    expect(pasteStartSeconds(null, 't1', Number.NaN, 30)).toBe(0);
  });
});

describe('pasteClips', () => {
  const item = (over: Partial<ClipboardItem> = {}): ClipboardItem => ({
    assetId: ASSET,
    offsetSeconds: 1,
    durationSeconds: 2,
    loop: false,
    relativeStart: 0,
    ...over,
  });

  it('places items relative to where the block lands, with fresh ids', () => {
    const result = pasteClips([], [item(), item({ relativeStart: 3 })], 10, 5, 30)!;
    expect(result.startSeconds).toBe(10);
    expect(result.clips.map(shape)).toEqual([
      { start: 10, offset: 1, duration: 2 },
      { start: 13, offset: 1, duration: 2 },
    ]);
    expect(new Set(result.clips.map((c) => c.id)).size).toBe(2);
  });

  it('never overwrites: it shifts to the nearest gap and leaves existing clips alone', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 4 });
    const b = clip({ startSeconds: 6, durationSeconds: 2 });
    const result = pasteClips([a, b], [item()], 1, 2, 30)!;
    expect(result.startSeconds).toBe(4);
    expect(result.clips).toContain(a);
    expect(result.clips).toContain(b);
    expect(overlapFree(result.clips)).toBe(true);
  });

  it('shifts left rather than being cut off at the project end', () => {
    const result = pasteClips([], [item()], 29, 2, 30)!;
    expect(result.startSeconds).toBe(28);
    expect(result.clips[0]!.durationSeconds).toBe(2);
  });

  it('returns null when no gap can hold the whole block', () => {
    const full = clip({ startSeconds: 0, durationSeconds: 29 });
    expect(pasteClips([full], [item()], 5, 2, 30)).toBeNull();
    expect(pasteClips([], [item()], 0, 31, 30)).toBeNull();
  });

  it('returns null for an empty clipboard', () => {
    expect(pasteClips([clip()], [], 0, 0, 30)).toBeNull();
  });
});

describe('nearestFreeStart', () => {
  const lane = [clip({ startSeconds: 2, durationSeconds: 2 }), clip({ startSeconds: 8, durationSeconds: 2 })];

  it('keeps the requested start when it is free', () => {
    expect(nearestFreeStart(lane, 5, 2, 30)).toBe(5);
  });

  it('slides into the closest gap that fits, either way', () => {
    expect(nearestFreeStart(lane, 3, 1, 30)).toBe(4);
    expect(nearestFreeStart(lane, 2.2, 1, 30)).toBe(1);
  });

  it('skips gaps that are too short', () => {
    expect(nearestFreeStart(lane, 5, 5, 30)).toBe(10);
  });

  it('prefers the right on a tie', () => {
    const two = [clip({ startSeconds: 4, durationSeconds: 2 })];
    expect(nearestFreeStart(two, 4, 2, 30)).toBe(6);
  });
});

describe('splitAt', () => {
  it('splits the clip under the point into two abutting clips', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 6, offsetSeconds: 1 });
    expect(splitAt([a], 2, 1).map(shape)).toEqual([
      { start: 0, offset: 1, duration: 2 },
      { start: 2, offset: 3, duration: 4 },
    ]);
  });

  it('does nothing on a boundary or in empty space', () => {
    const a = clip({ startSeconds: 2, durationSeconds: 2 });
    expect(splitAt([a], 2, 1)).toEqual([a]);
    expect(splitAt([a], 8, 1)).toEqual([a]);
  });
});

describe('extractRegion', () => {
  it('cuts the selected range free as its own clip', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 10 });
    const { clips, ids } = extractRegion([a], 3, 6, 1);
    expect(clips).toHaveLength(3);
    expect(ids).toHaveLength(1);
    const piece = clips.find((c) => c.id === ids[0])!;
    expect(shape(piece)).toEqual({ start: 3, offset: 3, duration: 3 });
  });

  it('is idempotent at existing boundaries', () => {
    const first = extractRegion([clip({ durationSeconds: 10 })], 3, 6, 1);
    const second = extractRegion(first.clips, 3, 6, 1);
    expect(second.clips).toHaveLength(3);
  });

  it('returns no ids for an empty range', () => {
    expect(extractRegion([clip()], 2, 2, 1).ids).toEqual([]);
  });
});

describe('moveClips', () => {
  it('shifts only the chosen clips', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 2 });
    const b = clip({ startSeconds: 5, durationSeconds: 2 });
    const moved = moveClips([a, b], [b.id], 3, 30);
    expect(moved.find((c) => c.id === b.id)!.startSeconds).toBe(8);
    expect(moved.find((c) => c.id === a.id)!.startSeconds).toBe(0);
  });

  it('clamps the group at both ends of the project', () => {
    const b = clip({ startSeconds: 2, durationSeconds: 4 });
    expect(moveClips([b], [b.id], 100, 30)[0]!.startSeconds).toBe(26);
    expect(moveClips([b], [b.id], -100, 30)[0]!.startSeconds).toBe(0);
  });

  it('keeps the spacing of a multi-clip group when clamped', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 2 });
    const b = clip({ startSeconds: 4, durationSeconds: 2 });
    const moved = moveClips([a, b], [a.id, b.id], 100, 30);
    expect(moved.map((c) => c.startSeconds)).toEqual([24, 28]);
  });

  it('shifts beside a clip it is dropped on, leaving that clip whole', () => {
    const target = clip({ startSeconds: 20, durationSeconds: 5 });
    const mover = clip({ startSeconds: 2, durationSeconds: 2 });
    const moved = moveClips([target, mover], [mover.id], 18, 30);
    expect(moved.find((c) => c.id === mover.id)!.startSeconds).toBe(18);
    expect(moved).toContain(target);
  });

  it('jumps to the far side once dropped past the middle of a clip', () => {
    const target = clip({ startSeconds: 20, durationSeconds: 5 });
    const mover = clip({ startSeconds: 2, durationSeconds: 2 });
    const moved = moveClips([target, mover], [mover.id], 21, 30);
    expect(moved.find((c) => c.id === mover.id)!.startSeconds).toBe(25);
    expect(moved).toContain(target);
  });

  it('stays where it was when no gap can hold it', () => {
    const wall = clip({ startSeconds: 0, durationSeconds: 28 });
    const mover = clip({ startSeconds: 28, durationSeconds: 2 });
    expect(moveClips([wall, mover], [mover.id], -10, 30).find((c) => c.id === mover.id)!.startSeconds).toBe(28);
  });

  it('never overlaps or disturbs other clips, wherever it is dropped', () => {
    const lane = [0, 5, 9, 14].map((start) => clip({ startSeconds: start, durationSeconds: 3 }));
    for (let delta = -20; delta <= 30; delta += 0.5) {
      const moved = moveClips(lane, [lane[1]!.id], delta, 30);
      expect(overlapFree(moved)).toBe(true);
      // Nothing but the dragged clip ever moves, splits or disappears.
      for (const other of [lane[0]!, lane[2]!, lane[3]!]) expect(moved).toContain(other);
    }
  });

  it('ignores unknown ids', () => {
    const a = clip();
    expect(moveClips([a], ['nope'], 5, 30)).toEqual([a]);
  });
});

describe('healSeams', () => {
  it('rejoins touching pieces that continue the same audio', () => {
    const [left, right] = splitAt([clip({ startSeconds: 0, durationSeconds: 6, offsetSeconds: 1 })], 2, 1);
    const healed = healSeams([left!, right!], new Set([right!.id]), 1);
    expect(healed.map(shape)).toEqual([{ start: 0, offset: 1, duration: 6 }]);
  });

  it('accounts for tempo when checking continuity', () => {
    const [left, right] = splitAt([clip({ durationSeconds: 6 })], 2, 2);
    expect(healSeams([left!, right!], new Set([left!.id]), 2)).toHaveLength(1);
  });

  it('leaves splits alone when neither side is a candidate', () => {
    const lane = splitAt([clip({ durationSeconds: 6 })], 2, 1);
    expect(healSeams(lane, new Set(), 1)).toBe(lane);
  });

  it('does not join pieces that are apart, from other sources, or not continuous', () => {
    const a = clip({ startSeconds: 0, durationSeconds: 2 });
    const gap = clip({ startSeconds: 3, durationSeconds: 2, offsetSeconds: 2 });
    const other = clip({ startSeconds: 2, durationSeconds: 2, offsetSeconds: 2, assetId: 'other' });
    const jump = clip({ startSeconds: 2, durationSeconds: 2, offsetSeconds: 9 });
    for (const b of [gap, other, jump]) {
      expect(healSeams([a, b], new Set([a.id, b.id]), 1)).toHaveLength(2);
    }
  });
});

describe('spanOf', () => {
  it('covers every clip in the set', () => {
    const a = clip({ startSeconds: 2, durationSeconds: 1 });
    const b = clip({ startSeconds: 6, durationSeconds: 2 });
    expect(spanOf([a, b], [a.id, b.id])).toEqual({ startSeconds: 2, endSeconds: 8 });
  });

  it('is null when no clip matches', () => {
    expect(spanOf([clip()], ['nope'])).toBeNull();
  });
});

describe('resizeSpanningLoops', () => {
  it('stretches and shrinks a clip that spans the whole project', () => {
    const loop = fullLengthLoopClip(ASSET, 30);
    expect(resizeSpanningLoops([loop], 30, 90)[0]!.durationSeconds).toBe(90);
    expect(resizeSpanningLoops([loop], 30, 10)[0]!.durationSeconds).toBe(10);
  });

  it('leaves placed, trimmed or one-shot clips alone and returns the same array', () => {
    const lanes = [
      clip({ startSeconds: 5, durationSeconds: 25, loop: true }),
      clip({ startSeconds: 0, durationSeconds: 20, loop: true }),
      clip({ startSeconds: 0, durationSeconds: 30, loop: false }),
    ];
    expect(resizeSpanningLoops(lanes, 30, 60)).toBe(lanes);
  });
});

describe('helpers', () => {
  it('fullLengthLoopClip reproduces the one-sample-per-track behaviour', () => {
    expect(fullLengthLoopClip(ASSET, 30)).toMatchObject({
      assetId: ASSET,
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: 30,
      loop: true,
    });
  });

  it('sortClips orders by start without mutating the input', () => {
    const late = clip({ startSeconds: 9 });
    const early = clip({ startSeconds: 1 });
    const input = [late, early];
    expect(sortClips(input)).toEqual([early, late]);
    expect(input).toEqual([late, early]);
  });

  it('totalClipSeconds sums durations', () => {
    expect(totalClipSeconds([clip({ durationSeconds: 2 }), clip({ durationSeconds: 3.5 })])).toBe(
      5.5,
    );
  });
});
