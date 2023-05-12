[![NPM version](https://img.shields.io/npm/v/rateman?color=%23cb3837&style=flat-square)](https://www.npmjs.com/package/rateman)
[![Repository package.json version](https://img.shields.io/github/package-json/v/vilic/rateman?color=%230969da&label=repo&style=flat-square)](./package.json)
[![MIT license](https://img.shields.io/github/license/vilic/rateman?style=flat-square)](./LICENSE)

# Rateman

Rateman is a redis-based rate limiter with multi-window support.

## Installation

```sh
npm install rateman
```

## Usage

```js
import ms from 'ms';
import {RateLimiter, RateLimitReachedError} from 'rateman';

const rateLimiter = new RateLimiter({
  name: 'user',
  windows: [
    {span: ms('1m'), limit: 10},
    {span: ms('1h'), limit: 100},
  ],
});

try {
  await rateLimiter.throttle('<user id>');
} catch (error) {
  if (error instanceof RateLimitReachedError) {
    console.error('rate limit reached', error.liftsAt);
  } else {
    console.error(error);
  }
}
```

## Redis Connection

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

## Record Throttled

Rateman by default ignores throttled requests. It means that if a request is throttled, it will not have effect on the subsequential requests.

Otherwise you can enable `recordThrottled` to record throttled requests.

```js
const rateLimiter = new RateLimiter({
  // ...
  recordThrottled: true,
});
```

## License

MIT License.
