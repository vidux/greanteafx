import { ServerBusyError } from '@/domain/errors';

/**
 * Caps how many heavy jobs (decodes, renders) run at once, so a burst from one user cannot
 * exhaust memory and take the service down for everyone. Extra jobs wait in a bounded FIFO
 * queue; past that, callers get {@link ServerBusyError} and are told to retry.
 */
export class JobLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number,
  ) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active < this.maxActive) {
      this.active += 1;
    } else {
      if (this.waiting.length >= this.maxQueued) throw new ServerBusyError();
      // The finishing job hands its slot straight to us, so `active` is not incremented here.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiting.length };
  }
}
