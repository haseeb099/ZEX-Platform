import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { AuditModule } from '@src/audit/audit.module';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { envSchema } from '@src/config/env.schema';
import { PROSPECT_DISCOVERY_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryModule } from '@src/prospect-discovery/prospect-discovery.module';
import { TwentyModule } from '@src/twenty/twenty.module';
import { FakeTwentyGraphqlServer } from './fake-twenty-server';
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
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    AuditModule,
    TwentyModule,
    CompanyBrainModule,
    ProspectDiscoveryModule,
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
class ProspectDiscoveryContractAppModule {}

const BRAIN_TEXT = `
ZEX Platform is a B2B SaaS revenue intelligence product.
Industry: SaaS, B2B
Company size: 11-50
Geography: US, EU
Use cases: lead enrichment, scoring automation
Buying triggers: CRM migration
Disqualifiers: consumer
Persona: VP Sales
Pain points: manual research
Competitors: ZoomInfo
Value propositions: evidence-backed automation
Differentiators: provenance
Objections: data freshness
Proof points: audit-first pipeline
Messaging themes: trust, speed
`;

describe('Prospect Discovery v1 contract', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const fakeTwenty = new FakeTwentyGraphqlServer();
  const crypto = createCryptoFromEnv();
  const adminKey = process.env.ADMIN_API_KEY!;

  let tenantAId: string;
  let tenantBId: string;
  let brainId: string;

  beforeAll(async () => {
    process.env.COMPANY_BRAIN_DETERMINISTIC = 'true';
    process.env.PROSPECT_DISCOVERY_DETERMINISTIC = 'true';

    const urls = await fakeTwenty.start();
    fakeTwenty.seedCompany({
      id: 'co_acme_dup',
      name: 'Acme Duplicate Co',
      website: 'https://acme-duplicate.example',
    });

    app = await NestFactory.create<NestFastifyApplication>(
      ProspectDiscoveryContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(PROSPECT_DISCOVERY_QUEUE));

    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Discovery A',
      workspaceId: 'ws_disc_a',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sk_disc_a',
      webhookSecretPlain: 'whsec_disc_a',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Discovery B',
      workspaceId: 'ws_disc_b',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sk_disc_b',
      webhookSecretPlain: 'whsec_disc_b',
    });
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
  }, 120000);

  afterAll(async () => {
    if (tenantAId) await deleteTenantCascade(prisma, tenantAId);
    if (tenantBId) await deleteTenantCascade(prisma, tenantBId);
    await queue?.close();
    await app?.close();
    await fakeTwenty.stop();
  });

  async function admin(method: string, url: string, body?: object) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${adminKey}`,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    return app.inject({
      method: method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      url,
      headers,
      payload: body,
    });
  }

  it('runs discovery → dedupe → approval-first CRM create with isolation + audit', async () => {
    const brainRes = await admin('POST', `/api/v1/admin/tenants/${tenantAId}/company-brain`, {
      companyName: 'ZEX Platform',
      pastedText: BRAIN_TEXT,
      analyze: true,
      sync: true,
    });
    expect(brainRes.statusCode).toBe(201);
    brainId = JSON.parse(brainRes.body).id;

    const discover = await admin('POST', `/api/v1/admin/tenants/${tenantAId}/prospect-discovery`, {
      companyBrainId: brainId,
      sync: true,
    });
    expect(discover.statusCode).toBe(201);
    const run = JSON.parse(discover.body);
    expect(run.status).toBe('completed');
    expect(run.candidates.length).toBeGreaterThanOrEqual(4);

    for (const c of run.candidates) {
      expect(c.buyerRoles?.length).toBeGreaterThan(0);
      expect(c.buyerRoles[0].role).toBeTruthy();
      expect(c.fitReasons?.length).toBeGreaterThan(0);
    }

    const duplicate = run.candidates.find((c: any) => c.domain === 'acme-duplicate.example');
    expect(duplicate).toBeTruthy();
    expect(duplicate.dedupeStatus).toBe('EXACT_MATCH');
    expect(duplicate.status).toBe('DUPLICATE');
    expect(duplicate.existingTwentyCompanyId).toBe('co_acme_dup');

    const fresh = run.candidates.find((c: any) => c.providerKey === 'det_new_valid');
    expect(fresh).toBeTruthy();
    expect(fresh.status).toBe('PROPOSED');
    expect(fresh.dedupeStatus).toBe('NEW');

    const createBeforeApprove = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${fresh.id}/create`,
    );
    expect(createBeforeApprove.statusCode).toBeGreaterThanOrEqual(400);

    const approve = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${fresh.id}/approve`,
    );
    expect(approve.statusCode).toBe(201);
    expect(JSON.parse(approve.body).status).toBe('APPROVED');

    const companiesBefore = fakeTwenty.getCompanies().length;
    const create = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${fresh.id}/create`,
    );
    expect(create.statusCode).toBe(201);
    const created = JSON.parse(create.body);
    expect(created.status).toBe('CREATED');
    expect(created.createdTwentyCompanyId).toBeTruthy();
    expect(fakeTwenty.getCompanies().length).toBe(companiesBefore + 1);

    const retry = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${fresh.id}/retry-create`,
    );
    // Already CREATED — should reject or be idempotent; service requires APPROVED|FAILED
    expect(retry.statusCode).toBeGreaterThanOrEqual(400);
    expect(fakeTwenty.getCompanies().length).toBe(companiesBefore + 1);

    // Force FAILED with company id present then retry should not duplicate
    await prisma.prospectCandidate.update({
      where: { id: fresh.id },
      data: { status: 'FAILED', lastError: 'simulated' },
    });
    const retryOk = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${fresh.id}/retry-create`,
    );
    expect(retryOk.statusCode).toBe(201);
    expect(JSON.parse(retryOk.body).createdTwentyCompanyId).toBe(created.createdTwentyCompanyId);
    expect(fakeTwenty.getCompanies().length).toBe(companiesBefore + 1);

    const toReject = run.candidates.find((c: any) => c.providerKey === 'det_strong_fit');
    const reject = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${toReject.id}/reject`,
    );
    expect(reject.statusCode).toBe(201);
    expect(JSON.parse(reject.body).status).toBe('REJECTED');

    const createRejected = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospect-discovery/candidates/${toReject.id}/create`,
    );
    expect(createRejected.statusCode).toBeGreaterThanOrEqual(400);

    const cross = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantBId}/prospect-discovery/${run.id}`,
    );
    expect(cross.statusCode).toBe(404);

    const crossApprove = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantBId}/prospect-discovery/candidates/${fresh.id}/approve`,
    );
    expect(crossApprove.statusCode).toBe(404);

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenantAId },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map(a => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'prospect_discovery_run_created',
        'prospect_discovery_completed',
        'prospect_candidate_proposed',
        'prospect_candidate_duplicate_detected',
        'prospect_candidate_approved',
        'prospect_candidate_crm_created',
        'prospect_candidate_rejected',
      ]),
    );
  });
});
