import Redis from 'ioredis';

const {REDIS_HOST, REDIS_PORT} = process.env;

export const REDIS_OPTIONS = {
  host: REDIS_HOST,
  port: Number(REDIS_PORT) || undefined,
};

export const redis = new Redis(REDIS_OPTIONS);
