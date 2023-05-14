import {RateLimitExceededError} from '../library';

import {redis} from './@redis';
import {TestRateLimiter} from './@test-rate-limiter';

void (async () => {
  try {
    await test({limit: 1_000, segmentLimit: 100, multiplier: 1});
    await test({limit: 100_000, segmentLimit: 10_000, multiplier: 100});
    await test({limit: 50_000, segmentLimit: 10_000, multiplier: 1});
  } catch (error) {
    await TestRateLimiter.cleanUp(redis, true);
    throw error;
  }
})();

interface TestOptions {
  limit: number;
  segmentLimit: number;
  multiplier: number;
}

async function test({
  limit,
  segmentLimit,
  multiplier,
}: TestOptions): Promise<void> {
  const segments = limit / segmentLimit;
  const segmentAttempts = segmentLimit / multiplier;

  const rateLimiter = new TestRateLimiter({
    name: 'performance',
    window: {span: 3600_000, limit},
    redis,
  });

  const identifier = 'awesome-identifier';

  await rateLimiter.reset(identifier);

  for (let segment = 0; segment < segments; segment++) {
    const startedAt = performance.now();

    for (let attempt = 0; attempt < segmentAttempts; attempt++) {
      await rateLimiter.attempt(identifier, multiplier);
    }

    const duration = performance.now() - startedAt;

    console.info(
      `${(segment * segmentLimit).toLocaleString()}-${(
        (segment + 1) *
        segmentLimit
      ).toLocaleString()}: ${duration.toFixed(3)}ms in total / ${(
        duration / segmentAttempts
      ).toFixed(3)}ms per attempt (with multiplier ${multiplier}).`,
    );
  }

  await rateLimiter.attempt(identifier).then(
    async () => {
      throw new Error('Expected rate limit to be exceeded.');
    },
    async error => {
      if (error instanceof RateLimitExceededError) {
        return;
      }

      throw error;
    },
  );
}
