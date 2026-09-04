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
import { COMPANY_BRAIN_QUEUE } from '@src/jobs/jobs.constants';
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
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
        },
      }),
    }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    AuditModule,
    CompanyBrainModule,
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
class CompanyBrainContractAppModule {}

describe('Company Brain v1 contract', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const crypto = createCryptoFromEnv();
  const adminKey = process.env.ADMIN_API_KEY!;

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    process.env.COMPANY_BRAIN_DETERMINISTIC = 'true';

    app = await NestFactory.create<NestFastifyApplication>(
      CompanyBrainContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(COMPANY_BRAIN_QUEUE));

    const urls = {
      baseUrl: 'http://127.0.0.1:1',
      graphqlUrl: 'http://127.0.0.1:1/graphql',
      restUrl: 'http://127.0.0.1:1/rest',
    };
    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Brain A',
      workspaceId: 'ws_brain_a',
      ...urls,
      apiKeyPlain: 'sk_brain_a',
      webhookSecretPlain: 'whsec_brain_a',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Brain B',
      workspaceId: 'ws_brain_b',
      ...urls,
      apiKeyPlain: 'sk_brain_b',
      webhookSecretPlain: 'whsec_brain_b',
    });
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
  }, 90000);

  afterAll(async () => {
    if (tenantAId) await deleteTenantCascade(prisma, tenantAId);
    if (tenantBId) await deleteTenantCascade(prisma, tenantBId);
    await queue?.close();
    await app?.close();
  });

  async function admin(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: object,
  ) {
    const res = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${adminKey}`,
        'content-type': 'application/json',
      },
      payload: body,
    });
    return res;
  }

  const sourceText = `
ZEX Platform is a B2B SaaS revenue intelligence product.
Industry: SaaS, B2B
Company size: 11-50
Geography: US, EU
Use cases: lead enrichment, scoring automation
Buying triggers: CRM migration
Disqualifiers: consumer marketplaces
Persona: VP Sales
Pain points: manual research eats AE time
Competitors: Clearbit, ZoomInfo
Value propositions: evidence-backed automation
Differentiators: provenance on every claim
Objections: data freshness
Proof points: audit-first pipeline
Messaging themes: trust, speed
`;

  it('creates, analyzes, edits, isolates, and audits Company Brain', async () => {
    const createRes = await admin('POST', `/api/v1/admin/tenants/${tenantAId}/company-brain`, {
      companyName: 'ZEX Platform',
      pastedText: sourceText,
      analyze: true,
      sync: true,
    });
    expect(createRes.statusCode).toBe(201);
    const brain = JSON.parse(createRes.body);
    expect(brain.status).toBe('ready');
    expect(brain.payload.icp.industries.length).toBeGreaterThan(0);
    expect(brain.payload.personas.length).toBeGreaterThan(0);
    expect(brain.payload.painPoints.length).toBeGreaterThan(0);
    expect(brain.payload.competitors.length).toBeGreaterThan(0);
    expect(brain.payload.qualificationRules.length).toBeGreaterThan(0);
    expect(brain.payload.messagingSummary.oneLiner).toBeTruthy();

    for (const section of [
      brain.payload.icp,
      brain.payload.personas[0],
      brain.payload.painPoints[0],
      brain.payload.competitors[0],
      brain.payload.qualificationRules[0],
      brain.payload.messagingSummary,
    ]) {
      expect(section.evidence?.length).toBeGreaterThan(0);
      expect(section.evidence[0].sourceId).toBeTruthy();
      expect(section.evidence[0].excerpt.length).toBeGreaterThan(0);
      expect(section.evidence[0].excerpt.length).toBeLessThanOrEqual(500);
    }

    const dup = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/company-brain/${brain.id}/sources`,
      {
        sourceType: 'PASTED_TEXT',
        title: 'Pasted text',
        text: sourceText,
      },
    );
    expect(dup.statusCode).toBe(201);
    const dupBody = JSON.parse(dup.body);
    expect(dupBody.duplicated).toBe(true);

    const sourcesAfter = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantAId}/company-brain/${brain.id}`,
    );
    const sourcesCount = JSON.parse(sourcesAfter.body).sources.length;
    expect(sourcesCount).toBe(1);

    const editedOneLiner = 'Human-edited one-liner for ZEX';
    const editRes = await admin(
      'PATCH',
      `/api/v1/admin/tenants/${tenantAId}/company-brain/${brain.id}/messaging`,
      { oneLiner: editedOneLiner },
    );
    expect(editRes.statusCode).toBe(200);
    expect(JSON.parse(editRes.body).payload.messagingSummary.oneLiner).toBe(editedOneLiner);

    const regen = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/company-brain/${brain.id}/regenerate`,
      { sync: true },
    );
    expect(regen.statusCode).toBe(201);
    expect(JSON.parse(regen.body).payload.messagingSummary.oneLiner).toBe(editedOneLiner);

    const cross = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantBId}/company-brain/${brain.id}`,
    );
    expect(cross.statusCode).toBe(404);

    const crossPatch = await admin(
      'PATCH',
      `/api/v1/admin/tenants/${tenantBId}/company-brain/${brain.id}`,
      { companyName: 'Hijack' },
    );
    expect(crossPatch.statusCode).toBe(404);

    const crossSource = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantBId}/company-brain/${brain.id}/sources`,
      { sourceType: 'PASTED_TEXT', text: 'evil' },
    );
    expect(crossSource.statusCode).toBe(404);

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenantAId, resourceTwentyId: brain.id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map(a => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'company_brain_created',
        'company_brain_analyzed',
        'company_brain_messaging_edited',
      ]),
    );
    expect(
      audits.every(a => !JSON.stringify(a.after ?? {}).includes(sourceText.slice(0, 80))),
    ).toBe(true);
  });
});
