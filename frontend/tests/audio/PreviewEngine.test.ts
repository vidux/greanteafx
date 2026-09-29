import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewEngine } from '@/audio/PreviewEngine';
import { createInitialTracks } from '@/store/projectStore';
import type { Clip, Track } from '@/domain/types';

/*
 * A minimal stand-in for the Web Audio API that records what the engine schedules. Node has no
 * AudioContext, and the engine's behaviour is entirely in *when* it starts and stops sources.
 */
class Param {
  value = 0;
}

class Node {
  connect(): void {}
  disconnect(): void {}
}

class Source extends Node {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  when = Number.NaN;
  offset = Number.NaN;
  stopAt = Number.NaN;
  cancelled = false;
  start(when: number, offset: number): void {
    this.when = when;
    this.offset = offset;
  }
  stop(when?: number): void {
    if (when === undefined) this.cancelled = true;
    else this.stopAt = when;
  }
}

class Gain extends Node {
  gain = new Param();
}

class Panner extends Node {
  positionX = new Param();
  positionY = new Param();
  positionZ = new Param();
  constructor(_ctx: unknown, options: { positionX: number; positionY: number; positionZ: number }) {
    super();
    this.positionX.value = options.positionX;
    this.positionY.value = options.positionY;
    this.positionZ.value = options.positionZ;
  }
}

const BUFFER_SECONDS = 2;

