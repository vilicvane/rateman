import {randomBytes} from 'crypto';

import type {RedisOptions} from 'ioredis';
import {Redis} from 'ioredis';

import {isPlainObject} from './@utils';
import {RateLimitReachedError} from './errors';

export interface RateLimitWindow {
  span: number;
  limit: number;
}

export type RateLimiterOptions = {
  name: string;
  recordThrottled?: boolean;
  redis?: RedisOptions | Redis;
} & (
  | {window: RateLimitWindow}
  | {windows: [RateLimitWindow, ...RateLimitWindow[]]}
);

export class RateLimiter<TIdentifier = string> {
  readonly name: string;

  readonly windows: RateLimitWindow[];
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
    this.maxWindowSpan = windows[windows.length - 1].span;

    this.recordThrottled = recordThrottled;

    this.redis = redis
      ? (isPlainObject as (value: unknown) => value is RedisOptions)(redis)
        ? new Redis(redis)
        : redis
      : /* istanbul ignore next */ new Redis();
  }

  async throttle(identifier: TIdentifier): Promise<void> {
    const {redis, windows, maxWindowSpan, recordThrottled} = this;

    const key = this.getKey(identifier);

    const now = Date.now();
    const mostDistantRelevantSince = now - maxWindowSpan;

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

    for (const {span, limit} of windows) {
      if (all < limit) {
        // Even if all records are relevant, the limit is not reached. And it
        // would certainly be the case for next windows as the limit would be
        // greater.
        return;
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
        if (!recordThrottled) {
          await redis.zrem(key, record);
        }

        throw new RateLimitReachedError(
          `Rate limit ${JSON.stringify(
            this.name,
          )} reached for identifier ${JSON.stringify(
            this.stringifyIdentifier(identifier),
          )}.`,
          timestamps[relevant - 1] + span,
        );
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
