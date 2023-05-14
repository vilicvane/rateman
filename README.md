[![NPM version](https://img.shields.io/npm/v/rateman?color=d53a3b&style=flat-square)](https://www.npmjs.com/package/rateman)
[![Coverage](https://img.shields.io/badge/coverage-100%25-green?style=flat-square)](https://github.com/vilic/rateman/actions/workflows/ci.yml)

# Rateman

Rateman is a redis-based rate limiter with multi-window support.

## Installation

```sh
npm install rateman
```

## Usage

```js
import ms from 'ms';
import {RateLimiter, RateLimitExceededError} from 'rateman';

const rateLimiter = new RateLimiter({
  name: 'user',
  windows: [
    {span: ms('1m'), limit: 10},
    {span: ms('1h'), limit: 100},
  ],
});

try {
  await rateLimiter.attempt('<user id>');
} catch (error) {
  if (error instanceof RateLimitExceededError) {
    console.error('rate limit exceeded', error.liftsAt);
  } else {
    console.error(error);
  }
}
```

## Methods

### Attempts

Rateman provides three methods that record attempts: `attempt()`, `throttle()` and the under the hood `record()`.

You can also use the `multiplier` option to record multiple attempts at once:

```js
await rateLimiter.attempt('<user id>', 3);
```

### Reset

Use `reset()` to reset the limit for an identifier.

## Express

Using Rateman with [Express](https://github.com/expressjs/express) is easy:

```js
app.use((req, _res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.ip;

  void rateLimiter.attempt(ip).then(
    () => next(),
    error => next(error),
  );
});
```

## Options

### Redis Connection

Rateman uses [ioredis](https://github.com/luin/ioredis) for redis connection.

Provide a `Redis` instance or `RedisOptions` for connection other than `localhost:6379`.

```js
import Redis from 'ioredis';

const rateLimiterA = new RateLimiter({
  // ...
  redis: new Redis(),
});

const rateLimiterA = new RateLimiter({
  // ...
  redis: {
    host: 'localhost',
    port: 6379,
  },
});
```

### Record Throttled

Rateman by default ignores throttled attempts. It means that if an attempt is throttled, it will not have effect on the subsequential attempts.

Otherwise you can enable `recordThrottled` to record throttled attempts.

```js
const rateLimiter = new RateLimiter({
  // ...
  recordThrottled: true,
});
```

## Performance

Tested on WSL2 / Redis (local, Docker) with i9 13900K.

### 0-1,000 attempts with up to 1,000 records.

```
0-100: 22.570ms in total / 0.226ms per attempt (with multiplier 1).
100-200: 29.027ms in total / 0.290ms per attempt (with multiplier 1).
200-300: 30.777ms in total / 0.308ms per attempt (with multiplier 1).
300-400: 33.582ms in total / 0.336ms per attempt (with multiplier 1).
400-500: 39.601ms in total / 0.396ms per attempt (with multiplier 1).
500-600: 42.859ms in total / 0.429ms per attempt (with multiplier 1).
600-700: 48.280ms in total / 0.483ms per attempt (with multiplier 1).
700-800: 50.846ms in total / 0.508ms per attempt (with multiplier 1).
800-900: 57.854ms in total / 0.579ms per attempt (with multiplier 1).
900-1,000: 63.314ms in total / 0.633ms per attempt (with multiplier 1).
```

### 0-100,000 attempts with up to 1,000 records.

```
0-10,000: 68.204ms in total / 0.682ms per attempt (with multiplier 100).
10,000-20,000: 157.541ms in total / 1.575ms per attempt (with multiplier 100).
20,000-30,000: 249.387ms in total / 2.494ms per attempt (with multiplier 100).
30,000-40,000: 348.766ms in total / 3.488ms per attempt (with multiplier 100).
40,000-50,000: 438.351ms in total / 4.384ms per attempt (with multiplier 100).
50,000-60,000: 540.998ms in total / 5.410ms per attempt (with multiplier 100).
60,000-70,000: 622.636ms in total / 6.226ms per attempt (with multiplier 100).
70,000-80,000: 715.999ms in total / 7.160ms per attempt (with multiplier 100).
80,000-90,000: 820.891ms in total / 8.209ms per attempt (with multiplier 100).
90,000-100,000: 902.005ms in total / 9.020ms per attempt (with multiplier 100).
```

### 0-50,000 attempts with up to 50,000 records.

```
0-10,000: 24943.718ms in total / 2.494ms per attempt (with multiplier 1).
10,000-20,000: 72074.504ms in total / 7.207ms per attempt (with multiplier 1).
20,000-30,000: 120660.886ms in total / 12.066ms per attempt (with multiplier 1).
30,000-40,000: 165407.125ms in total / 16.541ms per attempt (with multiplier 1).
40,000-50,000: 219170.968ms in total / 21.917ms per attempt (with multiplier 1).
```

## License

MIT License.
