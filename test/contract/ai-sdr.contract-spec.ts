import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { createHmac } from 'crypto';
import { AiSdrModule } from '@src/ai-sdr/ai-sdr.module';
import { DeterministicOutboundProvider } from '@src/ai-sdr/providers/deterministic.provider';
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
import { TwentyClient } from '@src/twenty/twenty.client';
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
    ResearchAgentModule,
    AiSdrModule,
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
class AiSdrContractAppModule {}

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

describe('AI SDR contract (ZEX-36)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fake: FakeTwentyGraphqlServer;
  let tenantA: string;
  let tenantB: string;
  let sendQueue: Queue;
  let crmQueue: Queue;
  let outbound: DeterministicOutboundProvider;
  let twenty: TwentyClient;
  const mutationSpies: jest.SpyInstance[] = [];

  beforeAll(async () => {
    process.env.COMPANY_BRAIN_DETERMINISTIC = 'true';
    process.env.PROSPECT_DISCOVERY_DETERMINISTIC = 'true';
    process.env.WHY_NOW_DETERMINISTIC = 'true';
    process.env.RESEARCH_AGENT_DETERMINISTIC = 'true';
    process.env.AI_SDR_DETERMINISTIC = 'true';

    fake = new FakeTwentyGraphqlServer();
    const urls = await fake.start();

    app = await NestFactory.create<NestFastifyApplication>(
      AiSdrContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    sendQueue = app.get(getQueueToken(AI_SDR_SEND_QUEUE));
    crmQueue = app.get(getQueueToken(AI_SDR_CRM_SYNC_QUEUE));
    outbound = app.get(DeterministicOutboundProvider);
    twenty = app.get(TwentyClient);
    for (const method of ['createCompany', 'createOpportunity', 'updatePerson'] as const) {
      mutationSpies.push(jest.spyOn(twenty, method));
    }

    const crypto = createCryptoFromEnv();
    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'SDR A',
      workspaceId: 'ws-sdr-a',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sdr_a_api_key_xxxxxxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'sdr_a_webhook_secret_xxxxxxxx',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'SDR B',
      workspaceId: 'ws-sdr-b',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sdr_b_api_key_xxxxxxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'sdr_b_webhook_secret_xxxxxxxx',
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

  async function prepareApprovedResearchedCandidate() {
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
    return strong!.id;
  }

  it('end-to-end approval-first SDR + negative gates', async () => {
    outbound.reset();
    const candidateId = await prepareApprovedResearchedCandidate();

    // No recipient → sequence ok, send blocked
    const noEmail = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/sdr`,
      {
        generateDraft: true,
      },
    );
    expect(noEmail.statusCode).toBeLessThan(300);
    const noEmailDraftId = String((noEmail.body.draft as { id: string }).id);
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${noEmailDraftId}/approve`, {
      approvedBy: 'reviewer',
    });
    const blockedNoEmail = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${noEmailDraftId}/send`,
      { sync: true },
    );
    expect(blockedNoEmail.statusCode).toBe(400);
    expect(String(blockedNoEmail.body.message || '')).toMatch(/targetEmail/i);

    // Happy path sequence with email
    const created = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/sdr`,
      {
        targetEmail: 'jordan.lee@northwind.test',
        targetPersonName: 'Jordan Lee',
        generateDraft: true,
      },
    );
    expect(created.statusCode).toBeLessThan(300);
    const sequenceId = String((created.body.sequence as { id: string }).id);
    const draftV1 = created.body.draft as {
      id: string;
      contentHash: string;
      body: string;
      version: number;
    };
    expect(draftV1.body.toLowerCase()).not.toMatch(/congrats on your series/);

    // No approval → send blocked
    const unapproved = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftV1.id}/send`,
      { sync: true },
    );
    expect(unapproved.statusCode).toBe(400);

    // Approve v1
    const approved = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftV1.id}/approve`,
      { approvedBy: 'reviewer-1' },
    );
    expect(approved.statusCode).toBeLessThan(300);

    // Supersede: create v2 → v1 approval must not send v2
    const draftV2Res = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/drafts`,
      { purpose: 'outreach' },
    );
    expect(draftV2Res.statusCode).toBeLessThan(300);
    const draftV2 = draftV2Res.body as { id: string };
    const sendV2WithV1 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftV2.id}/send`,
      { sync: true },
    );
    expect(sendV2WithV1.statusCode).toBe(400);

    // Approve v2 and send
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftV2.id}/approve`, {
      approvedBy: 'reviewer-1',
    });
    const sent = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftV2.id}/send`,
      {
        sync: true,
        fixture: 'success',
      },
    );
    expect(sent.statusCode).toBeLessThan(300);
    expect(sent.body.status).toBe('SENT');
    expect(sent.body.providerMessageId).toBeTruthy();
    const providerCallsAfterFirst = outbound.sendCalls.length;

    // Retry send → idempotent, no extra provider call
    const resent = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftV2.id}/send`,
      { sync: true },
    );
    expect(resent.statusCode).toBeLessThan(300);
    expect(resent.body.providerMessageId).toBe(sent.body.providerMessageId);
    expect(outbound.sendCalls.length).toBe(providerCallsAfterFirst);

    // Provider failure path: new follow-up draft approve + permanent failure → no CRM sent note for that message
    const follow = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/drafts`,
      { purpose: 'follow_up' },
    );
    const followId = String(follow.body.id);
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${followId}/approve`, {});
    // Queue follow-up then reply race: mark queued by async send then reply before worker... use sync race via service state:
    // 1) queue follow-up async
    const queuedFollow = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${followId}/send`,
      { sync: false },
    );
    expect(queuedFollow.body.status).toBe('queued');

    // Reply positive → stop
    const reply = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/replies`,
      {
        providerEventId: `evt-pos-${Date.now()}`,
        providerMessageId: String(sent.body.providerMessageId),
        classification: 'POSITIVE',
        bodySummary: 'Yes, happy to chat next week',
      },
    );
    expect(reply.statusCode).toBeLessThan(300);
    expect(reply.body.sequenceStatus).toBe('REPLIED');

    // Worker/execute follow-up must not send
    const followSendAfterReply = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${followId}/send`,
      { sync: true },
    );
    expect(followSendAfterReply.statusCode).toBe(400);

    // Meeting confirm
    const seq = await admin('GET', `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}`);
    expect(seq.statusCode).toBe(200);
    expect((seq.body.meetings as unknown[]).length).toBeGreaterThanOrEqual(1);
    const booked = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/meetings/confirm`,
      {},
    );
    expect(booked.statusCode).toBeLessThan(300);
    expect(booked.body.status).toBe('BOOKED');

    // Tenant isolation
    expect(
      (await admin('GET', `/api/v1/admin/tenants/${tenantB}/sdr/sequences/${sequenceId}`))
        .statusCode,
    ).toBe(404);
    expect(
      (await admin('POST', `/api/v1/admin/tenants/${tenantB}/sdr/drafts/${draftV2.id}/approve`, {}))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await admin('POST', `/api/v1/admin/tenants/${tenantB}/sdr/drafts/${draftV2.id}/send`, {
          sync: true,
        })
      ).statusCode,
    ).toBe(404);

    // Signed reply webhook bad signature → 401
    const badHook = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/outbound/reply',
      headers: {
        'content-type': 'application/json',
        'x-zex-sdr-signature': 'sha256=deadbeef',
        'x-zex-sdr-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      payload: { tenantId: tenantA, providerEventId: 'x', sequenceId },
    });
    expect(badHook.statusCode).toBe(401);

    // Good signature webhook idempotent
    const payload = JSON.stringify({
      tenantId: tenantA,
      providerEventId: `evt-hook-${Date.now()}`,
      sequenceId,
      classification: 'QUESTION',
      bodySummary: 'What pricing?',
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig =
      'sha256=' +
      createHmac('sha256', process.env.SDR_REPLY_WEBHOOK_SECRET!)
        .update(`${ts}:${payload}`, 'utf8')
        .digest('hex');
    const okHook = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/outbound/reply',
      headers: {
        'content-type': 'application/json',
        'x-zex-sdr-signature': sig,
        'x-zex-sdr-timestamp': ts,
      },
      payload,
    });
    expect(okHook.statusCode).toBe(200);

    // Unsubscribe stops
    const unsubCand = await prepareApprovedResearchedCandidate();
    const unsubSeq = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${unsubCand}/sdr`,
      {
        targetEmail: 'stop@example.test',
        generateDraft: true,
      },
    );
    const unsubDraft = (unsubSeq.body.draft as { id: string }).id;
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${unsubDraft}/approve`, {});
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${unsubDraft}/send`, {
      sync: true,
    });
    const unsub = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${(unsubSeq.body.sequence as { id: string }).id}/replies`,
      { providerEventId: `unsub-${Date.now()}`, classification: 'UNSUBSCRIBE' },
    );
    expect(unsub.body.sequenceStatus).toBe('CANCELLED');

    // Audits present
    const actions = new Set(
      (
        await prisma.auditLog.findMany({ where: { tenantId: tenantA }, select: { action: true } })
      ).map(a => a.action),
    );
    for (const required of [
      'sdr_sequence_created',
      'sdr_draft_generated',
      'sdr_approval_granted',
      'sdr_send_blocked_unapproved',
      'sdr_sent',
      'sdr_reply_received',
      'sdr_sequence_paused_on_reply',
      'sdr_meeting_booked',
    ]) {
      expect(actions.has(required)).toBe(true);
    }

    // No unauthorized CRM mutations beyond notes
    for (const spy of mutationSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  }, 180000);
});
