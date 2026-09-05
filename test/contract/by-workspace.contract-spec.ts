import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { envSchema } from '@src/config/env.schema';
import { TenantsModule } from '@src/tenants/tenants.module';
import {
  createCryptoFromEnv,
  deleteTenantCascade,
  seedTenantWithTwentyConnection,
} from './helpers';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    TenantsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    },
  ],
})
class ByWorkspaceContractAppModule {}

describe('by-workspace tenant resolution contract (ZEX-37)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const crypto = createCryptoFromEnv();
  const urls = {
    baseUrl: 'http://127.0.0.1:1',
    graphqlUrl: 'http://127.0.0.1:1/graphql',
    restUrl: 'http://127.0.0.1:1/rest',
  };

  const seeded: string[] = [];

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      ByWorkspaceContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
  }, 60000);

  afterAll(async () => {
    for (const id of seeded.splice(0)) {
      await deleteTenantCascade(prisma, id);
    }
    await app?.close();
  });

  async function adminGet(path: string) {
    const res = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${process.env.ADMIN_API_KEY}` },
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function seed(name: string, workspaceId: string) {
    const t = await seedTenantWithTwentyConnection(prisma, crypto, {
      name,
      workspaceId,
      ...urls,
      apiKeyPlain: `sk_${name.replace(/\s+/g, '_').toLowerCase()}_xxxxxxxx`,
      webhookSecretPlain: `whsec_${name.replace(/\s+/g, '_').toLowerCase()}_xxxxxxxx`,
    });
    seeded.push(t.tenantId);
    return t;
  }

  it('resolves exactly one active mapping', async () => {
    const ws = `ws-byws-one-${Date.now()}`;
    const a = await seed('ByWs One', ws);
    const res = await adminGet(`/api/v1/admin/tenants/by-workspace/${ws}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ tenantId: a.tenantId, workspaceId: ws });
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await adminGet(
      `/api/v1/admin/tenants/by-workspace/ws-does-not-exist-${Date.now()}`,
    );
    expect(res.statusCode).toBe(404);
  });

  it('fails closed with 409 when two active mappings share a workspace', async () => {
    const ws = `ws-byws-dup-${Date.now()}`;
    const a = await seed('ByWs Dup A', ws);
    const b = await seed('ByWs Dup B', ws);

    const res = await adminGet(`/api/v1/admin/tenants/by-workspace/${ws}`);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBeDefined();
    const tenantIds = (res.body as { tenantIds?: string[] }).tenantIds;
    if (tenantIds) {
      expect(tenantIds.sort()).toEqual([a.tenantId, b.tenantId].sort());
    }
  });

  it('ignores inactive mappings and resolves the sole active one', async () => {
    const ws = `ws-byws-inactive-${Date.now()}`;
    const active = await seed('ByWs Active', ws);
    const inactive = await seed('ByWs Inactive', ws);
    await prisma.twentyConnection.update({
      where: { tenantId: inactive.tenantId },
      data: { status: 'inactive' },
    });

    const res = await adminGet(`/api/v1/admin/tenants/by-workspace/${ws}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.tenantId).toBe(active.tenantId);
  });

  it('ignores deleted-tenant active mapping when a live active mapping exists', async () => {
    const ws = `ws-byws-deleted-${Date.now()}`;
    const live = await seed('ByWs Live', ws);
    const dead = await seed('ByWs Dead', ws);
    await prisma.tenant.update({
      where: { id: dead.tenantId },
      data: { deletedAt: new Date() },
    });

    const res = await adminGet(`/api/v1/admin/tenants/by-workspace/${ws}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.tenantId).toBe(live.tenantId);
  });
});
