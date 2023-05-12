import {randomBytes} from 'crypto';

import type {Redis} from 'ioredis';

import {RateLimitReachedError} from './errors';

export interface RateLimitWindow {
  span: number;
  limit: number;
}

export class RateLimiter<TIdentifier = string> {
  private windows: RateLimitWindow[];

  private maxWindowSpan: number;

  constructor(
    readonly name: string,
    windows: RateLimitWindow | [RateLimitWindow, ...RateLimitWindow[]],
    private redis: Redis,
  ) {
    windows = Array.isArray(windows) ? windows : [windows];

    windows.sort((a, b) => a.span - b.span);

    windows.reduce(
      ([previousLimit, previousRate], {span, limit}) => {
        if (previousLimit >= limit) {
          throw new Error(
            'It is required for window with greater `span` to have greater `limit`.',
          );
        }

        const rate = limit / span;

        if (rate >= previousRate) {
          throw new Error(
            'Narrower window with equal or greater `limit / span` rate than wider ones is useless.',
          );
        }

        return [limit, rate];
      },
      [0, Infinity],
    );

    this.windows = windows;
    this.maxWindowSpan = windows[windows.length - 1].span;
  }

  /**
   * @returns A timestamp when the rate limit will be lifted, or `undefined` if
   */
  async hit(identifier: TIdentifier): Promise<number | undefined> {
    const {redis} = this;

    const key = this.getKey(identifier);

    const now = Date.now();
    const mostDistantRelevantSince = now - this.maxWindowSpan;

    const score = now.toString();

    const record = `${now}#${randomBytes(4).toString('hex')}`;

    const [, [, records]] = (await redis
      .multi()
      // Remove records that are older than `mostDistantRelevantSince`.
      .zremrangebyscore(key, 0, mostDistantRelevantSince)
      // Get remaining records.
      .zrange(key, 0, -1)
      // Add new record.
      .zadd(key, score, record)
      .exec()) as [[], [null, string[]]];

    // `timestamps` are sorted descending, and essentially represent timestamps
    // of previous records.
    const timestamps = records
      .map(record => Number(record.split('#')[0]))
      .reverse();

    const all = timestamps.length;

    let timestampIndex = 0;

    for (const {span, limit} of this.windows) {
      if (all < limit) {
        // Even if all records are relevant, the limit is not reached. And it
        // would certainly be the case for next windows as the limit would be
        // greater.
        return undefined;
      }

      // `windows` are sorted by `span` ascending, thus `relevantSince` would
      // always be smaller (older) than of the previous window.
      const relevantSince = now - span;

      // By first, it means first in the descending sequence.
      const firstRelativeIrrelevantIndex = timestamps
        .slice(timestampIndex)
        .findIndex(timestamp => timestamp < relevantSince);

      const relevant =
        firstRelativeIrrelevantIndex < 0
          ? all
          : firstRelativeIrrelevantIndex + timestampIndex;

      // Reaches the limit of current window.
      if (relevant >= limit) {
        // If the current window is already full, remove the new record.
        await redis.zrem(key, record);

        // `timestamps[0]` would be the latest relevant timestamp.
        return timestamps[0] + span;
      }

      // Impossible to reach here if all records are relevant and the limit is
      // not reached. So the code below is not needed:

      // if (relevant === all) {
      //   return undefined;
      // }

      // As we noted, the next `relevantSince` would be smaller (older), thus
      // `timestamps[relevant - 1]` (which is greater than
      // `timestamps[relevant]`) would certainly be greater than the next
      // `relevantSince`. So timestamps before the current `relevant` can be
      // safely skipped for finding the next `relevant`.
      timestampIndex = relevant;
    }

    // As records before `mostDistantRelevantSince` are removed, it is
    // impossible to reach here.

    /* istanbul ignore next */
    return undefined;
  }

  async limit(identifier: TIdentifier): Promise<void> {
    const liftsAtTimestamp = await this.hit(identifier);

    if (liftsAtTimestamp === undefined) {
      return;
    }

    throw new RateLimitReachedError(
      `Rate limit ${JSON.stringify(
        this.name,
      )} reached for identifier ${JSON.stringify(
        this.stringifyIdentifier(identifier),
      )}.`,
      new Date(liftsAtTimestamp),
    );
  }

  async clear(identifier: TIdentifier): Promise<void> {
    const key = this.getKey(identifier);

    await this.redis.del(key);
  }

  protected getKey(identifier: TIdentifier): string {
    return `${this.getKeyPrefix()}:${this.name}:${this.stringifyIdentifier(
      identifier,
    )}`;
  }

  /* istanbul ignore next */
  protected getKeyPrefix(): string {
    return 'rateman';
  }

  protected stringifyIdentifier(identifier: TIdentifier): string {
    return String(identifier);
  }
}
