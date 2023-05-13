import {randomBytes} from 'crypto';
import {setTimeout} from 'timers/promises';

import type {RedisOptions} from 'ioredis';
import {Redis} from 'ioredis';

import {isPlainObject} from './@utils';
import {RateLimitExceededError} from './errors';

export interface RateLimitWindow {
  span: number;
  limit: number;
}

export type RateLimitWindows = [RateLimitWindow, ...RateLimitWindow[]];

export type RateLimiterOptions = {
  name: string;
  recordThrottled?: boolean;
  redis?: RedisOptions | Redis;
} & ({window: RateLimitWindow} | {windows: RateLimitWindows});

export class RateLimiter<TIdentifier = string> {
  readonly name: string;

  readonly windows: RateLimitWindow[];
  readonly minWindowLimit: number;
  readonly maxWindowSpan: number;

  readonly recordThrottled: boolean;

  readonly redis: Redis;

  constructor({
    name,
    recordThrottled = false,
    redis,
    ...rest
  }: RateLimiterOptions) {
    this.name = name;

    const windows = 'windows' in rest ? rest.windows : [rest.window];

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
    this.minWindowLimit = windows[0].limit;
    this.maxWindowSpan = windows[windows.length - 1].span;

    this.recordThrottled = recordThrottled;

    this.redis = redis
      ? (isPlainObject as (value: unknown) => value is RedisOptions)(redis)
        ? new Redis(redis)
        : redis
      : /* istanbul ignore next */ new Redis();
  }

  /**
   * Record a new attempt, throw if rate limit exceeded.
   */
  async attempt(
    identifier: TIdentifier,
    options?: number | RecordOptions,
  ): Promise<void> {
    const liftsAt = await this.record(identifier, options);

    if (liftsAt === undefined) {
      return;
    }

    throw new RateLimitExceededError(
      `Rate limit ${JSON.stringify(
        this.name,
      )} exceeded for identifier ${JSON.stringify(
        this.stringifyIdentifier(identifier),
      )}.`,
      liftsAt,
    );
  }

  /**
   * Record a new attempt, but wait until rate limit is lifted if reached.
   */
  async throttle(
    identifier: TIdentifier,
    options?: number | ThrottleOptions,
  ): Promise<void> {
    const recordOptions: RecordOptions = {
      ...(typeof options === 'number' ? {multiplier: options} : options),
      recordThrottledOverride: false,
    };

    while (true) {
      const liftsAt = await this.record(identifier, recordOptions);

      if (liftsAt === undefined) {
        return;
      }

      const delay = liftsAt - Date.now();

      /* istanbul ignore next */
      if (delay <= 0) {
        // Being cautious here.
        return;
      }

      await setTimeout(delay);
    }
  }

  /**
   * Record a new attempt.
   *
   * @returns `undefined` if rate limit is not exceeded, otherwise the timestamp
   * in milliseconds.
   */
  async record(
    identifier: TIdentifier,
    options: number | RecordOptions = {},
  ): Promise<number | undefined> {
    if (typeof options === 'number') {
      options = {multiplier: options};
    }

    const {multiplier = 1, recordThrottledOverride} = options;

    const {redis, windows, minWindowLimit, maxWindowSpan, recordThrottled} =
      this;

    if (multiplier <= 0) {
      throw new Error('Option `multiplier` must be greater than zero.');
    }

    if (multiplier > minWindowLimit) {
      throw new Error(
        'Option `multiplier` cannot be greater than the minimum window limit.',
      );
    }

    if (!Number.isInteger(multiplier)) {
      throw new Error('Option `multiplier` must be an integer.');
    }

    const key = this.getKey(identifier);

    const now = Date.now();
    const mostDistantRelevantSince = now - maxWindowSpan;

    const score = now.toString();

    const record = `${now}#${multiplier}#${randomBytes(4).toString('hex')}`;

    const [, , [, records]] = (await redis
      .multi()
      // Remove records that are older than `mostDistantRelevantSince`.
      .zremrangebyscore(key, 0, mostDistantRelevantSince)
      // Add new record.
      .zadd(key, score, record)
      // Get remaining records.
      .zrange(key, 0, -1)
      .exec()) as [unknown, unknown, [null, string[]]];

    // `timestamps` are sorted descending, and essentially represent timestamps
    // of previous records.
    const timestamps = records
      .flatMap(record => {
        const [timestamp, multiplier] = record.split('#');
        return new Array(Number(multiplier)).fill(Number(timestamp));
      })
      .reverse();

    const all = timestamps.length;

    let timestampIndex = 0;

    for (const {span, limit} of windows) {
      if (all <= limit) {
        // Even if all records are relevant, the limit is not exceeded. And it
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

      // Exceeds the limit of current window.
      if (relevant > limit) {
        if (!(recordThrottledOverride ?? recordThrottled)) {
          await redis.zrem(key, record);
        }

        // Assuming `multiplier` is 2, `limit` is 4, and we have 3 relevant
        // attempts before.

        // [n1, n2, r1, r2, r3, ...]

        // What we need now is waiting r3 to become irrelevant so we can fit in
        // n1 and n2 together. And the index of r3 is simply `limit`.

        return timestamps[limit] + span;
      }

      // Impossible to reach here if all records are relevant and the limit is
      // not exceeded. So the code below is not needed:

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

  async reset(identifier: TIdentifier): Promise<void> {
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

export interface RecordOptions {
  multiplier?: number;
  recordThrottledOverride?: boolean;
}

export type ThrottleOptions = Omit<RecordOptions, 'recordThrottledOverride'>;
