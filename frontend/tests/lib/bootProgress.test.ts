import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAP,
  FLOOR,
  MIN_PER_SECOND,
  liftToStage,
  scaleXFromTransform,
  trickle,
} from '@/lib/bootProgress';

/** Runs the trickle for `seconds` in 50 ms steps, as the component's interval does. */
function simulate(from: number, seconds: number): number {
  let p = from;
  for (let t = 0; t < seconds; t += 0.05) p = trickle(p, 0.05);
  return p;
}

describe('trickle', () => {
  it('moves the bar forward on every tick until the cap', () => {
    let p = FLOOR.fetching;
    for (let i = 0; i < 400; i++) {
      const next = trickle(p, 0.05);
      if (p < CAP) expect(next).toBeGreaterThan(p);
      p = next;
    }
  });

  it('never crawls slower than the minimum speed, so it never looks frozen', () => {
    const p = 0.93;
    expect(trickle(p, 1) - p).toBeCloseTo(MIN_PER_SECOND, 10);
  });

  it('never passes the cap', () => {
    expect(simulate(FLOOR.fetching, 120)).toBe(CAP);
    expect(trickle(CAP, 10)).toBe(CAP);
  });

  it('ignores a negative time step', () => {
    expect(trickle(0.4, -1)).toBe(0.4);
  });

  it('keeps visibly moving through the first ten seconds', () => {
    let p = FLOOR.fetching;
    for (let second = 0; second < 10; second++) {
      const next = simulate(p, 1);
      expect(next - p).toBeGreaterThan(0.01);
      p = next;
    }
  });
});

describe('liftToStage', () => {
  it('raises the bar to a milestone floor but never lowers it', () => {
    expect(liftToStage(0.2, 'starting')).toBe(FLOOR.starting);
    expect(liftToStage(0.8, 'starting')).toBe(0.8);
    expect(liftToStage(0.3, 'ready')).toBe(1);
  });
});

describe('scaleXFromTransform', () => {
  it('reads scaleX from a computed matrix', () => {
    expect(scaleXFromTransform('matrix(0.42, 0, 0, 1, 0, 0)')).toBe(0.42);
  });

  it('returns null when there is no transform', () => {
    expect(scaleXFromTransform('none')).toBeNull();
    expect(scaleXFromTransform('')).toBeNull();
  });
});

describe('CSS pre-hydration keyframes', () => {
  // The bar runs on CSS before React hydrates, then JS continues from the same curve. A drift
  // between the two would make the bar visibly jump at hydration.
  const css = readFileSync(path.resolve(__dirname, '../../src/app/globals.css'), 'utf8');
  const block = /@keyframes boot-trickle \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const duration = Number(/\.css-trickle \{\s*animation: boot-trickle ([\d.]+)s/.exec(css)?.[1]);
  const stops = [...block.matchAll(/([\d.]+)% \{ transform: scaleX\(([\d.]+)\); \}/g)].map(
    (m) => ({ at: (Number(m[1]) / 100) * duration, scale: Number(m[2]) }),
  );

  it('are present', () => {
    expect(duration).toBeGreaterThan(0);
    expect(stops.length).toBeGreaterThan(5);
  });

  it('follow the JS trickle curve', () => {
    for (const stop of stops) {
      expect(Math.abs(simulate(FLOOR.fetching, stop.at) - stop.scale)).toBeLessThan(0.01);
    }
  });
});
