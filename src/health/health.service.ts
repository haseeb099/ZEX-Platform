import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@src/common/common.module';
import { PrismaService } from '@src/common/prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check() {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
    };
    const status = Object.values(checks).every(c => c === 'ok') ? 'ok' : 'unhealthy';
    return {
      status,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<string> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkRedis(): Promise<string> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
