import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRedisClient, REDIS_CLIENT } from './redis.config';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          return createRedisClient(redisUrl);
        }
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        return createRedisClient(host, port);
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
