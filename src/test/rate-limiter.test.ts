import {setTimeout} from 'timers/promises';

import Redis from 'ioredis';

import {RateLimiter} from 'rateman';

const redis = new Redis();

class TestRateLimiter extends RateLimiter {
  override getKeyPrefix(): string {
    return 'rateman-test';
  }
}

beforeAll(async () => cleanUpRedis(redis));

test('single window', async () => {
  const rateLimiter = new TestRateLimiter(
    'single-window',
    {span: 200, limit: 3},
    redis,
  );

  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');

  await rateLimiter.limit('bar');
  await rateLimiter.limit('bar');

  await expect(() =>
    rateLimiter.limit('foo'),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Rate limit "single-window" reached for identifier "foo"."`,
  );

  await setTimeout(200);

  await rateLimiter.limit('foo');
  await setTimeout(20);
  await rateLimiter.limit('foo');
  await setTimeout(20);
  await rateLimiter.limit('foo');
  await setTimeout(20);

  await rateLimiter.limit('bar');
  await rateLimiter.limit('bar');

  await expect(() =>
    rateLimiter.limit('foo'),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Rate limit "single-window" reached for identifier "foo"."`,
  );
});

test('multiple windows', async () => {
  const rateLimiter = new TestRateLimiter(
    'multiple-windows',
    [
      {
        span: 200,
        limit: 3,
      },
      {
        span: 400,
        limit: 5,
      },
    ],
    redis,
  );

  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');

  await expect(() =>
    rateLimiter.limit('foo'),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Rate limit "multiple-windows" reached for identifier "foo"."`,
  );

  await setTimeout(200);

  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');

  await expect(() =>
    rateLimiter.limit('foo'),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Rate limit "multiple-windows" reached for identifier "foo"."`,
  );

  await rateLimiter.clear('foo');

  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');

  await expect(() =>
    rateLimiter.limit('foo'),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Rate limit "multiple-windows" reached for identifier "foo"."`,
  );
});

test('invalid windows', () => {
  expect(
    () =>
      new TestRateLimiter(
        'invalid-windows',
        [
          {span: 100, limit: 3},
          {span: 200, limit: 1},
        ],

        redis,
      ),
  ).toThrowErrorMatchingInlineSnapshot(
    `"It is required for window with greater \`span\` to have greater \`limit\`."`,
  );

  expect(
    () =>
      new TestRateLimiter(
        'invalid-windows',
        [
          {span: 200, limit: 1},
          {span: 100, limit: 3},
        ],

        redis,
      ),
  ).toThrowErrorMatchingInlineSnapshot(
    `"It is required for window with greater \`span\` to have greater \`limit\`."`,
  );

  expect(
    () =>
      new TestRateLimiter(
        'invalid-windows',
        [
          {span: 100, limit: 3},
          {span: 200, limit: 8},
        ],

        redis,
      ),
  ).toThrowErrorMatchingInlineSnapshot(
    `"Narrower window with equal or greater \`limit / span\` rate than wider ones is useless."`,
  );
});

afterAll(async () => {
  await cleanUpRedis(redis);

  await redis.quit();
});

async function cleanUpRedis(redis: Redis): Promise<void> {
  await redis.eval(
    `\
for _, key in ipairs(redis.call('keys', 'rateman:*')) do
  redis.call('del', key)
end
`,
    0,
  );
}
