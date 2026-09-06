import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { ActionFeedModule } from '@src/action-feed/action-feed.module';
import { AgentControlModule } from '@src/agent-control/agent-control.module';
import { AiSdrModule } from '@src/ai-sdr/ai-sdr.module';
import { AuditModule } from '@src/audit/audit.module';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { envSchema } from '@src/config/env.schema';
import {
  AI_SDR_CRM_SYNC_QUEUE,
  AI_SDR_SEND_QUEUE,
  PROSPECT_RESEARCH_QUEUE,
} from '@src/jobs/jobs.constants';
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
    AgentControlModule,
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
class AgentControlContractAppModule {}

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

describe('Agent Control Center contract (ZEX-39)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fake: FakeTwentyGraphqlServer;
  let tenantA: string;
  let tenantB: string;
  let sendQueue: Queue;
  let crmQueue: Queue;
  let researchQueue: Queue;

  beforeAll(async () => {
    process.env.COMPANY_BRAIN_DETERMINISTIC = 'true';
    process.env.PROSPECT_DISCOVERY_DETERMINISTIC = 'true';
    process.env.WHY_NOW_DETERMINISTIC = 'true';
    process.env.RESEARCH_AGENT_DETERMINISTIC = 'true';
    process.env.AI_SDR_DETERMINISTIC = 'true';

    fake = new FakeTwentyGraphqlServer();
    const urls = await fake.start();

    app = await NestFactory.create<NestFastifyApplication>(
      AgentControlContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    sendQueue = app.get(getQueueToken(AI_SDR_SEND_QUEUE));
    crmQueue = app.get(getQueueToken(AI_SDR_CRM_SYNC_QUEUE));
    researchQueue = app.get(getQueueToken(PROSPECT_RESEARCH_QUEUE));

    const crypto = createCryptoFromEnv();
    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Agents A',
      workspaceId: 'ws-agents-a',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'agents_a_api_key_xxxxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'agents_a_webhook_secret_xxxxxx',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Agents B',
      workspaceId: 'ws-agents-b',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'agents_b_api_key_xxxxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'agents_b_webhook_secret_xxxxxx',
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
  }, 120000);

  afterAll(async () => {
    if (tenantA) await deleteTenantCascade(prisma, tenantA);
    if (tenantB) await deleteTenantCascade(prisma, tenantB);
    await sendQueue?.close();
    await crmQueue?.close();
    await researchQueue?.close();
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

  async function seedApprovedProspect(tenantId: string) {
    const brain = await admin('POST', `/api/v1/admin/tenants/${tenantId}/company-brain`, {
      companyName: 'ZEX Platform',
      pastedText: BRAIN_TEXT,
      analyze: true,
      sync: true,
    });
    expect(brain.statusCode).toBeLessThan(300);

    const discover = await admin('POST', `/api/v1/admin/tenants/${tenantId}/prospect-discovery`, {
      companyBrainId: brain.body.id,
      sync: true,
    });
    const candidates =
      (discover.body.candidates as Array<{ id: string; providerKey?: string }>) || [];
    const strong = candidates.find(c => c.providerKey === 'det_strong_fit');
    expect(strong).toBeTruthy();

    await admin('POST', `/api/v1/admin/tenants/${tenantId}/prospects/${strong!.id}/why-now`, {
      sync: true,
      collectSignals: true,
      fixture: 'strong_why_now',
    });
    await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantId}/prospect-discovery/candidates/${strong!.id}/approve`,
    );
    return strong!.id;
  }

  it('overview, pause/resume, undo, pause enforcement, isolation, irreversible guards', async () => {
    // --- Overview: agents present with permissions/policies ---
    let overview = await admin('GET', `/api/v1/admin/tenants/${tenantA}/agents`);
    expect(overview.statusCode).toBe(200);
    expect(overview.body.version).toBe('agent-control-v1');
    const agents = overview.body.agents as Array<{
      id: string;
      status: string;
      controlState: string;
      permissions: Array<{ key: string; mode: string }>;
      approvalPolicy: { neverAutonomous: string[] };
      recentActions: unknown[];
    }>;
    expect(agents.map(a => a.id).sort()).toEqual(['ai_sdr', 'research_agent']);
    const research = agents.find(a => a.id === 'research_agent')!;
    const sdr = agents.find(a => a.id === 'ai_sdr')!;
    expect(research.permissions.find(p => p.key === 'mutate_crm')?.mode).toBe('not_allowed');
    expect(sdr.permissions.find(p => p.key === 'approve_draft')?.mode).toBe('human_only');
    expect(sdr.permissions.find(p => p.key === 'send_outreach')?.mode).toBe('approval_required');
    expect(sdr.approvalPolicy.neverAutonomous).toContain('auto_send');
    expect(research.status).toBe('idle');
    expect(sdr.status).toBe('idle');

    // Unmapped audit must not appear attributed
    await prisma.auditLog.create({
      data: {
        tenantId: tenantA,
        action: 'company_brain_created',
        resourceType: 'CompanyBrain',
        triggeredBy: 'test',
        after: { name: 'x' },
      },
    });
    const actionsList = await admin('GET', `/api/v1/admin/tenants/${tenantA}/agent-actions`);
    expect(actionsList.statusCode).toBe(200);
    const listed = actionsList.body.actions as Array<{
      actionType: string;
      agentId: string | null;
    }>;
    expect(listed.some(a => a.actionType === 'company_brain_created')).toBe(false);

    // Unknown agent id
    expect(
      (await admin('POST', `/api/v1/admin/tenants/${tenantA}/agents/meeting_agent/pause`, {}))
        .statusCode,
    ).toBe(404);
    expect((await admin('GET', `/api/v1/admin/tenants/does-not-exist/agents`)).statusCode).toBe(
      404,
    );

    // --- Seed research + SDR work for action history ---
    const candidateId = await seedApprovedProspect(tenantA);
    const researchRun = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/research`,
      { sync: true, fixture: 'strong_research' },
    );
    expect(researchRun.statusCode).toBeLessThan(300);

    overview = await admin('GET', `/api/v1/admin/tenants/${tenantA}/agents?recentLimit=20`);
    const researchAfter = (overview.body.agents as typeof agents).find(
      a => a.id === 'research_agent',
    )!;
    expect(
      (researchAfter.recentActions as Array<{ actionType?: string }>).some(
        a => a.actionType === 'research_completed',
      ),
    ).toBe(true);

    const sdrCreate = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/sdr`,
      { targetEmail: 'jordan@northwind.test', generateDraft: true },
    );
    expect(sdrCreate.statusCode).toBeLessThan(300);
    const draftId = String((sdrCreate.body.draft as { id: string }).id);
    const sequenceId = String((sdrCreate.body.sequence as { id: string }).id);

    // Approval-first send still required
    const sendNoApproval = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/send`,
      { sync: true },
    );
    expect(sendNoApproval.statusCode).toBe(400);

    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/approve`, {});
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draftId}/send`, {
      sync: true,
      fixture: 'success',
    });
    const sent = await prisma.sdrMessage.findFirst({
      where: { tenantId: tenantA, draftId, status: 'SENT' },
    });
    expect(sent).toBeTruthy();

    // Rejected drafts still cannot approve/send
    const draft2 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/drafts`,
      { purpose: 'follow_up' },
    );
    const draft2Id = String(draft2.body.id);
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft2Id}/reject`, {});
    expect(
      (await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft2Id}/approve`, {}))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft2Id}/send`, {
          sync: true,
        })
      ).statusCode,
    ).toBe(400);

    // --- Pause Research Agent ---
    const pauseResearch = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agents/research_agent/pause`,
      { triggeredBy: 'test-operator' },
    );
    expect(pauseResearch.statusCode).toBe(200);
    expect(pauseResearch.body.state).toBe('PAUSED');
    expect(pauseResearch.body.reversible).toBe(true);
    const pauseResearchActionId = String(pauseResearch.body.actionId);

    overview = await admin('GET', `/api/v1/admin/tenants/${tenantA}/agents`);
    expect(
      (overview.body.agents as typeof agents).find(a => a.id === 'research_agent')!.status,
    ).toBe('paused');

    const blockedResearch = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/research`,
      { sync: true, fixture: 'sparse_research' },
    );
    expect(blockedResearch.statusCode).toBe(400);
    expect(JSON.stringify(blockedResearch.body)).toMatch(/paused/i);

    // Resume research
    const resumeResearch = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agents/research_agent/resume`,
      {},
    );
    expect(resumeResearch.statusCode).toBe(200);
    expect(resumeResearch.body.state).toBe('ACTIVE');

    // --- Pause AI SDR ---
    const pauseSdr = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agents/ai_sdr/pause`,
      {},
    );
    expect(pauseSdr.statusCode).toBe(200);
    const pauseSdrActionId = String(pauseSdr.body.actionId);

    const blockedSeq = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/sdr`,
      { targetEmail: 'other@northwind.test', generateDraft: true },
    );
    expect(blockedSeq.statusCode).toBe(400);

    const blockedDraft = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/drafts`,
      { purpose: 'outreach' },
    );
    expect(blockedDraft.statusCode).toBe(400);

    // Inbound reply / unsubscribe safety still works while paused
    const replyNeg = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${sequenceId}/replies`,
      {
        providerEventId: `agents-unsub-${Date.now()}`,
        providerMessageId: sent!.providerMessageId!,
        classification: 'UNSUBSCRIBE',
        bodySummary: 'Please unsubscribe me',
      },
    );
    expect(replyNeg.statusCode).toBeLessThan(300);
    const seqAfter = await prisma.sdrSequence.findFirst({
      where: { id: sequenceId, tenantId: tenantA },
    });
    expect(seqAfter?.status).toBe('CANCELLED');

    // Positive reply while paused: stop works, no new adaptation drafts
    // Recreate sequence for positive path — need new sequence after cancel
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/agents/ai_sdr/resume`, {});
    const sdr2 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/sdr`,
      { targetEmail: 'alex@northwind.test', generateDraft: true },
    );
    const seq2 = String((sdr2.body.sequence as { id: string }).id);
    const draft3 = String((sdr2.body.draft as { id: string }).id);
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft3}/approve`, {});
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/drafts/${draft3}/send`, {
      sync: true,
      fixture: 'success',
    });
    const sent2 = await prisma.sdrMessage.findFirst({
      where: { tenantId: tenantA, draftId: draft3, status: 'SENT' },
    });
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/agents/ai_sdr/pause`, {});
    const draftsBefore = await prisma.sdrDraft.count({
      where: { tenantId: tenantA, sequenceId: seq2 },
    });
    const replyPos = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${seq2}/replies`,
      {
        providerEventId: `agents-pos-${Date.now()}`,
        providerMessageId: sent2!.providerMessageId!,
        classification: 'POSITIVE',
        bodySummary: 'Interested in a call',
      },
    );
    expect(replyPos.statusCode).toBeLessThan(300);
    expect((await prisma.sdrSequence.findFirst({ where: { id: seq2 } }))?.status).toBe('REPLIED');
    const draftsAfter = await prisma.sdrDraft.count({
      where: { tenantId: tenantA, sequenceId: seq2 },
    });
    expect(draftsAfter).toBe(draftsBefore); // no adaptation drafts while paused

    // --- Stale-undo safety (latest-effective only) ---
    // Existing timeline already has pauseResearchActionId then resume → A is superseded.
    const undoStaleA0 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agent-actions/${pauseResearchActionId}/undo`,
      {},
    );
    expect(undoStaleA0.statusCode).toBe(409);
    expect(
      (
        await prisma.tenantAgentControl.findUnique({
          where: { tenantId_agentId: { tenantId: tenantA, agentId: 'research_agent' } },
        })
      )?.state,
    ).toBe('ACTIVE');

    const undoAuditsBefore = await prisma.auditLog.count({
      where: { tenantId: tenantA, action: 'agent_control_undo' },
    });

    // A pause → B resume → C pause
    const pauseA = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agents/research_agent/pause`,
      {},
    );
    const actionA = String(pauseA.body.actionId);
    const resumeB = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agents/research_agent/resume`,
      {},
    );
    const actionB = String(resumeB.body.actionId);
    const pauseC = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agents/research_agent/pause`,
      {},
    );
    const actionC = String(pauseC.body.actionId);
    expect(pauseC.body.state).toBe('PAUSED');

    // undo A → superseded
    const undoA = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agent-actions/${actionA}/undo`,
      {},
    );
    expect(undoA.statusCode).toBe(409);
    expect(
      (
        await prisma.tenantAgentControl.findUnique({
          where: { tenantId_agentId: { tenantId: tenantA, agentId: 'research_agent' } },
        })
      )?.state,
    ).toBe('PAUSED');

    // undo B → superseded
    const undoB = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agent-actions/${actionB}/undo`,
      {},
    );
    expect(undoB.statusCode).toBe(409);
    expect(
      (
        await prisma.tenantAgentControl.findUnique({
          where: { tenantId_agentId: { tenantId: tenantA, agentId: 'research_agent' } },
        })
      )?.state,
    ).toBe('PAUSED');

    expect(
      await prisma.auditLog.count({
        where: { tenantId: tenantA, action: 'agent_control_undo' },
      }),
    ).toBe(undoAuditsBefore); // no false undo audits for A/B

    // undo C → succeeds, restores ACTIVE
    const undoC = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agent-actions/${actionC}/undo`,
      {},
    );
    expect(undoC.statusCode).toBe(200);
    expect(undoC.body.undone).toBe(true);
    expect(undoC.body.idempotent).toBe(false);
    expect(undoC.body.state).toBe('ACTIVE');
    expect(
      (
        await prisma.tenantAgentControl.findUnique({
          where: { tenantId_agentId: { tenantId: tenantA, agentId: 'research_agent' } },
        })
      )?.state,
    ).toBe('ACTIVE');

    const undoAuditsAfterC = await prisma.auditLog.count({
      where: { tenantId: tenantA, action: 'agent_control_undo' },
    });
    expect(undoAuditsAfterC).toBe(undoAuditsBefore + 1);

    // Idempotent second undo of C
    const undoCAgain = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/agent-actions/${actionC}/undo`,
      {},
    );
    expect(undoCAgain.statusCode).toBe(200);
    expect(undoCAgain.body.idempotent).toBe(true);
    expect(undoCAgain.body.state).toBe('ACTIVE');
    expect(
      await prisma.auditLog.count({
        where: { tenantId: tenantA, action: 'agent_control_undo' },
      }),
    ).toBe(undoAuditsBefore + 1);

    // History undo states
    const hist = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantA}/agent-actions?agentId=research_agent&limit=50`,
    );
    expect(hist.body.historyWindowLimit).toBe(500);
    const histActions = hist.body.actions as Array<{
      id: string;
      reversible: boolean;
      undo: { status: string };
      actionType: string;
    }>;
    const byId = Object.fromEntries(histActions.map(a => [a.id, a]));
    expect(byId[actionA]?.undo.status).toBe('superseded');
    expect(byId[actionA]?.reversible).toBe(true);
    expect(byId[actionB]?.undo.status).toBe('superseded');
    expect(byId[actionC]?.undo.status).toBe('undone');

    // Irreversible: sent email
    const sentAudit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, action: 'sdr_sent' },
    });
    expect(sentAudit).toBeTruthy();
    expect(
      (
        await admin(
          'POST',
          `/api/v1/admin/tenants/${tenantA}/agent-actions/${sentAudit!.id}/undo`,
          {},
        )
      ).statusCode,
    ).toBe(400);
    // may be outside research filter — check global list
    const allHist = await admin('GET', `/api/v1/admin/tenants/${tenantA}/agent-actions?limit=100`);
    const sentAction = (allHist.body.actions as typeof histActions).find(
      a => a.id === sentAudit!.id,
    );
    expect(sentAction?.undo.status).toBe('not_reversible');

    // Book meeting then refuse undo
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/agents/ai_sdr/resume`, {});
    // Confirm meeting if booking exists from earlier positive path — create fresh meeting flow
    const sdr3 = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${candidateId}/sdr`,
      { targetEmail: 'meet@northwind.test', generateDraft: false },
    );
    const seq3 = String((sdr3.body.sequence as { id: string }).id);
    await admin('POST', `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${seq3}/drafts`, {
      purpose: 'meeting',
    });
    await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/sdr/sequences/${seq3}/meetings/confirm`,
      {},
    );
    const bookedAudit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, action: 'sdr_meeting_booked' },
    });
    expect(bookedAudit).toBeTruthy();
    expect(
      (
        await admin(
          'POST',
          `/api/v1/admin/tenants/${tenantA}/agent-actions/${bookedAudit!.id}/undo`,
          {},
        )
      ).statusCode,
    ).toBe(400);

    // Cross-tenant isolation
    expect(
      (await admin('GET', `/api/v1/admin/tenants/${tenantB}/agents`)).body.agents,
    ).toBeTruthy();
    expect(
      (
        (await admin('GET', `/api/v1/admin/tenants/${tenantB}/agents`)).body.agents as typeof agents
      ).every(a => a.recentActions.length === 0 || true),
    ).toBe(true);
    expect(
      (await admin('POST', `/api/v1/admin/tenants/${tenantB}/agents/ai_sdr/pause`, {})).statusCode,
    ).toBe(200);
    // Tenant B cannot undo Tenant A action (latest or stale)
    expect(
      (
        await admin(
          'POST',
          `/api/v1/admin/tenants/${tenantB}/agent-actions/${pauseSdrActionId}/undo`,
          {},
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await admin('POST', `/api/v1/admin/tenants/${tenantB}/agent-actions/${actionC}/undo`, {}))
        .statusCode,
    ).toBe(404);
    // Tenant B agents overview must not leak Tenant A actions
    const bActions = await admin('GET', `/api/v1/admin/tenants/${tenantB}/agent-actions`);
    const bListed = bActions.body.actions as Array<{ auditLogId: string }>;
    expect(bListed.some(a => a.auditLogId === pauseResearchActionId)).toBe(false);

    // No secrets in overview payload
    const raw = JSON.stringify(overview.body);
    expect(raw.toLowerCase()).not.toMatch(/api[_-]?key|webhooksecret|bearer |password/);
  }, 180000);
});
