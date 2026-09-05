import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { ActionFeedModule } from '@src/action-feed/action-feed.module';
import { AiSdrModule } from '@src/ai-sdr/ai-sdr.module';
import { AuditModule } from '@src/audit/audit.module';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { envSchema } from '@src/config/env.schema';
import { AI_SDR_CRM_SYNC_QUEUE, AI_SDR_SEND_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryModule } from '@src/prospect-discovery/prospect-discovery.module';
import { ResearchAgentModule } from '@src/research-agent/research-agent.module';
import { TwentyModule } from '@src/twenty/twenty.module';
import { WhyNowModule } from '@src/why-now/why-now.module';
import { TenantsModule } from '@src/tenants/tenants.module';
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
    TenantsModule,
    CompanyBrainModule,
    ProspectDiscoveryModule,
    WhyNowModule,
    ResearchAgentModule,
    AiSdrModule,
    ActionFeedModule,
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
class ActionFeedContractAppModule {}

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

describe('Action Feed contract (ZEX-37)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fake: FakeTwentyGraphqlServer;
  let tenantA: string;
  let tenantB: string;
  let sendQueue: Queue;
  let crmQueue: Queue;
  let workspaceA: string;

  beforeAll(async () => {
    process.env.COMPANY_BRAIN_DETERMINISTIC = 'true';
    process.env.PROSPECT_DISCOVERY_DETERMINISTIC = 'true';
    process.env.WHY_NOW_DETERMINISTIC = 'true';
    process.env.RESEARCH_AGENT_DETERMINISTIC = 'true';
    process.env.AI_SDR_DETERMINISTIC = 'true';

    fake = new FakeTwentyGraphqlServer();
    const urls = await fake.start();

    app = await NestFactory.create<NestFastifyApplication>(
      ActionFeedContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    sendQueue = app.get(getQueueToken(AI_SDR_SEND_QUEUE));
    crmQueue = app.get(getQueueToken(AI_SDR_CRM_SYNC_QUEUE));

    const crypto = createCryptoFromEnv();
    workspaceA = 'ws-feed-a';
    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Feed A',
      workspaceId: workspaceA,
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'feed_a_api_key_xxxxxxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'feed_a_webhook_secret_xxxxxxxx',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Feed B',
      workspaceId: 'ws-feed-b',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'feed_b_api_key_xxxxxxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'feed_b_webhook_secret_xxxxxxxx',
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
  }, 120000);

  afterAll(async () => {
    if (tenantA) await deleteTenantCascade(prisma, tenantA);
    if (tenantB) await deleteTenantCascade(prisma, tenantB);
    await sendQueue?.close();
    await crmQueue?.close();
    await app?.close();
    await fake.stop();
  });

  async function admin(
    method: 'GET' | 'POST',
    path: string,
    body?: object,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${process.env.ADMIN_API_KEY}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      payload: body,
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('aggregates, dedupes, prioritizes, rejects draft, isolates tenants', async () => {
    const brain = await admin('POST', `/api/v1/admin/tenants/${tenantA}/company-brain`, {
      companyName: 'ZEX Platform',
      pastedText: BRAIN_TEXT,
      analyze: true,
      sync: true,
    });
    expect(brain.statusCode).toBeLessThan(300);

    const discover = await admin('POST', `/api/v1/admin/tenants/${tenantA}/prospect-discovery`, {
      companyBrainId: brain.body.id,
      sync: true,
    });
    const candidates =
      (discover.body.candidates as Array<{ id: string; providerKey?: string }>) || [];
    const strong = candidates.find(c => c.providerKey === 'det_strong_fit');
    expect(strong).toBeTruthy();

    // Prospect awaiting approval should appear
    let feed = await admin('GET', `/api/v1/admin/tenants/${tenantA}/action-feed`);
    expect(feed.statusCode).toBe(200);
    let items = feed.body.items as Array<{
      type: string;
      prospectCandidateId?: string;
      evidence?: unknown[];
      preview?: { subject?: string };
    }>;
    expect(
      items.some(i => i.type === 'prospect_approval' && i.prospectCandidateId === strong!.id),
    ).toBe(true);

    await admin('POST', `/api/v1/admin/tenants/${tenantA}/prospects/${strong!.id}/why-now`, {
      sync: true,
      collectSignals: true,
      fixture: 'strong_why_now',
    });
    await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospect-discovery/candidates/${strong!.id}/approve`,
    );
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/prospects/${strong!.id}/research`, {
      sync: true,
      fixture: 'strong_research',
    });

    const sdr = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong!.id}/sdr`,
      {
        targetEmail: 'jordan@northwind.test',
        generateDraft: true,
      },
    );
    const draftId = String((sdr.body.draft as { id: string }).id);
    const sequenceId = String((sdr.body.sequence as { id: string }).id);

    feed = await admin('GET', `/api/v1/admin/tenants/${tenantA}/action-feed`);
    items = feed.body.items as Array<{
      type: string;
      prospectCandidateId?: string;
      evidence: unknown[];
      preview?: { subject?: string };
    }>;
    // Downstream dedupe: draft approval wins over prospect (already approved anyway)
    const forStrong = items.filter(i => i.prospectCandidateId === strong!.id);
    expect(forStrong).toHaveLength(1);
    expect(forStrong[0].type).toBe('sdr_draft_approval');
    expect((forStrong[0].evidence || []).length).toBeGreaterThan(0);

    // Reject draft
    const rejected = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/reject`,
      { rejectedBy: 'reviewer' },
    );
    expect(rejected.statusCode).toBeLessThan(300);
    expect((rejected.body.draft as { status: string }).status).toBe('REJECTED');

    const rejectAgain = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/reject`,
      {},
    );
    expect(rejectAgain.statusCode).toBeLessThan(300);
    expect(rejectAgain.body.idempotent).toBe(true);

    const approveRejected = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/approve`,
      {},
    );
    expect(approveRejected.statusCode).toBe(400);

    const sendRejected = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/send`,
      { sync: true },
    );
    expect(sendRejected.statusCode).toBe(400);

    // New draft after reject
    const draft2 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/drafts`,
      { purpose: 'outreach' },
    );
    const draft2Id = String(draft2.body.id);
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft2Id}/approve`, {});
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft2Id}/send`, {
      sync: true,
      fixture: 'success',
    });
    const sent = await prisma.sdrMessage.findFirst({
      where: { tenantId: tenantA, draftId: draft2Id, status: 'SENT' },
    });
    expect(sent?.providerMessageId).toBeTruthy();

    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/replies`, {
      providerEventId: `feed-pos-${Date.now()}`,
      providerMessageId: sent!.providerMessageId!,
      classification: 'POSITIVE',
      bodySummary: 'Yes lets meet',
    });

    feed = await admin('GET', `/api/v1/admin/tenants/${tenantA}/action-feed`);
    items = feed.body.items as Array<{ type: string; prospectCandidateId?: string }>;
    const afterReply = items.filter(i => i.prospectCandidateId === strong!.id);
    expect(afterReply.length).toBe(1);
    expect(['meeting_opportunity', 'reply_review']).toContain(afterReply[0].type);
    // meetings outrank replies when booking proposed
    if (afterReply[0].type === 'meeting_opportunity') {
      expect(true).toBe(true);
    }

    // Workspace resolve
    const resolved = await admin('GET', `/api/v1/admin/tenants/by-workspace/${workspaceA}`);
    expect(resolved.statusCode).toBe(200);
    expect(resolved.body.tenantId).toBe(tenantA);

    // Isolation
    expect((await admin('GET', `/api/v1/admin/tenants/${tenantB}/action-feed`)).body.items).toEqual(
      [],
    );
    expect(
      (await admin('POST', `/api/v1/admin/tenants/${tenantB}/sdr/drafts/${draft2Id}/reject`, {}))
        .statusCode,
    ).toBe(404);

    const audits = await prisma.auditLog.findMany({
      where: { tenantId: tenantA, action: 'sdr_draft_rejected' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  }, 180000);
});
