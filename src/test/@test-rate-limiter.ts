import type Redis from 'ioredis';

import {RateLimiter} from '../library';

const TEST_KEY_PREFIX = 'rateman-test';

export class TestRateLimiter extends RateLimiter {
  override getKeyPrefix(): string {
    return TEST_KEY_PREFIX;
  }

  static async cleanUp(redis: Redis, quit = false): Promise<void> {
    await redis.eval(
      `\
for _, key in ipairs(redis.call('keys', '${TEST_KEY_PREFIX}:*')) do
  redis.call('del', key)
end
`,
      0,
    );

    if (quit) {
      await redis.quit();
    }
  }
}
