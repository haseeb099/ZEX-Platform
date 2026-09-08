import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.ZEX_RELEASE_SHA;
  });

  it('returns ok when database and redis succeed', async () => {
    prisma.$queryRaw.mockResolvedValue(1);
    redis.ping.mockResolvedValue('PONG');
    const svc = new HealthService(prisma as never, redis as never);
    const result = await svc.check();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(result.release).toBeNull();
  });

  it('includes non-secret release SHA when configured', async () => {
    process.env.ZEX_RELEASE_SHA = '72e88e95c86a3b5f004d27cf662bbb79146cb87c';
    prisma.$queryRaw.mockResolvedValue(1);
    redis.ping.mockResolvedValue('PONG');
    const svc = new HealthService(prisma as never, redis as never);
    const result = await svc.check();
    expect(result.release).toBe('72e88e95c86a3b5f004d27cf662bbb79146cb87c');
  });

  it('marks unhealthy when redis fails', async () => {
    prisma.$queryRaw.mockResolvedValue(1);
    redis.ping.mockRejectedValue(new Error('down'));
    const svc = new HealthService(prisma as never, redis as never);
    const result = await svc.check();
    expect(result.status).toBe('unhealthy');
    expect(result.checks.redis).toBe('error');
  });
});
