import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

const logger = new Logger('RedisConfig');

export const createRedisClient = (
  host: string = 'localhost',
  port: number = 6379,
): Redis => {
  const client = new Redis({
    host,
    port,
    maxRetriesPerRequest: null, // Required for BullMQ
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  client.on('connect', () => {
    logger.log('Redis connection established');
  });

  client.on('error', (err: Error) => {
    logger.error(`Redis connection error: ${err.message}`);
  });

  return client;
};

export const REDIS_CLIENT = 'REDIS_CLIENT';