class FakeContext {
  currentTime = 100;
  sampleRate = 48000;
  state = 'running';
  destination = new Node();
  listener = Object.fromEntries(
    ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(
      (k) => [k, new Param()],
    ),
  );
  sources: Source[] = [];
  gains: Gain[] = [];
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createConvolver() {
    return Object.assign(new Node(), { buffer: null });
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource(): Source {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData() {
    return { duration: BUFFER_SECONDS };
  }
  async resume() {}
}

const ASSET = 'asset-1';
let ctx: FakeContext;
let engine: PreviewEngine;

beforeEach(async () => {
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('PannerNode', Panner);
  engine = new PreviewEngine();
  ctx = engine.ensureContext() as unknown as FakeContext;
  await engine.loadAsset(ASSET, new ArrayBuffer(8));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const live = () => ctx.sources.filter((s) => !s.cancelled);

function lane(clips: Partial<Clip>[], over: Partial<Track> = {}): Track[] {
  const tracks = createInitialTracks();
  tracks[0] = {
    ...tracks[0]!,
    clips: clips.map((c, i) => ({
      id: `c${i}`,
      assetId: ASSET,
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: 4,
      loop: false,
      ...c,
    })),
    ...over,
  };
  return tracks;
}

describe('scheduling', () => {
  it('queues the current pass and one repeat ahead', () => {
    engine.start(lane([{}]), 10);
    expect(live().map((s) => [s.when, s.offset, s.stopAt])).toEqual([
      [100, 0, 104],
      [110, 0, 114],
    ]);
  });

  it('still schedules a muted track, so unmuting mid-playback is heard at once', () => {
    const tracks = lane([{}], { muted: true });
    engine.syncTracks(tracks);
    engine.start(tracks, 10);
    expect(live()).toHaveLength(2);
    expect(ctx.gains.at(-1)!.gain.value).toBe(0);
  });

  it('does not schedule an inactive track', () => {
    engine.start(lane([{}], { active: false }), 10);
    expect(live()).toHaveLength(0);
  });

  it('skips clips whose sample is not loaded', () => {
    engine.start(lane([{ assetId: 'not-loaded' }]), 10);
    expect(live()).toHaveLength(0);
  });

  it('enters a clip mid-way at the matching source offset after a seek', () => {
    const tracks = lane([{ durationSeconds: 4 }]);
    engine.start(tracks, 10);
    engine.seek(1, tracks, 10);
    expect(live()[0]).toMatchObject({ when: 100, offset: 1, stopAt: 103 });
  });

  it('wraps the offset of a looping clip and honours tempo', () => {
    const tracks = lane([{ durationSeconds: 8, loop: true }], { tempo: 2 });
    engine.start(tracks, 10);
    engine.seek(1.5, tracks, 10);
    // 1.5 s at 2x is 3 s into a 2 s buffer.
    expect(live()[0]!.offset).toBeCloseTo(1);
  });

  it('skips a one-shot clip whose source has already run out', () => {
    const tracks = lane([{ durationSeconds: 8, loop: false }]);
    engine.start(tracks, 10);
    engine.seek(3, tracks, 10);
    // 3 s into a 2 s one-shot: only the repeat pass is queued.
    expect(live()).toHaveLength(1);
    expect(live()[0]!.when).toBe(107);
  });
});

describe('looping the project', () => {
  it('appends one pass when the project really wraps', () => {
    const tracks = lane([{}]);
    engine.start(tracks, 10);
    ctx.currentTime = 110.02;
    engine.onProjectWrapped(tracks, 10);
    expect(live().map((s) => s.when)).toEqual([100, 110, 120]);
  });

  it('does not pile up passes after a backward seek', () => {
    const tracks = lane([{}]);
    engine.start(tracks, 10);
    ctx.currentTime = 105;
    engine.seek(1, tracks, 10);
    const queued = live().length;
    engine.onProjectWrapped(tracks, 10);
    expect(live()).toHaveLength(queued);
  });

  it('resynchronises instead of catching up after a long stall', () => {
    const tracks = lane([{}]);
    engine.start(tracks, 10);
    ctx.currentTime = 200;
    engine.onProjectWrapped(tracks, 10);
    expect(Math.min(...live().map((s) => s.stopAt))).toBeGreaterThan(200);
  });
});

describe('transport', () => {
  it('reports position while playing and holds it when stopped', () => {
    const tracks = lane([{}]);
    engine.start(tracks, 10);
    ctx.currentTime = 103;
    expect(engine.transportTime(10)).toBeCloseTo(3);
    engine.stop(10);
    ctx.currentTime = 150;
    expect(engine.transportTime(10)).toBeCloseTo(3);
    expect(engine.isPlaying).toBe(false);
    expect(live()).toHaveLength(0);
  });

  it('wraps the position to the project length', () => {
    engine.start(lane([{}]), 10);
    ctx.currentTime = 123;
    expect(engine.transportTime(10)).toBeCloseTo(3);
  });

  it('resumes from where it stopped', () => {
    const tracks = lane([{ durationSeconds: 8, loop: true }]);
    engine.seek(5, tracks, 10);
    engine.start(tracks, 10);
    expect(live()[0]).toMatchObject({ when: 100, offset: 1 });
  });

  it('rescheduling does nothing while stopped', () => {
    engine.reschedule(lane([{}]), 10);
    expect(ctx.sources).toHaveLength(0);
  });
});

describe('mix and motion', () => {
  it('silences muted and inactive tracks through their gain', () => {
    const tracks = lane([{}], { muted: true });
    tracks[1] = { ...tracks[1]!, volume: 0.5 };
    engine.syncTracks(tracks);
    // The first two gains are the master bus and the reverb send; track gains follow in order.
    const gains = ctx.gains.slice(2).map((g) => g.gain.value);
    expect(gains[0]).toBe(0);
    expect(gains[1]).toBe(0.5);
    expect(gains[5]).toBe(0);
  });

  it('silences every track but the soloed ones while a solo is on', () => {
    const tracks = lane([{}], { soloed: true });
    engine.syncTracks(tracks);
    const gains = ctx.gains.slice(2).map((g) => g.gain.value);
    expect(gains[0]).toBe(0.8);
    expect(gains[1]).toBe(0);

    tracks[0] = { ...tracks[0]!, soloed: false };
    engine.syncTracks(tracks);
    expect(ctx.gains.slice(2).map((g) => g.gain.value)[1]).toBe(0.8);
  });

  it('moves an automated source along its path from transport time', () => {
    const tracks = lane([{}], {
      motionMode: 'path',
      pathLoopSec: 4,
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    });
    engine.syncTracks(tracks);
    engine.seek(1, tracks, 10);
    const live = engine.tick(tracks, 10);
    expect(live.get('ch-0')!.x).toBeCloseTo(2);
  });

  it('applies master volume set before the context existed', () => {
    const fresh = new PreviewEngine();
    fresh.setMasterVolume(0.3);
    const freshCtx = fresh.ensureContext() as unknown as FakeContext;
    expect(freshCtx.gains[0]!.gain.value).toBe(0.3);
  });
});
