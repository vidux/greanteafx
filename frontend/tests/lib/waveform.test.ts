import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioAsset, Clip } from '@/domain/types';
import { drawClipLane, type ClipLaneDrawOptions } from '@/lib/waveform';

/** Records draw calls; the lane is 100×40 CSS px at devicePixelRatio 1 unless given. */
function fakeCanvas(width = 100, height = 40) {
  const calls = {
    fillRect: [] as number[][],
    roundRect: [] as number[][],
    fillText: [] as string[],
    moveTo: [] as number[][],
  };
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    setTransform() {},
    clearRect() {},
    beginPath() {},
    lineTo() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    rect() {},
    clip() {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillRect: (...args: number[]) => calls.fillRect.push(args),
    roundRect: (...args: number[]) => calls.roundRect.push(args),
    fillText: (text: string) => calls.fillText.push(text),
    moveTo: (...args: number[]) => calls.moveTo.push(args),
  };
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const A = 'a';
const asset = (over: Partial<AudioAsset> = {}): AudioAsset => ({
  assetId: A,
  fileName: 'a.wav',
  durationSeconds: 2,
  sampleRate: 48000,
  channelCount: 1,
  peaks: Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.5 : -0.5)),
  ...over,
});

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 'c',
  assetId: A,
  startSeconds: 10,
  offsetSeconds: 0,
  durationSeconds: 10,
  loop: true,
  ...over,
});

function draw(over: Partial<ClipLaneDrawOptions> = {}, size: [number, number] = [100, 40]) {
  const { canvas, calls } = fakeCanvas(...size);
  drawClipLane(canvas, {
    clips: [clip()],
    assets: { [A]: asset() },
    projectDuration: 40,
    tempo: 1,
    color: '#5EE6A0',
    ...over,
  });
  // Waveform bars are the 1 px wide rects.
  const bars = calls.fillRect.filter((r) => r[2] === 1).map((r) => r[0]!);
  return { canvas, calls, bars };
}

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawClipLane', () => {
  it('sizes the backing store to the element', () => {
    const { canvas } = draw();
    expect([canvas.width, canvas.height]).toEqual([100, 40]);
  });

  it('draws a clip only across the pixels it occupies', () => {
    // 40 s over 100 px: the 10–20 s clip spans x = 25..50, inset 5 px top and bottom.
    const { calls, bars } = draw();
    expect(calls.roundRect).toEqual([[25.5, 5.5, 24, 29, 6]]);
    expect(Math.min(...bars)).toBe(25);
    expect(Math.max(...bars)).toBe(49);
  });

  it('stops a one-shot clip where its source runs out', () => {
    // A 2 s sample in a 10 s one-shot clip fills only the first 2 s = 5 px.
    const { bars } = draw({ clips: [clip({ loop: false })] });
    expect(bars).toEqual([25, 26, 27, 28, 29]);
  });

  it('marks the seams where a looping sample starts over', () => {
    // A 2 s sample looping over 10 s restarts four times.
    const { calls } = draw();
    expect(calls.moveTo).toHaveLength(4);
  });

  it('labels a clip with its sample and length when there is room', () => {
    // 400 × 84 px: the clip is 100 px wide and tall enough for a label band.
    expect(draw({}, [400, 84]).calls.fillText).toEqual(['a.wav', '10s']);
    expect(draw({}).calls.fillText).toEqual([]);
  });

  it('labels clips with no drawable audio', () => {
    expect(draw({ assets: {} }, [400, 84]).calls.fillText).toEqual(['no audio', '10s']);
    expect(
      draw({ assets: { [A]: asset({ missing: true, peaks: [] }) } }, [400, 84]).calls.fillText,
    ).toEqual(['a.wav', 'expired']);
  });

  it('draws the selection over the full lane height', () => {
    const { calls } = draw({ selection: { startSeconds: 20, endSeconds: 24 } });
    expect(calls.fillRect).toContainEqual([50, 0, 10, 40]);
  });

  it('ignores an empty selection and clips outside the project', () => {
    const { calls } = draw({
      clips: [clip({ startSeconds: 50 })],
      selection: { startSeconds: 5, endSeconds: 5 },
    });
    expect(calls.fillRect).toEqual([]);
    expect(calls.roundRect).toEqual([]);
  });

  it('flags clips pushed past the project end instead of hiding them silently', () => {
    const { calls } = draw({ clips: [clip(), clip({ id: 'p1', startSeconds: 41 }), clip({ id: 'p2', startSeconds: 44 })] });
    expect(calls.fillText).toContain('+2 ▸');
  });

  it('draws nothing into a zero-width lane', () => {
    const { canvas, calls } = fakeCanvas(0, 40);
    drawClipLane(canvas, { clips: [clip()], assets: { [A]: asset() }, projectDuration: 40, tempo: 1, color: '#fff' });
    expect(calls.fillRect).toEqual([]);
  });
});
