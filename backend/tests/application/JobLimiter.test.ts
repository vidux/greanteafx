import { describe, expect, it } from 'vitest';

import { JobLimiter } from '@/application/JobLimiter';
import { ServerBusyError } from '@/domain/errors';
import { audioContentType } from '@/domain/value-objects/AudioContentType';

/** A job that finishes only when told to, so tests control the timing. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { open, job: () => done };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('JobLimiter', () => {
  it('runs up to the limit at once and queues the rest', async () => {
    const limiter = new JobLimiter(2, 10);
    const gates = [gate(), gate(), gate()];
    const runs = gates.map((g) => limiter.run(g.job));
    await tick();
    expect(limiter.stats).toEqual({ active: 2, queued: 1 });

    gates[0]!.open();
    await tick();
    expect(limiter.stats).toEqual({ active: 2, queued: 0 });

    gates[1]!.open();
    gates[2]!.open();
    await Promise.all(runs);
    expect(limiter.stats).toEqual({ active: 0, queued: 0 });
  });

  it('turns requests away once the queue is full, instead of piling up work', async () => {
    const limiter = new JobLimiter(1, 1);
    const g = gate();
    const first = limiter.run(g.job);
    const second = limiter.run(async () => 'second');
    await expect(limiter.run(async () => 'third')).rejects.toBeInstanceOf(ServerBusyError);
    g.open();
    await first;
    expect(await second).toBe('second');
  });

  it('serves queued jobs in arrival order', async () => {
    const limiter = new JobLimiter(1, 10);
    const g = gate();
    const order: number[] = [];
    const runs = [limiter.run(g.job), ...[1, 2, 3].map((n) => limiter.run(async () => void order.push(n)))];
    g.open();
    await Promise.all(runs);
    expect(order).toEqual([1, 2, 3]);
  });

  it('frees the slot when a job fails, so one bad request cannot jam the queue', async () => {
    const limiter = new JobLimiter(1, 10);
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await limiter.run(async () => 'next')).toBe('next');
    expect(limiter.stats).toEqual({ active: 0, queued: 0 });
  });
});

describe('audioContentType', () => {
  it('keeps well-formed audio types', () => {
    expect(audioContentType('audio/mpeg')).toBe('audio/mpeg');
    expect(audioContentType(' Audio/X-WAV ')).toBe('audio/x-wav');
  });

  it.each(['text/html', 'image/svg+xml', 'application/javascript', 'audio/', 'audio/wav; x=<script>', '', null, undefined])(
    'turns %j into an opaque download',
    (claimed) => {
      expect(audioContentType(claimed)).toBe('application/octet-stream');
    },
  );
});
