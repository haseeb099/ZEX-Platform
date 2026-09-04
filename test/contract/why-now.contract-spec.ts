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
import { WHY_NOW_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryModule } from '@src/prospect-discovery/prospect-discovery.module';
import { TwentyModule } from '@src/twenty/twenty.module';
import { WhyNowModule } from '@src/why-now/why-now.module';
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
    WhyNowModule,
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
class WhyNowContractAppModule {}

const BRAIN_TEXT = `
ZEX Platform is a B2B SaaS revenue intelligence product.
Industry: SaaS, B2B
Company size: 11-50
Geography: US, UK
Use cases: lead enrichment, scoring automation
Buying triggers: CRM migration, outbound scaling
Disqualifiers: consumer marketplaces
Persona: VP Sales
Persona: Head of Revenue Operations
Pain points: manual research
Value propositions: evidence-backed automation
Differentiators: provenance
Messaging themes: trust, speed
`;

type CandidateBody = {
  id: string;
  providerKey: string | null;
  status: string;
  companyName: string;
  industry: string | null;
};

type ScoreBody = {
  id: string;
  fitScore: number;
  intentScore: number;
  timingScore: number;
  overallScore: number;
  confidence: number;
  whyNow: string;
  fitReasons: unknown[];
  intentReasons: unknown[];
  timingReasons: unknown[];
  signalIds: string[];
  scoringVersion: string;
};

describe('Why-Now v1 contract', () => {
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
    process.env.WHY_NOW_DETERMINISTIC = 'true';

    const urls = await fakeTwenty.start();

    app = await NestFactory.create<NestFastifyApplication>(
      WhyNowContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(WHY_NOW_QUEUE));

    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'WhyNow A',
      workspaceId: 'ws_whynow_a',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sk_whynow_a',
      webhookSecretPlain: 'whsec_whynow_a',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'WhyNow B',
      workspaceId: 'ws_whynow_b',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sk_whynow_b',
      webhookSecretPlain: 'whsec_whynow_b',
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

  it('scores prospects with fit/intent/timing/evidence/confidence + isolation', async () => {
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
    const run = JSON.parse(discover.body) as { id: string; candidates: CandidateBody[] };
    expect(run.candidates.length).toBeGreaterThanOrEqual(4);

    const strong = run.candidates.find(c => c.providerKey === 'det_strong_fit');
    const fresh = run.candidates.find(c => c.providerKey === 'det_new_valid');
    const weak = run.candidates.find(c => c.providerKey === 'det_disqualified');
    expect(strong && fresh && weak).toBeTruthy();

    const strongScoreRes = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${strong!.id}/why-now`,
      { sync: true, collectSignals: true, fixture: 'strong_why_now' },
    );
    expect(strongScoreRes.statusCode).toBe(201);
    const strongScore = JSON.parse(strongScoreRes.body) as ScoreBody;
    expect(strongScore.fitScore).toBeGreaterThanOrEqual(0);
    expect(strongScore.fitScore).toBeLessThanOrEqual(100);
    expect(strongScore.intentScore).toBeGreaterThanOrEqual(0);
    expect(strongScore.timingScore).toBeGreaterThanOrEqual(0);
    expect(strongScore.overallScore).toBeGreaterThanOrEqual(0);
    expect(strongScore.confidence).toBeGreaterThan(0);
    expect(strongScore.confidence).toBeLessThanOrEqual(1);
    expect(strongScore.fitReasons?.length).toBeGreaterThan(0);
    expect(strongScore.intentReasons?.length).toBeGreaterThan(0);
    expect(strongScore.timingReasons?.length).toBeGreaterThan(0);
    expect(strongScore.whyNow.length).toBeGreaterThan(20);
    expect(strongScore.fitScore).toBeGreaterThanOrEqual(70);
    expect(strongScore.intentScore).toBeGreaterThanOrEqual(50);
    expect(strongScore.timingScore).toBeGreaterThanOrEqual(45);

    const noSignalRes = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${fresh!.id}/why-now`,
      { sync: true, collectSignals: true, fixture: 'no_signal' },
    );
    expect(noSignalRes.statusCode).toBe(201);
    const noSignal = JSON.parse(noSignalRes.body) as ScoreBody;
    expect(noSignal.fitScore).toBeGreaterThanOrEqual(55);
    expect(noSignal.intentScore).toBeLessThan(30);
    expect(noSignal.timingScore).toBeLessThan(25);

    const staleRes = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${fresh!.id}/why-now`,
      { sync: true, collectSignals: true, fixture: 'stale_signal' },
    );
    expect(staleRes.statusCode).toBe(201);
    const stale = JSON.parse(staleRes.body) as ScoreBody;
    expect(stale.timingScore).toBeLessThan(strongScore.timingScore);
    expect(stale.id).not.toBe(noSignal.id);

    const history = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${fresh!.id}/why-now/history`,
    );
    expect(history.statusCode).toBe(200);
    const histBody = JSON.parse(history.body) as { snapshots: ScoreBody[] };
    expect(histBody.snapshots.length).toBeGreaterThanOrEqual(2);

    const signalPayload = {
      signals: [
        {
          signalType: 'crm_migration',
          category: 'buying_trigger',
          title: 'Manual CRM migration signal',
          summary: 'CRM migration',
          source: 'contract-test',
          occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          confidence: 0.9,
          relevance: 0.95,
          evidence: [{ source: 'contract-test', excerpt: 'CRM migration', confidence: 0.9 }],
          providerKey: 'contract_manual_crm',
        },
      ],
    };
    const ingest1 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${strong!.id}/signals`,
      signalPayload,
    );
    expect(ingest1.statusCode).toBe(201);
    const ingest2 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${strong!.id}/signals`,
      signalPayload,
    );
    expect(ingest2.statusCode).toBe(201);
    const ingest2Body = JSON.parse(ingest2.body) as { ingested: number; duplicates: number };
    expect(ingest2Body.duplicates).toBeGreaterThanOrEqual(1);
    expect(ingest2Body.ingested).toBe(0);

    const badFit = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantAId}/prospects/${weak!.id}/why-now`,
      { sync: true, collectSignals: true, fixture: 'bad_fit_recent' },
    );
    expect(badFit.statusCode).toBe(201);
    const badFitScore = JSON.parse(badFit.body) as ScoreBody;
    expect(badFitScore.overallScore).toBeLessThan(60);
    expect(badFitScore.whyNow.toLowerCase()).toMatch(/weak|disqualifier|limited|consumer/);

    const crossGet = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantBId}/prospects/${strong!.id}/why-now`,
    );
    expect(crossGet.statusCode).toBe(404);

    const crossScore = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantBId}/prospects/${strong!.id}/why-now`,
      { sync: true, fixture: 'no_signal' },
    );
    expect(crossScore.statusCode).toBe(404);

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenantAId },
      select: { action: true },
    });
    const actions = audits.map(a => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'why_now_scored',
        'why_now_rescored',
        'signal_ingested',
        'signal_duplicate_detected',
      ]),
    );
  }, 120000);
});
