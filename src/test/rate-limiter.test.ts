import {setTimeout} from 'timers/promises';

import Redis from 'ioredis';

import {RateLimiter} from 'rateman';

const {REDIS_HOST, REDIS_PORT} = process.env;

const redis = new Redis({
  host: REDIS_HOST,
  port: Number(REDIS_PORT) || undefined,
});

class TestRateLimiter extends RateLimiter {
  override getKeyPrefix(): string {
    return 'rateman-test';
  }
}

beforeAll(async () => {
  await cleanUpRedis(redis);
});

test('single window', async () => {
  const rateLimiter = new TestRateLimiter({
    name: 'single-window',
    window: {span: 200, limit: 3},
    redis,
  });

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
  const rateLimiter = new TestRateLimiter({
    name: 'multiple-windows',
    windows: [
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
  });

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

test('record throttled', async () => {
  const rateLimiter = new TestRateLimiter({
    name: 'record-throttled',
    window: {span: 200, limit: 3},
    recordThrottled: true,
    redis,
  });

  for (let i = 0; i < 3; i++) {
    await rateLimiter.limit('foo');
    await setTimeout(50);
  }

  for (let i = 0; i < 3; i++) {
    await expect(() =>
      rateLimiter.limit('foo'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Rate limit "record-throttled" reached for identifier "foo"."`,
    );
    await setTimeout(50);
  }

  await setTimeout(100);

  await rateLimiter.limit('foo');
  await rateLimiter.limit('foo');

  await expect(() =>
    rateLimiter.limit('foo'),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Rate limit "record-throttled" reached for identifier "foo"."`,
  );
});

test('invalid windows', () => {
  expect(
    () =>
      new TestRateLimiter({
        name: 'invalid-windows',
        windows: [
          {span: 100, limit: 3},
          {span: 200, limit: 1},
        ],
        redis,
      }),
  ).toThrowErrorMatchingInlineSnapshot(
    `"It is required for window with greater \`span\` to have greater \`limit\`."`,
  );

  expect(
    () =>
      new TestRateLimiter({
        name: 'invalid-windows',
        windows: [
          {span: 200, limit: 1},
          {span: 100, limit: 3},
        ],
        redis,
      }),
  ).toThrowErrorMatchingInlineSnapshot(
    `"It is required for window with greater \`span\` to have greater \`limit\`."`,
  );

  expect(
    () =>
      new TestRateLimiter({
        name: 'invalid-windows',
        windows: [
          {span: 100, limit: 3},
          {span: 200, limit: 8},
        ],
        redis,
      }),
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
